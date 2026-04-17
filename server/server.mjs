import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";

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

import { BoardData } from "./boardData.mjs";
import check_output_directory from "./check_output_directory.mjs";
import { readConfiguration } from "./configuration.mjs";
import * as createSVG from "./createSVG.mjs";
import * as jwtauth from "./jwtauth.mjs";
import * as jwtBoardName from "./jwtBoardnameAuth.mjs";
import observability from "./observability.mjs";
import * as templating from "./templating.mjs";
import {
  decodeAndValidateBoardName,
  isValidBoardName,
} from "../client-data/js/board_name.js";
import {
  badRequest,
  boundaryReason,
  boundaryStatusCode,
} from "./boundary_errors.mjs";
import { parseRequestUrl, validateRequestUrl } from "./request_url.mjs";

const { createRequestId, logger, metrics, tracing } = observability;
const config = readConfiguration();

/** @typedef {import("http").IncomingMessage} HttpRequest */
/** @typedef {import("http").ServerResponse} HttpResponse */
/** @typedef {import("node:net").AddressInfo | string | null} ServerAddress */

const app = createServer(handler);
app.on("clientError", handleClientError);

void (async function startServer() {
  await check_output_directory(config.HISTORY_DIR);
  const sockets = await import(
    `./sockets.mjs?cache-bust=${crypto.randomUUID()}`
  );
  sockets.start(app);

  app.listen(config.PORT, config.HOST, () => {
    const actualPort = getAddressPort(app.address());
    logger.info("server.started", {
      [ATTR_SERVER_PORT]: actualPort,
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
  return ![".js", ".css", ".svg", ".ico", ".png", ".jpg", ".gif"].includes(
    fileExt,
  );
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
        const statusCode = response.statusCode || 200;
        const durationMs = Date.now() - startedAt;
        const durationSeconds = durationMs / 1000;
        const routeTemplate = requestRouteTemplate(route);
        const errorType =
          requestError instanceof Error
            ? requestError.name || "Error"
            : statusCode >= 500
              ? String(statusCode)
              : undefined;
        metrics.changeHttpActiveRequests({
          change: -1,
          method: method,
          scheme: scheme,
          serverAddress: serverAddress,
        });
        if (requestSpan) {
          tracing.setSpanAttributes(requestSpan, {
            [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
          });
          if (statusCode >= 500 && !requestError) {
            requestSpan.setStatus({
              code: tracing.SpanStatusCode.ERROR,
            });
          }
        }

        metrics.recordHttpRequest({
          method: method,
          route: routeTemplate,
          scheme: scheme,
          statusCode: statusCode,
          durationSeconds: durationSeconds,
          errorType: errorType,
        });
        const logTarget = classifyRequestLog(route, statusCode, durationMs);
        if (!logTarget) {
          if (requestSpan) requestSpan.end();
          return;
        }

        /** @type {{[key: string]: unknown}} */
        const fields = {
          request_id: requestId,
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
          duration_ms: durationMs,
          [ATTR_URL_PATH]: requestPath(request),
          ...(routeTemplate ? { [ATTR_HTTP_ROUTE]: routeTemplate } : {}),
          ...logFields,
        };
        if (statusCode >= 400) {
          fields[ATTR_CLIENT_ADDRESS] = request.socket.remoteAddress;
        }
        if (requestError) fields.error = requestError;
        logger[logTarget.level](logTarget.event, fields);
        if (requestSpan) {
          requestSpan.end();
        }
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
  requestContext.run(function runRequestHandler() {
    try {
      handleRequest(request, response, requestContext);
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
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {{
 *   requestId: string,
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {void}
 */
function handleRequest(request, response, requestContext) {
  const parsedUrlResult = validateRequestUrl(request.url);
  if (parsedUrlResult.ok === false) {
    throw badRequest(parsedUrlResult.reason);
  }
  const parsedUrl = parsedUrlResult.value;
  const parts = parsedUrl.pathname.split("/");

  if (parts[0] === "") parts.shift();

  const fileExt = path.extname(parsedUrl.pathname);
  const staticResources = [
    ".js",
    ".css",
    ".svg",
    ".ico",
    ".png",
    ".jpg",
    ".gif",
  ];
  const boardScopedRoutes = new Set(["boards", "preview", "download"]);
  if (
    !staticResources.includes(fileExt) &&
    !boardScopedRoutes.has(parts[0] || "")
  ) {
    jwtauth.checkUserPermission(parsedUrl);
  }

  switch (parts[0]) {
    case "boards": {
      requestContext.setRoute(
        parts.length === 1 ? "boards_redirect" : "board_page",
      );
      if (parts.length === 1) {
        const boardName = validateBoardQuery(
          parsedUrl.searchParams.get("board") || "anonymous",
        );
        if (boardName === null) {
          throw badRequest("invalid_board_name");
        }
        requestContext.annotate({ board: boardName });
        requestContext.setTraceAttributes({ board: boardName });
        jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
        const headers = { Location: `boards/${encodeURIComponent(boardName)}` };
        response.writeHead(301, headers);
        response.end();
      } else if (parts.length === 2 && parsedUrl.pathname.indexOf(".") === -1) {
        const boardName = validateBoardPath(getPathPart(parts, 1));
        if (boardName === null) {
          throw badRequest("invalid_board_name");
        }
        requestContext.annotate({ board: boardName });
        requestContext.setTraceAttributes({ board: boardName });
        jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
        const token = parsedUrl.searchParams.get("token");
        const boardRole = jwtBoardName.roleInBoard(token || "", boardName);
        const boardMetadata = BoardData.loadMetadataSync(boardName);
        const canWrite =
          !boardMetadata.readonly ||
          (config.AUTH_SECRET_KEY &&
            ["editor", "moderator"].includes(boardRole));
        boardTemplate.serve(request, response, boardRole === "moderator", {
          boardState: {
            readonly: boardMetadata.readonly,
            canWrite,
          },
        });
      } else {
        requestContext.setRoute("static_file");
        request.url = `/${parts.slice(1).join("/")}`;
        fileserver(
          request,
          response,
          serveError(request, response, requestContext),
        );
      }
      break;
    }

    case "download": {
      requestContext.setRoute("download_board");
      const boardName = validateBoardPath(getPathPart(parts, 1));
      if (boardName === null) {
        throw badRequest("invalid_board_name");
      }
      requestContext.annotate({ board: boardName });
      requestContext.setTraceAttributes({ board: boardName });
      let historyFile = path.join(
        config.HISTORY_DIR,
        `board-${encodeURIComponent(boardName)}.json`,
      );
      jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
      const backupSuffix = getPathPart(parts, 2);
      if (backupSuffix && /^[0-9A-Za-z.-]+$/.test(backupSuffix)) {
        historyFile += `.${backupSuffix}.bak`;
      }
      Promise.resolve(
        tracing.withActiveSpan(
          "board.download_read",
          {
            attributes: {
              "wbo.board": boardName,
              "wbo.board.operation": "download_read",
            },
          },
          function readBoardDownload() {
            return fs.promises.readFile(historyFile);
          },
        ),
      )
        .then((data) => {
          response.writeHead(200, {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${boardName}.wbo"`,
            "Content-Length": data.length,
          });
          response.end(data);
        })
        .catch(serveError(request, response, requestContext));
      break;
    }

    case "export":
    case "preview": {
      requestContext.setRoute("preview_board");
      const exportBoardName = validateBoardPath(getPathPart(parts, 1));
      if (exportBoardName === null) {
        throw badRequest("invalid_board_name");
      }
      requestContext.annotate({ board: exportBoardName });
      requestContext.setTraceAttributes({ board: exportBoardName });
      const historyFile = path.join(
        config.HISTORY_DIR,
        `board-${encodeURIComponent(exportBoardName)}.json`,
      );
      jwtBoardName.checkBoardnameInToken(parsedUrl, exportBoardName);
      const startedAt = Date.now();
      Promise.resolve(
        tracing.withActiveSpan(
          "preview.render",
          {
            attributes: {
              "wbo.board": exportBoardName,
              "wbo.board.operation": "preview_render",
            },
          },
          async function renderPreview() {
            try {
              return await createSVG.renderBoardToSVG(historyFile);
            } catch (err) {
              if (isNotFoundError(err)) {
                tracing.setActiveSpanAttributes({
                  "wbo.board": exportBoardName,
                  "wbo.board.operation": "preview_render",
                  "wbo.board.result": "not_found",
                });
                return null;
              }
              throw err;
            }
          },
        ),
      )
        .then((svg) => {
          const renderDurationMs = Date.now() - startedAt;
          requestContext.annotate({
            render_duration_ms: renderDurationMs,
          });
          requestContext.setTraceAttributes({
            render_duration_ms: renderDurationMs,
          });
          if (svg === null) {
            response.writeHead(404, {
              "Content-Length": errorPage.length,
            });
            response.end(errorPage);
            return;
          }
          response.writeHead(200, {
            "Content-Type": "image/svg+xml",
            "Content-Security-Policy": CSP,
            "Cache-Control": cacheControl("public, max-age=30"),
          });
          response.end(svg);
        })
        .catch((err) => {
          requestContext.noteError(err);
          requestContext.annotate({
            render_duration_ms: Date.now() - startedAt,
          });
          requestContext.setTraceAttributes({
            render_duration_ms: Date.now() - startedAt,
          });
          serveError(request, response, requestContext)(err);
        });
      break;
    }

    case "random": {
      requestContext.setRoute("random_board");
      const name = crypto.randomBytes(24).toString("base64url");
      response.writeHead(307, { Location: `boards/${name}` });
      response.end(name);
      break;
    }

    case "": {
      requestContext.setRoute("index");
      if (config.DEFAULT_BOARD) {
        requestContext.annotate({ board: config.DEFAULT_BOARD });
        requestContext.setTraceAttributes({ board: config.DEFAULT_BOARD });
        response.writeHead(302, {
          Location: `boards/${encodeURIComponent(config.DEFAULT_BOARD)}`,
        });
        response.end(config.DEFAULT_BOARD);
      } else {
        indexTemplate.serve(request, response);
      }
      break;
    }

    default:
      requestContext.setRoute("static_file");
      fileserver(
        request,
        response,
        serveError(request, response, requestContext),
      );
  }
}

export default app;
