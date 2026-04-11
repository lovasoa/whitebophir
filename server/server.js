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

const app = createServer(handler);

check_output_directory(config.HISTORY_DIR);

sockets.start(app);

app.listen(config.PORT, config.HOST);
log("server started", { port: config.PORT });

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

const fileserver = serveStatic(config.WEBROOT, {
  maxAge: 2 * 3600 * 1000,
  setHeaders: function (res) {
    res.setHeader("Content-Security-Policy", CSP);
  },
});

const errorPage = fs.readFileSync(path.join(config.WEBROOT, "error.html"));
function serveError(request, response) {
  return function (err) {
    log("error", { error: err && err.toString(), url: request.url });
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
    console.trace(err);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(err.toString());
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
 * @type {import('http').RequestListener}
 */
function handleRequest(request, response) {
  const parsedUrl = new URL(request.url, "http://wbo/");
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
        const boardName = validateBoardName(parts[1]);
        jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
        const token = parsedUrl.searchParams.get("token");
        const boardRole = jwtBoardName.roleInBoard(token, boardName);
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
      const boardName = validateBoardName(parts[1]);
      let historyFile = path.join(
        config.HISTORY_DIR,
        "board-" + boardName + ".json",
      );
      jwtBoardName.checkBoardnameInToken(parsedUrl, boardName);
      if (parts.length > 2 && /^[0-9A-Za-z.\-]+$/.test(parts[2])) {
        historyFile += "." + parts[2] + ".bak";
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
      const exportBoardName = validateBoardName(parts[1]);
      const historyFile = path.join(
        config.HISTORY_DIR,
        "board-" + exportBoardName + ".json",
      );
      jwtBoardName.checkBoardnameInToken(parsedUrl, exportBoardName);
      response.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Content-Security-Policy": CSP,
        "Cache-Control": "public, max-age=30",
      });
      const startedAt = Date.now();
      createSVG
        .renderBoard(historyFile, response)
        .then(function () {
          log("preview", {
            board: exportBoardName,
            time: Date.now() - startedAt,
          });
          response.end();
        })
        .catch(function (err) {
          log("error", { error: err.toString(), stack: err.stack });
          response.end("<text>Sorry, an error occured</text>");
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
