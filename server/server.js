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
const { log, monitorFunction } = require("./log.js");
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
  log("server started", { port: actualPort });
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
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorStack(error) {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @returns {(err?: unknown) => void}
 */
function serveError(request, response) {
  return function (err) {
    log("error", { error: err ? errorToString(err) : undefined, url: request.url });
    response.writeHead(err ? 500 : 404, { "Content-Length": errorPage.length });
    response.end(errorPage);
  };
}

/**
 * Write a request to the logs
 * @param {import("http").IncomingMessage} request
 */
function logRequest(request) {
  log("connection", {
    ip: request.socket.remoteAddress,
    original_ip:
      request.headers["x-forwarded-for"] || request.headers["forwarded"],
    user_agent: request.headers["user-agent"],
    referer: request.headers["referer"],
    language: request.headers["accept-language"],
    url: request.url,
  });
}

/**
 * @type {import('http').RequestListener}
 */
function handler(request, response) {
  try {
    handleRequestAndLog(request, response);
  } catch (err) {
    const message = errorMessage(err);
    if (
      config.AUTH_SECRET_KEY &&
      (message.includes("Access Forbidden") ||
        message.includes("Illegal board name"))
    ) {
      log("error", { error: message, url: request.url });
    } else {
      console.trace(err);
    }
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(errorToString(err));
  }
}

const boardTemplate = new templating.BoardTemplate(
  path.join(config.WEBROOT, "board.html"),
);
const indexTemplate = new templating.Template(
  path.join(config.WEBROOT, "index.html"),
);

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
 * @type {import('http').RequestListener}
 */
function handleRequest(request, response) {
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
  // If we're not being asked for a file, then we should check permissions.
  if (!staticResources.includes(fileExt)) {
    jwtauth.checkUserPermission(parsedUrl);
  }

  switch (parts[0]) {
    case "boards": {
      // "boards" refers to the root directory
      if (parts.length === 1) {
        // '/boards?board=...' This allows html forms to point to boards
        const boardName = parsedUrl.searchParams.get("board") || "anonymous";
        jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
        const headers = { Location: "boards/" + encodeURIComponent(boardName) };
        response.writeHead(301, headers);
        response.end();
      } else if (parts.length === 2 && parsedUrl.pathname.indexOf(".") === -1) {
        const boardNamePart = getPathPart(parts, 1);
        if (boardNamePart === undefined) return serveError(request, response)();
        const boardName = validateBoardName(boardNamePart);
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
        // If there is no dot and no directory, parts[1] is the board name
      } else {
        request.url = "/" + parts.slice(1).join("/");
        fileserver(request, response, serveError(request, response));
      }
      break;
    }

    case "download": {
      const boardNamePart = getPathPart(parts, 1);
      if (boardNamePart === undefined) return serveError(request, response)();
      const boardName = validateBoardName(boardNamePart);
      let historyFile = path.join(
        config.HISTORY_DIR,
        "board-" + boardName + ".json",
      );
      jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
      const backupSuffix = getPathPart(parts, 2);
      if (backupSuffix && /^[0-9A-Za-z.\-]+$/.test(backupSuffix)) {
        historyFile += "." + backupSuffix + ".bak";
      }
      log("download", { file: historyFile });
      fs.readFile(historyFile, function (err, data) {
        if (err) return serveError(request, response)(err);
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
      const boardNamePart = getPathPart(parts, 1);
      if (boardNamePart === undefined) return serveError(request, response)();
      const exportBoardName = validateBoardName(boardNamePart);
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
          log("preview", {
            board: exportBoardName,
            time: Date.now() - startedAt,
          });
          response.end(svg);
        })
        .catch(function (err) {
          log("error", { error: errorToString(err), stack: errorStack(err) });
          serveError(request, response)(err);
        });
      break;
    }

    case "random": {
      const name = crypto.randomBytes(24).toString("base64url");
      response.writeHead(307, { Location: "boards/" + name });
      response.end(name);
      break;
    }

    case "": // Index page
      logRequest(request);
      if (config.DEFAULT_BOARD) {
        response.writeHead(302, {
          Location: "boards/" + encodeURIComponent(config.DEFAULT_BOARD),
        });
        response.end(config.DEFAULT_BOARD);
      } else indexTemplate.serve(request, response);
      break;

    default:
      fileserver(request, response, serveError(request, response));
  }
}

const handleRequestAndLog = monitorFunction(handleRequest);
module.exports = app;
