import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ATTR_CLIENT_ADDRESS,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_PATH,
  ATTR_URL_SCHEME,
} from "@opentelemetry/semantic-conventions";
import serveStatic from "serve-static";
import {
  decodeAndValidateBoardName,
  isValidBoardName,
} from "../client-data/js/board_name.js";
import { getLoadedBoard, pinReplayBaseline } from "./board_registry.mjs";
import {
  badRequest,
  boundaryReason,
  boundaryStatusCode,
} from "./boundary_errors.mjs";
import { check_output_directory } from "./check_output_directory.mjs";
import { readConfiguration } from "./configuration.mjs";
import { applyCompressionForResponse } from "./http_compression.mjs";
import * as jwtauth from "./jwtauth.mjs";
import * as jwtBoardName from "./jwtBoardnameAuth.mjs";
import observability from "./observability.mjs";
import { parseRequestUrl, validateRequestUrl } from "./request_url.mjs";
import {
  boardExists,
  readBoardDocumentState,
  readServedBaseline,
  streamServedBaseline,
} from "./svg_board_store.mjs";
import * as templating from "./templating.mjs";
import {
  appendSetCookieHeader,
  generateUserSecret,
  getUserSecretCookiePath,
  getUserSecretFromCookieHeader,
  serializeUserSecretCookie,
} from "./user_secret_cookie.mjs";

const { createRequestId, logger, metrics, tracing } = observability;
const config = readConfiguration();

/** @typedef {import("http").IncomingMessage} HttpRequest */
/** @typedef {import("http").ServerResponse} HttpResponse */
/** @typedef {import("node:net").AddressInfo | string | null} ServerAddress */

const app = createServer(handler);
app.on("clientError", handleClientError);
let shutdownRequested = false;

void (async function startServer() {
  await check_output_directory(config.HISTORY_DIR);
  const sockets = await import(
    `./sockets.mjs?cache-bust=${crypto.randomUUID()}`
  );
  sockets.start(app);
  if (isProcessEntrypoint()) {
    installShutdownHandlers(app, sockets);
  }

  app.listen(config.PORT, config.HOST, () => {
    const actualPort = getAddressPort(app.address());
    logger.info("server.started", {
      [ATTR_SERVER_PORT]: actualPort,
      "log.level": config.LOG_LEVEL,
    });
    if (process.send)
      process.send({ type: "server-started", port: actualPort });
  });
})().catch((error) => {
  logger.error("server.start_failed", {
    error,
  });
  process.exit(1);
});

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

/**
 * @param {string} cacheValue
 * @returns {string}
 */
function cacheControl(cacheValue) {
  return config.IS_DEVELOPMENT ? "no-store" : cacheValue;
}

/**
 * @param {HttpRequest | undefined} request
 * @returns {boolean}
 */
function hasVersionToken(request) {
  if (!request) return false;
  return parseRequestUrl(request.url).searchParams.has("v");
}

