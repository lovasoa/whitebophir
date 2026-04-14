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
const { createRequestId, logger, metrics } = require("./observability.js");
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
    port: actualPort,
  });
  if (process.send) process.send({ type: "server-started", port: actualPort });
});

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

const fileserver = serveStatic(config.WEBROOT, {
  maxAge: 2 * 3600 * 1000,
  /** @param {HttpResponse} res */
  setHeaders: function (res) {
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
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @returns {{
 *   requestId: string,
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
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
  let route = "unknown";
  /** @type {unknown} */
  let requestError;
  /** @type {{[key: string]: unknown}} */
  let logFields = {};
  let finalized = false;

  function finalize() {
    if (finalized) return;
    finalized = true;

    const statusCode = response.statusCode || 200;
    const durationMs = Date.now() - startedAt;

    metrics.recordHttpRequest({
      method: request.method || "GET",
      route: route,
      statusCode: statusCode,
      durationMs: durationMs,
    });
    const logTarget = classifyRequestLog(route, statusCode, durationMs);
    if (!logTarget) return;

    const fields = Object.assign(
      {
        request_id: requestId,
        method: request.method || "GET",
        route: route,
        status_code: statusCode,
        duration_ms: durationMs,
        url: request.url,
      },
      logFields,
    );
    if (statusCode >= 400) {
      fields.ip = request.socket.remoteAddress;
    }
    if (requestError) fields.error = requestError;
    logger[logTarget.level](logTarget.event, fields);
  }

  response.once("finish", finalize);
  response.once("close", finalize);

  return {
    requestId: requestId,
    setRoute: function setRoute(nextRoute) {
      route = nextRoute;
    },
    noteError: function noteError(error) {
      requestError = error;
    },
    annotate: function annotate(fields) {
      logFields = Object.assign(logFields, fields);
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
  return function (err) {
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
  try {
    handleRequest(request, response, requestContext);
  } catch (err) {
    requestContext.noteError(err);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(errorToString(err));
  }
}

/**
 * Throws an error if the given board name is not allowed
 * @param {string} boardName
 * @throws {Error}
 */
function validateBoardName(boardName) {
  if (/^[\w%\-_~()]*$/.test(boardName)) return boardName;
  throw new Error("Illegal board name: " + boardName);
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
        jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
        const headers = { Location: "boards/" + encodeURIComponent(boardName) };
        response.writeHead(301, headers);
        response.end();
      } else if (parts.length === 2 && parsedUrl.pathname.indexOf(".") === -1) {
        const boardNamePart = getPathPart(parts, 1);
        if (boardNamePart === undefined) {
          return serveError(request, response, requestContext)();
        }
        const boardName = validateBoardName(boardNamePart);
        requestContext.annotate({ board: boardName });
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
        request.url = "/" + parts.slice(1).join("/");
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
      let historyFile = path.join(
        config.HISTORY_DIR,
        "board-" + boardName + ".json",
      );
      jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
      const backupSuffix = getPathPart(parts, 2);
      if (backupSuffix && /^[0-9A-Za-z.\-]+$/.test(backupSuffix)) {
        historyFile += "." + backupSuffix + ".bak";
      }
      fs.readFile(historyFile, function (err, data) {
        if (err) return serveError(request, response, requestContext)(err);
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="' + boardName + '.wbo"',
          "Content-Length": data.length,
        });
        response.end(data);
      });
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
      const historyFile = path.join(
        config.HISTORY_DIR,
        "board-" + exportBoardName + ".json",
      );
      jwtBoardName.checkBoardnameInToken(parsedUrl, exportBoardName);
      const startedAt = Date.now();
      createSVG
        .renderBoardToSVG(historyFile)
        .then(function (svg) {
          response.writeHead(200, {
            "Content-Type": "image/svg+xml",
            "Content-Security-Policy": CSP,
            "Cache-Control": "public, max-age=30",
          });
          response.end(svg);
        })
        .catch(function (err) {
          requestContext.noteError(err);
          requestContext.annotate({
            render_duration_ms: Date.now() - startedAt,
          });
          serveError(request, response, requestContext)(err);
        });
      break;
    }

    case "random": {
      requestContext.setRoute("random_board");
      const name = crypto.randomBytes(24).toString("base64url");
      response.writeHead(307, { Location: "boards/" + name });
      response.end(name);
      break;
    }

    case "": {
      requestContext.setRoute("index");
      if (config.DEFAULT_BOARD) {
        requestContext.annotate({ board: config.DEFAULT_BOARD });
        response.writeHead(302, {
          Location: "boards/" + encodeURIComponent(config.DEFAULT_BOARD),
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
