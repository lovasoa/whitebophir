const crypto = require("node:crypto");
const fs = require("node:fs");
const { createServer } = require("node:http");
const path = require("node:path");
const serveStatic = require("serve-static");

const { BoardData } = require("./boardData.js");
const check_output_directory = require("./check_output_directory.js");
const config = require("./configuration.js");
const createSVG = require("./createSVG.js");
const jwtauth = require("./jwtauth.js");
const jwtBoardName = require("./jwtBoardnameAuth.js");
const {
  ATTR_CLIENT_ADDRESS,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_PATH,
  ATTR_URL_SCHEME,
} = require("@opentelemetry/semantic-conventions");
const {
  createRequestId,
  logger,
  metrics,
  tracing,
} = require("./observability.js");
const sockets = require("./sockets.js");
const templating = require("./templating.js");

/** @typedef {import("http").IncomingMessage} HttpRequest */
/** @typedef {import("http").ServerResponse} HttpResponse */
/** @typedef {import("node:net").AddressInfo | string | null} ServerAddress */

const app = createServer(handler);

check_output_directory(config.HISTORY_DIR);

sockets.start(app);

app.listen(config.PORT, config.HOST, () => {
  const actualPort = getAddressPort(app.address());
  logger.info("server.started", {
    [ATTR_SERVER_PORT]: actualPort,
  });
  if (process.send) process.send({ type: "server-started", port: actualPort });
});

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

const fileserver = serveStatic(config.WEBROOT, {
  maxAge: 2 * 3600 * 1000,
  /** @param {HttpResponse} res */
  setHeaders: (res) => {
    res.setHeader("Content-Security-Policy", CSP);
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
  return new URL(request.url || "/", "http://wbo/").pathname;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorToString(error) {
  return error instanceof Error ? error.toString() : String(error);
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
  const parsedUrl = new URL(requestUrl || "/", "http://wbo/");
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
        const routeTemplate = requestRouteTemplate(route);
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
          durationMs: durationMs,
        });
        const logTarget = classifyRequestLog(route, statusCode, durationMs);
        if (!logTarget) {
          if (requestSpan) requestSpan.end();
          return;
        }

        const fields = Object.assign(
          {
            request_id: requestId,
            [ATTR_HTTP_REQUEST_METHOD]: method,
            [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
            duration_ms: durationMs,
            [ATTR_URL_PATH]: requestPath(request),
          },
          routeTemplate ? { [ATTR_HTTP_ROUTE]: routeTemplate } : {},
          logFields,
        );
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
      logFields = Object.assign(logFields, fields);
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
 * @param {{noteError: (error: unknown) => void}} requestContext
 * @returns {(err?: unknown) => void}
 */
function serveError(request, response, requestContext) {
  void request;
  return (err) => {
    if (err) requestContext.noteError(err);
    response.writeHead(err ? 500 : 404, { "Content-Length": errorPage.length });
    response.end(errorPage);
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
      requestContext.noteError(err);
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(errorToString(err));
    }
  });
}

/**
 * Throws an error if the given board name is not allowed
 * @param {string} boardName
 * @throws {Error}
 */
function validateBoardName(boardName) {
  if (/^[\w%\-_~()]*$/.test(boardName)) return boardName;
  throw new Error(`Illegal board name: ${boardName}`);
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
  const requestUrl = request.url || "/";
  const parsedUrl = new URL(requestUrl, "http://wbo/");
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
  if (!staticResources.includes(fileExt)) {
    jwtauth.checkUserPermission(parsedUrl);
  }

  switch (parts[0]) {
    case "boards": {
      requestContext.setRoute(
        parts.length === 1 ? "boards_redirect" : "board_page",
      );
      if (parts.length === 1) {
        const boardName = parsedUrl.searchParams.get("board") || "anonymous";
        requestContext.annotate({ board: boardName });
        requestContext.setTraceAttributes({ board: boardName });
        jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
        const headers = { Location: `boards/${encodeURIComponent(boardName)}` };
        response.writeHead(301, headers);
        response.end();
      } else if (parts.length === 2 && parsedUrl.pathname.indexOf(".") === -1) {
        const boardNamePart = getPathPart(parts, 1);
        if (boardNamePart === undefined) {
          return serveError(request, response, requestContext)();
        }
        const boardName = validateBoardName(boardNamePart);
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
      const boardNamePart = getPathPart(parts, 1);
      if (boardNamePart === undefined) {
        return serveError(request, response, requestContext)();
      }
      const boardName = validateBoardName(boardNamePart);
      requestContext.annotate({ board: boardName });
      requestContext.setTraceAttributes({ board: boardName });
      let historyFile = path.join(
        config.HISTORY_DIR,
        `board-${boardName}.json`,
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
      const boardNamePart = getPathPart(parts, 1);
      if (boardNamePart === undefined) {
        return serveError(request, response, requestContext)();
      }
      const exportBoardName = validateBoardName(boardNamePart);
      requestContext.annotate({ board: exportBoardName });
      requestContext.setTraceAttributes({ board: exportBoardName });
      const historyFile = path.join(
        config.HISTORY_DIR,
        `board-${exportBoardName}.json`,
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
          function renderPreview() {
            return createSVG.renderBoardToSVG(historyFile);
          },
        ),
      )
        .then((svg) => {
          response.writeHead(200, {
            "Content-Type": "image/svg+xml",
            "Content-Security-Policy": CSP,
            "Cache-Control": "public, max-age=30",
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

module.exports = app;
