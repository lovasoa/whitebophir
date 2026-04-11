const fsp = require("node:fs/promises");
const { spawn } = require("node:child_process");
const jsonwebtoken = require("jsonwebtoken");
const os = require("node:os");
const path = require("node:path");

const AUTH_SECRET = "test";
const DEFAULT_FORWARDED_IP = "198.51.100.10";

const TOKENS = {
  globalModerator: jsonwebtoken.sign({ sub: "moderator", roles: ["moderator"] }, AUTH_SECRET),
  boardModeratorTestboard: jsonwebtoken.sign({ sub: "moderator-board", roles: ["moderator:testboard"] }, AUTH_SECRET),
  globalEditor: jsonwebtoken.sign({ sub: "editor", roles: ["editor"] }, AUTH_SECRET),
  boardEditorTestboard: jsonwebtoken.sign({ sub: "editor-board", roles: ["editor:testboard"] }, AUTH_SECRET),
  readOnlyViewer: jsonwebtoken.sign({ sub: "viewer", roles: ["reader:readonly-test"] }, AUTH_SECRET),
  readOnlyGlobalEditor: jsonwebtoken.sign({ sub: "readonly-editor", roles: ["editor"] }, AUTH_SECRET),
  readOnlyBoardEditor: jsonwebtoken.sign({ sub: "readonly-board-editor", roles: ["editor:readonly-test"] }, AUTH_SECRET),
  readOnlyGlobalModerator: jsonwebtoken.sign({ sub: "readonly-moderator", roles: ["moderator"] }, AUTH_SECRET),
};

function withToken(url, token, tokenQuery) {
  const query = token ? "token=" + token : tokenQuery;
  if (!query) return url;
  return url + (url.includes("?") ? "&" : "?") + query;
}

function boardFile(dataPath, name) {
  return path.join(dataPath, "board-" + encodeURIComponent(name) + ".json");
}

async function writeBoard(dataPath, name, storedBoard) {
  await fsp.writeFile(boardFile(dataPath, name), JSON.stringify(storedBoard));
}

function rootUrl(serverUrl, token, tokenQuery) {
  return withToken(serverUrl + "/", token, tokenQuery);
}

function seedSocketHeaders(browser, serverUrl, headers, token, tokenQuery) {
  return browser.url(rootUrl(serverUrl, token, tokenQuery)).execute(
    function (socketHeaders) {
      window.socketio_extra_headers = socketHeaders;
      sessionStorage.setItem("socketio_extra_headers", JSON.stringify(socketHeaders));
    },
    [headers],
  );
}

async function setup(browser, options = {}) {
  const dataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "wbo-test-data-"));
  const useJWT = options.useJWT || !!browser.globals.token;

  const env = {
    ...process.env,
    PORT: "0",
    WBO_HISTORY_DIR: dataPath,
    WBO_MAX_EMIT_COUNT: "1000",
    WBO_MAX_EMIT_COUNT_PERIOD: "4096",
    WBO_IP_SOURCE: "X-Forwarded-For",
    WBO_SILENT: "true",
  };

  let tokenQuery = "";
  if (useJWT) {
    const token = options.token || browser.globals.token || TOKENS.globalEditor;
    env["AUTH_SECRET_KEY"] = AUTH_SECRET;
    tokenQuery = "token=" + token;
  } else {
    delete env["AUTH_SECRET_KEY"];
  }

  const serverPath = path.resolve(__dirname, "..", "..", "server", "server.js");
  const child = spawn("node", [serverPath], { 
    env,
    stdio: ["inherit", "pipe", "pipe", "ipc"] 
  });

  browser.currentTestServerErrors = [];

  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Server failed to start within 10s. Output: " + output));
    }, 10000);

    const onServerStarted = (port) => {
      clearTimeout(timeout);
      const serverUrl = `http://localhost:${port}`;
      resolve({ child, dataPath, serverUrl, tokenQuery });
    };

    child.on("message", (msg) => {
      if (msg.type === "server-started") {
        onServerStarted(msg.port);
      }
    });

    child.stdout.on("data", (data) => {
      const line = data.toString();
      output += line;
      if (line.includes("server started")) {
        const match = line.match(/server started\s+({.*})/);
        if (match) {
          const config = JSON.parse(match[1]);
          if (config.port !== 0) onServerStarted(config.port);
        }
      }
    });

    child.stderr.on("data", (data) => {
      if (!child.killed) browser.currentTestServerErrors.push(data.toString());
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function teardown(child, done, browser) {
  if (browser && browser.currentTest && browser.currentTest.results && browser.currentTest.results.failed > 0) {
    if (browser.currentTestServerErrors && browser.currentTestServerErrors.length > 0) {
      process.stderr.write("\n--- SERVER ERRORS DURING FAILED TEST ---\n");
      browser.currentTestServerErrors.forEach(err => process.stderr.write(err));
      process.stderr.write("----------------------------------------\n");
    }
  }

  if (child) {
    if (child.connected) {
      child.on("exit", () => done());
      child.kill();
    } else {
      done();
    }
  } else {
    done();
  }
}

module.exports = {
  TOKENS,
  AUTH_SECRET,
  DEFAULT_FORWARDED_IP,
  withToken,
  boardFile,
  writeBoard,
  rootUrl,
  seedSocketHeaders,
  setup,
  teardown,
};