const fileserver = serveStatic(config.WEBROOT, {
  maxAge: 0,
  /** @param {HttpResponse} res */
  setHeaders: (res, /** @type {string} */ filePath) => {
    res.setHeader("Content-Security-Policy", CSP);
    if (config.IS_DEVELOPMENT) {
      res.setHeader("Cache-Control", "no-store");
      return;
    }
    const ext = path.extname(filePath || "").toLowerCase();
    const isStaticAsset = [
      ".js",
      ".css",
      ".svg",
      ".ico",
      ".png",
      ".jpg",
      ".gif",
    ].includes(ext);
    if (!isStaticAsset) return;
    if (hasVersionToken(res.req)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=7200");
  },
});

const errorPage = fs.readFileSync(path.join(config.WEBROOT, "error.html"));

const boardTemplate = new templating.BoardTemplate(
  path.join(config.WEBROOT, "board.html"),
);
const indexTemplate = new templating.Template(
  path.join(config.WEBROOT, "index.html"),
);
const SLOW_REQUEST_LOG_MS = 1000;
const STATIC_RESOURCE_EXTENSIONS = [
  ".js",
  ".css",
  ".svg",
  ".ico",
  ".png",
  ".jpg",
  ".gif",
];
const BOARD_SCOPED_ROUTES = new Set(["boards", "preview", "download"]);

/**
 * @param {import("http").Server} server
 * @param {{shutdown?: () => Promise<void>}} sockets
 * @returns {void}
 */
function installShutdownHandlers(server, sockets) {
  /**
   * @param {NodeJS.Signals} signal
   * @returns {Promise<void>}
   */
  async function shutdown(signal) {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info("server.shutdown_started", { signal });
    try {
      await sockets.shutdown?.();
      await new Promise(
        /**
         * @param {(value?: void | PromiseLike<void>) => void} resolve
         * @param {(reason?: unknown) => void} reject
         */
        (resolve, reject) => {
          server.close((error) => {
            if (!error || errorCode(error) === "ERR_SERVER_NOT_RUNNING") {
              resolve();
              return;
            }
            reject(error);
          });
          server.closeAllConnections?.();
        },
      );
      logger.info("server.shutdown_completed", { signal });
      process.exit(0);
    } catch (error) {
      logger.error("server.shutdown_failed", {
        signal,
        error,
      });
      process.exit(1);
    }
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

/**
 * Only the standalone server process should own process-global signal handlers.
 * In-process test imports close the server explicitly and must not accumulate
 * SIGINT/SIGTERM listeners across cache-busted module reloads.
 *
 * @returns {boolean}
 */
function isProcessEntrypoint() {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  return path.resolve(entryArg) === fileURLToPath(import.meta.url);
}

/**
 * @param {ServerAddress} address
 * @returns {number | undefined}
 */
function getAddressPort(address) {
  if (!address || typeof address === "string") return undefined;
  return address.port;
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
function parseIfNoneMatch(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {string | string[] | undefined} ifNoneMatch
 * @param {string} etag
 * @returns {boolean}
 */
function matchesIfNoneMatch(ifNoneMatch, etag) {
  if (ifNoneMatch === undefined) return false;
  const values = parseIfNoneMatch(ifNoneMatch);
  return values.includes("*") || values.includes(etag);
}

/**
 * @param {number | string} seq
 * @returns {string}
 */
function boardPageETag(seq) {
  return `W/"wbo-seq-${Number(seq) || 0}"`;
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function parseBoardPageETag(value) {
  const match =
    /^W\/"wbo-seq-(\d+)"$/.exec(value) || /^"wbo-seq-(\d+)"$/.exec(value);
  if (!match?.[1]) return null;
  const seq = Number(match[1]);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
}

/**
 * @param {string | string[] | undefined} ifNoneMatch
 * @returns {number[]}
 */
function parseBoardPageETagCandidates(ifNoneMatch) {
  return parseIfNoneMatch(ifNoneMatch)
    .map(parseBoardPageETag)
    .filter((seq) => seq !== null);
}

/**
 * @param {string} boardName
 * @param {number} baselineSeq
 * @returns {void}
 */
function pinServedBoardBaseline(boardName, baselineSeq) {
  const expiresAtMs = Date.now() + Math.max(0, config.MAX_SAVE_DELAY);
  pinReplayBaseline(boardName, baselineSeq, expiresAtMs);
}

/**
 * @param {HttpRequest} request
 * @returns {string}
 */
function requestScheme(request) {
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  if (typeof forwardedProto === "string" && forwardedProto.trim() !== "") {
    const protoValue = forwardedProto.split(",")[0];
    if (protoValue) {
      return protoValue.trim().toLowerCase();
    }
  }

  const forwarded = firstHeaderValue(request.headers.forwarded);
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    const forwardedValue = forwarded.split(",")[0];
    const protoPart = forwardedValue
      ? forwardedValue
          .split(";")
          .map((part) => part.trim())
          .find((part) => /^proto=/i.test(part))
      : undefined;
    if (protoPart) {
      return protoPart
        .replace(/^proto=/i, "")
        .trim()
        .toLowerCase();
    }
  }

  return "encrypted" in request.socket && request.socket.encrypted
    ? "https"
    : "http";
}

/**
 * @param {HttpRequest} request
 * @returns {string | undefined}
 */
function requestAuthority(request) {
  const host =
    firstHeaderValue(request.headers["x-forwarded-host"]) ||
    firstHeaderValue(request.headers.host);
  if (typeof host !== "string" || host.trim() === "") return undefined;
  const authority = host.split(",")[0];
  return authority ? authority.trim() : undefined;
}

/**
 * @param {HttpRequest} request
 * @returns {string}
 */
function requestServerAddress(request) {
  const authority = requestAuthority(request);
  if (authority) {
    try {
      return new URL(`${requestScheme(request)}://${authority}`).hostname;
    } catch {}
  }
  return config.HOST || request.socket.localAddress || "localhost";
}

/**
 * @param {HttpRequest} request
 * @returns {number | undefined}
 */
function requestServerPort(request) {
  const authority = requestAuthority(request);
  const scheme = requestScheme(request);
  if (authority) {
    try {
      const parsed = new URL(`${scheme}://${authority}`);
      if (parsed.port) return Number(parsed.port);
      return scheme === "https" ? 443 : 80;
    } catch {}
  }
  if (typeof request.socket.localPort === "number") {
    return request.socket.localPort;
  }
  const configuredPort = Number(config.PORT);
  return Number.isFinite(configuredPort) ? configuredPort : undefined;
}

/**
 * @param {HttpRequest} request
 * @returns {string}
 */
function requestPath(request) {
  return parseRequestUrl(request.url).pathname;
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @returns {void}
 */
function ensureBoardUserSecretCookie(request, response, parsedUrl) {
  const existingUserSecret = getUserSecretFromCookieHeader(
    request.headers.cookie,
  );
  if (existingUserSecret !== "") return;
  appendSetCookieHeader(
    response,
    serializeUserSecretCookie(generateUserSecret(), {
      path: getUserSecretCookiePath(parsedUrl.pathname),
      secure: requestScheme(request) === "https",
    }),
  );
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorToString(error) {
  return error instanceof Error ? error.toString() : String(error);
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  if (!error || typeof error !== "object") return undefined;
  if (!("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * @param {unknown} error
 * @returns {number | undefined}
 */
function requestErrorStatusCode(error) {
  const boundaryCode = boundaryStatusCode(error);
  if (boundaryCode !== undefined) return boundaryCode;
  const code = errorCode(error);
  if (code === "ENOENT") return 404;
  if (code === "ENAMETOOLONG") return 400;
  return undefined;
}

/**
 * @param {HttpResponse} response
 * @param {number} statusCode
 * @returns {void}
 */
function respondWithErrorPage(response, statusCode) {
  response.writeHead(statusCode, { "Content-Length": errorPage.length });
  response.end(errorPage);
}

/**
 * @param {string} route
 * @param {number} statusCode
 * @param {number} durationMs
 * @returns {{level: "warn" | "error", event: string} | null}
 */
function classifyRequestLog(route, statusCode, durationMs) {
  if (statusCode >= 500) {
    return { level: "error", event: "http.request_failed" };
  }
  if (route === "static_file") return null;
  if (statusCode >= 400) {
    return { level: "warn", event: "http.request_rejected" };
  }
  if (durationMs >= SLOW_REQUEST_LOG_MS) {
    return { level: "warn", event: "http.request_slow" };
  }
  return null;
}

/**
 * @param {string} method
 * @param {string} route
 * @returns {string}
 */
function requestSpanName(method, route) {
  const routeTemplate = requestRouteTemplate(route);
  return routeTemplate ? `${method} ${routeTemplate}` : `${method} request`;
}

/**
 * @param {string} route
 * @returns {string | undefined}
 */
function requestRouteTemplate(route) {
  switch (route) {
    case "boards_redirect":
      return "/boards";
    case "board_page":
      return "/boards/{board}";
    case "download_board":
      return "/download/{board}";
    case "preview_board":
      return "/preview/{board}";
    case "random_board":
      return "/random";
    case "index":
      return "/";
    default:
      return undefined;
  }
}

/**
 * @param {string} requestUrl
 * @returns {boolean}
 */
function shouldTraceRequest(requestUrl) {
  const parsedUrl = parseRequestUrl(requestUrl);
  const fileExt = path.extname(parsedUrl.pathname);
  return !STATIC_RESOURCE_EXTENSIONS.includes(fileExt);
}

/**
 * @param {{[key: string]: unknown}} fields
 * @returns {{[key: string]: unknown}}
 */
function requestTraceAttributes(fields) {
  /** @type {{[key: string]: unknown}} */
  const attributes = {};
  if (fields.board !== undefined) {
    attributes["wbo.board"] = fields.board;
  }
  if (fields.render_duration_ms !== undefined) {
    attributes["wbo.preview.render_duration_ms"] = fields.render_duration_ms;
  }
  return attributes;
}

/**
 * @param {{
 *   request: HttpRequest,
 *   response: HttpResponse,
 *   requestId: string,
 *   method: string,
 *   scheme: string,
 *   serverAddress: string,
 *   route: string,
 *   startedAt: number,
 *   requestError: unknown,
 *   requestSpan: import("@opentelemetry/api").Span | null,
 *   logFields: {[key: string]: unknown},
 * }} state
 * @returns {void}
 */
function finalizeObservedRequest(state) {
  const statusCode = state.response.statusCode || 200;
  const durationMs = Date.now() - state.startedAt;
  const durationSeconds = durationMs / 1000;
  const routeTemplate = requestRouteTemplate(state.route);
  const errorType =
    state.requestError instanceof Error
      ? state.requestError.name || "Error"
      : statusCode >= 500
        ? String(statusCode)
        : undefined;

  metrics.changeHttpActiveRequests({
    change: -1,
    method: state.method,
    scheme: state.scheme,
    serverAddress: state.serverAddress,
  });
  if (state.requestSpan) {
    tracing.setSpanAttributes(state.requestSpan, {
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
    });
    if (statusCode >= 500 && !state.requestError) {
      state.requestSpan.setStatus({
        code: tracing.SpanStatusCode.ERROR,
      });
    }
  }

  metrics.recordHttpRequest({
    method: state.method,
    route: routeTemplate,
    scheme: state.scheme,
    statusCode: statusCode,
    durationSeconds: durationSeconds,
    errorType: errorType,
  });
  const logTarget = classifyRequestLog(state.route, statusCode, durationMs);
  if (logTarget) {
    /** @type {{[key: string]: unknown}} */
    const fields = {
      request_id: state.requestId,
      [ATTR_HTTP_REQUEST_METHOD]: state.method,
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
      duration_ms: durationMs,
      [ATTR_URL_PATH]: requestPath(state.request),
      ...(routeTemplate ? { [ATTR_HTTP_ROUTE]: routeTemplate } : {}),
      ...state.logFields,
    };
    if (statusCode >= 400) {
      fields[ATTR_CLIENT_ADDRESS] = state.request.socket.remoteAddress;
    }
    if (state.requestError) fields.error = state.requestError;
    logger[logTarget.level](logTarget.event, fields);
  }
  if (state.requestSpan) {
    state.requestSpan.end();
  }
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @returns {{
 *   requestId: string,
 *   run: (fn: () => void) => void,
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }}
 */
function observeRequest(request, response) {
  const forwardedRequestId = request.headers["x-request-id"];
  const requestId =
    typeof forwardedRequestId === "string" && forwardedRequestId !== ""
      ? forwardedRequestId
      : createRequestId();
  response.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  const method = request.method || "GET";
  const scheme = requestScheme(request);
  const serverAddress = requestServerAddress(request);
  const serverPort = requestServerPort(request);
  let route = "unknown";
  /** @type {unknown} */
  let requestError;
  /** @type {{[key: string]: unknown}} */
  let logFields = {};
  const parentContext = tracing.extractContext(request.headers);
  const requestSpan = shouldTraceRequest(request.url || "/")
    ? tracing.startSpan(`${method} request`, {
        kind: tracing.SpanKind.SERVER,
        parentContext: parentContext,
        attributes: {
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_URL_SCHEME]: scheme,
          [ATTR_SERVER_ADDRESS]: serverAddress,
          [ATTR_SERVER_PORT]: serverPort,
        },
      })
    : null;
  metrics.changeHttpActiveRequests({
    change: 1,
    method: method,
    scheme: scheme,
    serverAddress: serverAddress,
  });
  let finalized = false;

  function finalize() {
    if (finalized) return;
    finalized = true;
    tracing.withSpanContext(
      requestSpan,
      parentContext,
      function finalizeRequestContext() {
        finalizeObservedRequest({
          request,
          response,
          requestId,
          method,
          scheme,
          serverAddress,
          route,
          startedAt,
          requestError,
          requestSpan,
          logFields,
        });
      },
    );
  }

  response.once("finish", finalize);
  response.once("close", finalize);

  return {
    requestId: requestId,
    run: function run(fn) {
      return tracing.withSpanContext(requestSpan, parentContext, fn);
    },
    setRoute: function setRoute(nextRoute) {
      route = nextRoute;
      if (requestSpan) {
        requestSpan.updateName(requestSpanName(method, nextRoute));
        const routeTemplate = requestRouteTemplate(nextRoute);
        if (routeTemplate) {
          tracing.setSpanAttributes(requestSpan, {
            [ATTR_HTTP_ROUTE]: routeTemplate,
          });
        }
      }
    },
    noteError: function noteError(error) {
      requestError = error;
      if (requestSpan) {
        tracing.recordSpanError(requestSpan, error);
      }
    },
    annotate: function annotate(fields) {
      logFields = { ...logFields, ...fields };
    },
    setTraceAttributes: function setTraceAttributes(fields) {
      if (!requestSpan) return;
      tracing.setSpanAttributes(requestSpan, requestTraceAttributes(fields));
    },
  };
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {{
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {(err?: unknown) => void}
 */
function serveError(request, response, requestContext) {
  void request;
  return (err) => {
    const statusCode = err ? requestErrorStatusCode(err) || 500 : 404;
    if (err && statusCode >= 500) {
      requestContext.noteError(err);
    } else if (err) {
      requestContext.annotate({
        rejection_reason: boundaryReason(err) || errorCode(err) || "rejected",
      });
    }
    respondWithErrorPage(response, statusCode);
  };
}

/**
 * @type {import('http').RequestListener}
 */
function handler(request, response) {
  const requestContext = observeRequest(request, response);
  requestContext.run(async function runRequestHandler() {
    try {
      await handleRequest(request, response, requestContext);
    } catch (err) {
      const statusCode = requestErrorStatusCode(err) || 500;
      if (statusCode >= 500) {
        requestContext.noteError(err);
        logger.error("http.request_unhandled", {
          request_id: requestContext.requestId,
          error: err,
        });
      } else {
        requestContext.annotate({
          rejection_reason: boundaryReason(err) || errorToString(err),
        });
      }
      respondWithErrorPage(response, statusCode);
    }
  });
}

/**
 * @param {Error} error
 * @param {import("node:net").Socket} socket
 * @returns {void}
 */
function handleClientError(error, socket) {
  const maybeCode =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  logger.warn("http.client_error", {
    code: typeof maybeCode === "string" ? maybeCode : undefined,
    message: error.message,
  });
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 11\r\n\r\nBad Request",
  );
}

/**
 * @param {string} boardName
 * @returns {string | null}
 */
function validateBoardName(boardName) {
  return isValidBoardName(boardName) ? boardName : null;
}

/**
 * @param {string | null} boardName
 * @returns {string | null}
 */
function validateBoardQuery(boardName) {
  if (boardName === null) return null;
  return validateBoardName(boardName);
}

/**
 * @param {string | undefined} boardName
 * @returns {string | null}
 */
function validateBoardPath(boardName) {
  if (boardName === undefined) return null;
  return decodeAndValidateBoardName(boardName);
}

/**
 * @param {string[]} parts
 * @param {number} index
 * @returns {string | undefined}
 */
function getPathPart(parts, index) {
  return parts[index];
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFoundError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * @param {string[]} parts
 * @returns {string[]}
 */
function normalizePathParts(parts) {
  if (parts[0] === "") parts.shift();
  return parts;
}

/**
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @returns {boolean}
 */
function shouldCheckUserPermissions(parsedUrl, parts) {
  const fileExt = path.extname(parsedUrl.pathname);
  return (
    !STATIC_RESOURCE_EXTENSIONS.includes(fileExt) &&
    !BOARD_SCOPED_ROUTES.has(parts[0] || "")
  );
}

/**
 * @param {{
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @param {string} boardName
 * @returns {void}
 */
function annotateBoardRequest(requestContext, boardName) {
  requestContext.annotate({ board: boardName });
  requestContext.setTraceAttributes({ board: boardName });
}

/**
 * @param {URL} parsedUrl
 * @returns {string}
 */
function requireBoardQueryName(parsedUrl) {
  const boardName = validateBoardQuery(
    parsedUrl.searchParams.get("board") || "anonymous",
  );
  if (boardName === null) {
    throw badRequest("invalid_board_name");
  }
  return boardName;
}

/**
 * @param {string[]} parts
 * @param {number} [index]
 * @returns {string}
 */
function requireBoardPathName(parts, index = 1) {
  const boardName = validateBoardPath(getPathPart(parts, index));
  if (boardName === null) {
    throw badRequest("invalid_board_name");
  }
  return boardName;
}

/**
 * @param {string[]} parts
 * @param {number} [index]
 * @returns {string}
 */
function requireBoardSvgPathName(parts, index = 1) {
  const boardPath = getPathPart(parts, index);
  if (!boardPath || !boardPath.endsWith(".svg")) {
    throw badRequest("invalid_board_name");
  }
  const boardName = validateBoardPath(boardPath.slice(0, -4));
  if (boardName === null) {
    throw badRequest("invalid_board_name");
  }
  return boardName;
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {{
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @param {string=} nextUrl
 * @returns {void}
 */
function serveStaticFile(request, response, requestContext, nextUrl) {
  requestContext.setRoute("static_file");
  if (nextUrl !== undefined) {
    request.url = nextUrl;
  }
  fileserver(request, response, serveError(request, response, requestContext));
}

/**
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {{
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {void}
 */
function handleBoardRedirectRoute(response, parsedUrl, requestContext) {
  const boardName = requireBoardQueryName(parsedUrl);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(config, parsedUrl, boardName);
  response.writeHead(301, {
    Location: `boards/${encodeURIComponent(boardName)}`,
  });
  response.end();
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {{
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   noteError: (error: unknown) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {Promise<void>}
 */
async function handleBoardDocumentRoute(
  request,
  response,
  parsedUrl,
  parts,
  requestContext,
) {
  const boardName = requireBoardPathName(parts);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(config, parsedUrl, boardName);
  const token = parsedUrl.searchParams.get("token");
  const boardRole = jwtBoardName.roleInBoard(config, token || "", boardName);
  const cachedSeqs = parseBoardPageETagCandidates(
    request.headers["if-none-match"],
  );
  const loadedBoardPromise = getLoadedBoard(boardName);
  if (loadedBoardPromise && cachedSeqs.length > 0) {
    const loadedBoard = await loadedBoardPromise;
    const persistedSeq = loadedBoard.getPersistedSeq();
    if (cachedSeqs.includes(persistedSeq)) {
      pinServedBoardBaseline(boardName, persistedSeq);
      response.writeHead(304, {
        "Cache-Control": boardTemplate.cacheControl(),
        ETag: boardPageETag(persistedSeq),
      });
      response.end();
      return;
    }
  }
  const {
    metadata: boardMetadata,
    inlineBoardSvg,
    source,
  } = await readBoardDocumentState(boardName);
  const canWrite =
    !boardMetadata.readonly ||
    (config.AUTH_SECRET_KEY && ["editor", "moderator"].includes(boardRole));
  const etag = boardPageETag(boardMetadata.seq || 0);
  if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
    pinServedBoardBaseline(boardName, boardMetadata.seq || 0);
    response.writeHead(304, {
      "Cache-Control": boardTemplate.cacheControl(),
      ETag: etag,
    });
    response.end();
    return;
  }
  pinServedBoardBaseline(boardName, boardMetadata.seq || 0);
  ensureBoardUserSecretCookie(request, response, parsedUrl);
  if (source === "svg" || source === "svg_backup") {
    const svgStream = await streamServedBaseline(boardName);
    svgStream.on("error", (error) => {
      requestContext.noteError(error);
      if (!response.headersSent) {
        respondWithErrorPage(response, 500);
      } else {
        response.destroy(error);
      }
    });
    boardTemplate.serveStream(
      request,
      response,
      svgStream,
      boardRole === "moderator",
      {
        etag,
        boardState: {
          readonly: boardMetadata.readonly,
          canWrite,
        },
      },
    );
    return;
  }
  boardTemplate.serve(request, response, boardRole === "moderator", {
    etag,
    inlineBoardSvg: inlineBoardSvg || "",
    boardState: {
      readonly: boardMetadata.readonly,
      canWrite,
    },
  });
}

/**
 * @param {HttpResponse} response
 * @param {NodeJS.ReadableStream} svgStream
 * @param {string | string[] | undefined} acceptEncoding
 * @returns {void}
 */
function respondWithBoardSvgStream(response, svgStream, acceptEncoding) {
  /** @type {{ [name: string]: string | number }} */
  const headers = {
    "Content-Type": "image/svg+xml",
    "Content-Security-Policy": CSP,
    "Cache-Control": cacheControl("public, max-age=30"),
  };
  const { stream } = applyCompressionForResponse(
    response,
    acceptEncoding,
    headers,
  );
  response.writeHead(200, headers);
  svgStream.pipe(stream);
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {{
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {Promise<void>}
 */
async function handleBoardSvgRoute(
  request,
  response,
  parsedUrl,
  parts,
  requestContext,
) {
  const boardName = requireBoardSvgPathName(parts);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(config, parsedUrl, boardName);
  const svgStream = await streamServedBaseline(boardName);
  svgStream.on("error", (error) => {
    requestContext.noteError(error);
    if (!response.headersSent) {
      respondWithErrorPage(response, 500);
    } else {
      response.destroy(error);
    }
  });
  respondWithBoardSvgStream(
    response,
    svgStream,
    request.headers["accept-encoding"],
  );
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {{
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {void | Promise<void>}
 */
function handleBoardsRoute(
  request,
  response,
  parsedUrl,
  parts,
  requestContext,
) {
  requestContext.setRoute(
    parts.length === 1 ? "boards_redirect" : "board_page",
  );
  if (parts.length === 1) {
    handleBoardRedirectRoute(response, parsedUrl, requestContext);
    return;
  }
  if (parts.length === 2 && getPathPart(parts, 1)?.endsWith(".svg")) {
    requestContext.setRoute("board_svg");
    return handleBoardSvgRoute(
      request,
      response,
      parsedUrl,
      parts,
      requestContext,
    );
  }
  if (parts.length === 2 && parsedUrl.pathname.indexOf(".") === -1) {
    return handleBoardDocumentRoute(
      request,
      response,
      parsedUrl,
      parts,
      requestContext,
    );
  }
  serveStaticFile(
    request,
    response,
    requestContext,
    `/${parts.slice(1).join("/")}`,
  );
}

/**
 * @param {HttpResponse} response
 * @param {string} boardName
 * @returns {Promise<void>}
 */
async function respondWithBoardDownload(response, boardName) {
  const data = await tracing.withActiveSpan(
    "board.download_read",
    {
      attributes: {
        "wbo.board": boardName,
        "wbo.board.operation": "download_read",
      },
    },
    function readBoardBaseline() {
      return readServedBaseline(boardName);
    },
  );
  response.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Content-Disposition": `attachment; filename="${boardName}.svg"`,
    "Content-Length": data.length,
  });
  response.end(data);
}

/**
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {{
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {void}
 */
function handleDownloadRoute(
  parsedUrl,
  parts,
  request,
  response,
  requestContext,
) {
  requestContext.setRoute("download_board");
  const boardName = requireBoardPathName(parts);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(config, parsedUrl, boardName);
  void respondWithBoardDownload(response, boardName).catch(
    serveError(request, response, requestContext),
  );
}

/**
 * @param {{
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @param {number} startedAt
 * @returns {number}
 */
function recordPreviewDuration(requestContext, startedAt) {
  const renderDurationMs = Date.now() - startedAt;
  requestContext.annotate({
    render_duration_ms: renderDurationMs,
  });
  requestContext.setTraceAttributes({
    render_duration_ms: renderDurationMs,
  });
  return renderDurationMs;
}

/**
 * @param {string} boardName
 * @returns {Promise<string | null>}
 */
async function renderPreviewSvg(boardName) {
  return tracing.withActiveSpan(
    "preview.render",
    {
      attributes: {
        "wbo.board": boardName,
        "wbo.board.operation": "preview_render",
      },
    },
    async function renderPreview() {
      try {
        if (!(await boardExists(boardName))) {
          tracing.setActiveSpanAttributes({
            "wbo.board": boardName,
            "wbo.board.operation": "preview_render",
            "wbo.board.result": "not_found",
          });
          return null;
        }
        return await readServedBaseline(boardName);
      } catch (err) {
        if (isNotFoundError(err)) {
          tracing.setActiveSpanAttributes({
            "wbo.board": boardName,
            "wbo.board.operation": "preview_render",
            "wbo.board.result": "not_found",
          });
          return null;
        }
        throw err;
      }
    },
  );
}

/**
 * @param {HttpResponse} response
 * @param {string} boardName
 * @param {{
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @param {number} startedAt
 * @param {string | string[] | undefined} acceptEncoding
 * @returns {Promise<void>}
 */
async function respondWithBoardPreview(
  response,
  boardName,
  requestContext,
  startedAt,
  acceptEncoding,
) {
  const svg = await renderPreviewSvg(boardName);
  recordPreviewDuration(requestContext, startedAt);
  if (svg === null) {
    response.writeHead(404, {
      "Content-Length": errorPage.length,
    });
    response.end(errorPage);
    return;
  }
  /** @type {{ [name: string]: string | number }} */
  const headers = {
    "Content-Type": "image/svg+xml",
    "Content-Security-Policy": CSP,
    "Cache-Control": cacheControl("public, max-age=30"),
  };
  const { stream } = applyCompressionForResponse(
    response,
    acceptEncoding,
    headers,
  );
  response.writeHead(200, headers);
  stream.end(svg);
}

/**
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {{
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {void}
 */
function handlePreviewRoute(
  parsedUrl,
  parts,
  request,
  response,
  requestContext,
) {
  requestContext.setRoute("preview_board");
  const boardName = requireBoardPathName(parts);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(config, parsedUrl, boardName);
  const startedAt = Date.now();
  void respondWithBoardPreview(
    response,
    boardName,
    requestContext,
    startedAt,
    request.headers["accept-encoding"],
  ).catch((err) => {
    recordPreviewDuration(requestContext, startedAt);
    requestContext.noteError(err);
    serveError(request, response, requestContext)(err);
  });
}

/**
 * @param {HttpResponse} response
 * @returns {void}
 */
function handleRandomRoute(response) {
  const name = crypto.randomBytes(24).toString("base64url");
  response.writeHead(307, { Location: `boards/${name}` });
  response.end(name);
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {{
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {void}
 */
function handleIndexRoute(request, response, requestContext) {
  if (config.DEFAULT_BOARD) {
    annotateBoardRequest(requestContext, config.DEFAULT_BOARD);
    response.writeHead(302, {
      Location: `boards/${encodeURIComponent(config.DEFAULT_BOARD)}`,
    });
    response.end(config.DEFAULT_BOARD);
    return;
  }
  indexTemplate.serve(request, response);
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {{
 *   requestId: string,
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {void | Promise<void>}
 */
function handleRequest(request, response, requestContext) {
  const parsedUrlResult = validateRequestUrl(request.url);
  if (parsedUrlResult.ok === false) {
    throw badRequest(parsedUrlResult.reason);
  }
  const parsedUrl = parsedUrlResult.value;
  const parts = normalizePathParts(parsedUrl.pathname.split("/"));

  if (shouldCheckUserPermissions(parsedUrl, parts)) {
    jwtauth.checkUserPermission(parsedUrl, config);
  }

  switch (parts[0]) {
    case "boards":
      return handleBoardsRoute(
        request,
        response,
        parsedUrl,
        parts,
        requestContext,
      );

    case "download":
      return handleDownloadRoute(
        parsedUrl,
        parts,
        request,
        response,
        requestContext,
      );

    case "export":
    case "preview":
      return handlePreviewRoute(
        parsedUrl,
        parts,
        request,
        response,
        requestContext,
      );

    case "random":
      requestContext.setRoute("random_board");
      return handleRandomRoute(response);

    case "":
      requestContext.setRoute("index");
      return handleIndexRoute(request, response, requestContext);

    default:
      return serveStaticFile(request, response, requestContext);
  }
}

export default app;
