const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { withEnv } = require("./test_helpers.js");

const SERVER_PATH = path.join(__dirname, "..", "server", "server.js");
const TEMPLATING_PATH = path.join(__dirname, "..", "server", "templating.js");
const CREATE_SVG_PATH = path.join(__dirname, "..", "server", "createSVG.js");
const CHECK_OUTPUT_DIRECTORY_PATH = path.join(
  __dirname,
  "..",
  "server",
  "check_output_directory.js",
);
const CLIENT_CONFIGURATION_PATH = path.join(
  __dirname,
  "..",
  "server",
  "client_configuration.js",
);
const JWTAUTH_PATH = path.join(__dirname, "..", "server", "jwtauth.js");

/**
 * @param {import("http").Server} server
 * @returns {Promise<void>}
 */
function waitForListening(server) {
  return new Promise(function (resolve) {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
}

/**
 * @param {import("http").Server} server
 * @returns {Promise<void>}
 */
function closeServer(server) {
  return new Promise(function (resolve, reject) {
    server.close(function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * @param {import("http").Server} server
 * @param {string} requestPath
 * @returns {Promise<{statusCode: number, headers: http.IncomingHttpHeaders, body: string}>}
 */
function request(server, requestPath) {
  return new Promise(function (resolve, reject) {
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("Server is not listening on a TCP port"));
      return;
    }
    const req = http.get(
      {
        host: "127.0.0.1",
        port: address.port,
        path: requestPath,
      },
      function (response) {
        /** @type {string[]} */
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", function (chunk) {
          chunks.push(chunk);
        });
        response.on("end", function () {
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body: chunks.join(""),
          });
        });
      },
    );
    req.on("error", reject);
  });
}

/**
 * @returns {Promise<{historyDir: string, webroot: string}>}
 */
async function createServerDirs() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wbo-server-routes-"));
  const historyDir = path.join(root, "history");
  const webroot = path.join(root, "webroot");
  await fs.mkdir(historyDir);
  await fs.mkdir(webroot);
  await fs.writeFile(path.join(webroot, "error.html"), "error-page", "utf8");
  await fs.writeFile(path.join(webroot, "board.html"), "board-page", "utf8");
  await fs.writeFile(path.join(webroot, "index.html"), "index-page", "utf8");
  return { historyDir, webroot };
}

test("server returns 404 for preview and download routes without a board name", async function () {
  const dirs = await createServerDirs();

  await withEnv(
    {
      HOST: "127.0.0.1",
      PORT: "0",
      AUTH_SECRET_KEY: "",
      WBO_HISTORY_DIR: dirs.historyDir,
      WBO_WEBROOT: dirs.webroot,
      WBO_SILENT: "true",
    },
    async function () {
      const app = require(SERVER_PATH);
      await waitForListening(app);
      try {
        const preview = await request(app, "/preview");
        const download = await request(app, "/download");

        assert.equal(preview.statusCode, 404);
        assert.equal(download.statusCode, 404);
        assert.equal(typeof preview.headers["x-request-id"], "string");
        assert.equal(typeof download.headers["x-request-id"], "string");
        assert.equal(preview.body, "error-page");
        assert.equal(download.body, "error-page");
      } finally {
        await closeServer(app);
      }
    },
    [
      SERVER_PATH,
      TEMPLATING_PATH,
      CREATE_SVG_PATH,
      CHECK_OUTPUT_DIRECTORY_PATH,
      CLIENT_CONFIGURATION_PATH,
      JWTAUTH_PATH,
    ],
  );
});

test("server returns an error status instead of 200 when preview rendering fails", async function () {
  const dirs = await createServerDirs();

  await withEnv(
    {
      HOST: "127.0.0.1",
      PORT: "0",
      AUTH_SECRET_KEY: "",
      WBO_HISTORY_DIR: dirs.historyDir,
      WBO_WEBROOT: dirs.webroot,
      WBO_SILENT: "true",
    },
    async function () {
      const app = require(SERVER_PATH);
      await waitForListening(app);
      try {
        const response = await request(app, "/preview/missing-board");

        assert.equal(response.statusCode, 500);
        assert.equal(typeof response.headers["x-request-id"], "string");
        assert.equal(response.body, "error-page");
      } finally {
        await closeServer(app);
      }
    },
    [
      SERVER_PATH,
      TEMPLATING_PATH,
      CREATE_SVG_PATH,
      CHECK_OUTPUT_DIRECTORY_PATH,
      CLIENT_CONFIGURATION_PATH,
      JWTAUTH_PATH,
    ],
  );
});

test("server preserves an incoming request id header", async function () {
  const dirs = await createServerDirs();

  await withEnv(
    {
      HOST: "127.0.0.1",
      PORT: "0",
      AUTH_SECRET_KEY: "",
      WBO_HISTORY_DIR: dirs.historyDir,
      WBO_WEBROOT: dirs.webroot,
      WBO_SILENT: "true",
    },
    async function () {
      const app = require(SERVER_PATH);
      await waitForListening(app);
      try {
        const address = app.address();
        if (!address || typeof address === "string") {
          throw new Error("Server is not listening on a TCP port");
        }

        const response = await new Promise(function (resolve, reject) {
          const req = http.get(
            {
              host: "127.0.0.1",
              port: address.port,
              path: "/",
              headers: { "X-Request-Id": "req-123" },
            },
            resolve,
          );
          req.on("error", reject);
        });

        response.resume();
        await new Promise(function (resolve) {
          response.on("end", resolve);
        });
        assert.equal(response.headers["x-request-id"], "req-123");
      } finally {
        await closeServer(app);
      }
    },
    [
      SERVER_PATH,
      TEMPLATING_PATH,
      CREATE_SVG_PATH,
      CHECK_OUTPUT_DIRECTORY_PATH,
      CLIENT_CONFIGURATION_PATH,
      JWTAUTH_PATH,
    ],
  );
});
