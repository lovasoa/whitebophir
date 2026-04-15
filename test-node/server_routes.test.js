const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");

const { withEnv } = require("./test_helpers.js");

const SERVER_PATH = path.join(__dirname, "..", "server", "server.mjs");
const TEMPLATING_PATH = path.join(__dirname, "..", "server", "templating.mjs");
const CREATE_SVG_PATH = path.join(__dirname, "..", "server", "createSVG.mjs");
const CONFIGURATION_PATH = path.join(
  __dirname,
  "..",
  "server",
  "configuration.mjs",
);
const CHECK_OUTPUT_DIRECTORY_PATH = path.join(
  __dirname,
  "..",
  "server",
  "check_output_directory.mjs",
);
const CLIENT_CONFIGURATION_PATH = path.join(
  __dirname,
  "..",
  "server",
  "client_configuration.mjs",
);
const CLIENT_WEBROOT = path.join(__dirname, "..", "client-data");
const JWTAUTH_PATH = path.join(__dirname, "..", "server", "jwtauth.mjs");
const PACKAGE_PATH = path.join(__dirname, "..", "package.json");
let serverLoadSequence = 0;

/**
 * @returns {Promise<{default: import("http").Server}>}
 */
async function loadServer() {
  return import(
    `${pathToFileURL(SERVER_PATH).href}?cache-bust=${++serverLoadSequence}`
  );
}

/**
 * @param {import("http").Server} server
 * @returns {Promise<void>}
 */
function waitForListening(server) {
  return new Promise((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
}

/**
 * @param {import("http").Server} server
 * @returns {Promise<void>}
 */
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
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
  return new Promise((resolve, reject) => {
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
      (response) => {
        /** @type {string[]} */
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
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

test("server returns 404 for preview and download routes without a board name", async () => {
  const dirs = await createServerDirs();

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: dirs.webroot,
    WBO_SILENT: "true",
  }, async () => {
    const { default: app } = await loadServer();
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
  }, [
    SERVER_PATH,
    TEMPLATING_PATH,
    CONFIGURATION_PATH,
    CREATE_SVG_PATH,
    CHECK_OUTPUT_DIRECTORY_PATH,
    CLIENT_CONFIGURATION_PATH,
    JWTAUTH_PATH,
  ]);
});

test("server returns an error status instead of 200 when preview rendering fails", async () => {
  const dirs = await createServerDirs();

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: dirs.webroot,
    WBO_SILENT: "true",
  }, async () => {
    const { default: app } = await loadServer();
    await waitForListening(app);
    try {
      const response = await request(app, "/preview/missing-board");

      assert.equal(response.statusCode, 500);
      assert.equal(typeof response.headers["x-request-id"], "string");
      assert.equal(response.body, "error-page");
    } finally {
      await closeServer(app);
    }
  }, [
    SERVER_PATH,
    TEMPLATING_PATH,
    CONFIGURATION_PATH,
    CREATE_SVG_PATH,
    CHECK_OUTPUT_DIRECTORY_PATH,
    CLIENT_CONFIGURATION_PATH,
    JWTAUTH_PATH,
  ]);
});

test("server preserves an incoming request id header", async () => {
  const dirs = await createServerDirs();

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: dirs.webroot,
    WBO_SILENT: "true",
  }, async () => {
    const { default: app } = await loadServer();
    await waitForListening(app);
    try {
      const address = app.address();
      if (!address || typeof address === "string") {
        throw new Error("Server is not listening on a TCP port");
      }

      const response = await new Promise((resolve, reject) => {
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
      await new Promise((resolve) => {
        response.on("end", resolve);
      });
      assert.equal(response.headers["x-request-id"], "req-123");
    } finally {
      await closeServer(app);
    }
  }, [
    SERVER_PATH,
    TEMPLATING_PATH,
    CONFIGURATION_PATH,
    CREATE_SVG_PATH,
    CHECK_OUTPUT_DIRECTORY_PATH,
    CLIENT_CONFIGURATION_PATH,
    JWTAUTH_PATH,
  ]);
});

test("board pages are no-store in development and render versioned asset URLs", async () => {
  const dirs = await createServerDirs();
  const packageJson = JSON.parse(await fs.readFile(PACKAGE_PATH, "utf8"));

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: CLIENT_WEBROOT,
    WBO_SILENT: "true",
  }, async () => {
    const { default: app } = await loadServer();
    await waitForListening(app);
    try {
      const response = await request(app, "/boards/cache-test");

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.match(
        response.body,
        new RegExp(`\\.\\./board\\.css\\?v=${packageJson.version}`),
      );
      assert.match(
        response.body,
        new RegExp(`\\.\\./js/board_main\\.js\\?v=${packageJson.version}`),
      );
      assert.match(
        response.body,
        new RegExp(
          `\\.\\./tools/pencil/icon\\.svg\\?v(?:=|&#x3D;)${packageJson.version}`,
        ),
      );
    } finally {
      await closeServer(app);
    }
  }, [
    SERVER_PATH,
    TEMPLATING_PATH,
    CONFIGURATION_PATH,
    CREATE_SVG_PATH,
    CHECK_OUTPUT_DIRECTORY_PATH,
    CLIENT_CONFIGURATION_PATH,
    JWTAUTH_PATH,
  ]);
});

test("static assets are no-store in development and cache correctly in production", async () => {
  const dirs = await createServerDirs();
  const packageJson = JSON.parse(await fs.readFile(PACKAGE_PATH, "utf8"));

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: CLIENT_WEBROOT,
    WBO_SILENT: "true",
  }, async () => {
    const { default: app } = await loadServer();
    await waitForListening(app);
    try {
      const response = await request(app, "/board.css");

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["cache-control"], "no-store");
    } finally {
      await closeServer(app);
    }
  }, [
    SERVER_PATH,
    TEMPLATING_PATH,
    CONFIGURATION_PATH,
    CREATE_SVG_PATH,
    CHECK_OUTPUT_DIRECTORY_PATH,
    CLIENT_CONFIGURATION_PATH,
    JWTAUTH_PATH,
  ]);

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    NODE_ENV: "production",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: CLIENT_WEBROOT,
    WBO_SILENT: "true",
  }, async () => {
    const { default: app } = await loadServer();
    await waitForListening(app);
    try {
      const response = await request(app, "/board.css");

      assert.equal(response.statusCode, 200);
      assert.match(
        String(response.headers["cache-control"] || ""),
        /max-age=7200/,
      );

      const immutableResponse = await request(
        app,
        `/board.css?v=${encodeURIComponent(packageJson.version)}`,
      );
      assert.equal(immutableResponse.statusCode, 200);
      assert.equal(
        immutableResponse.headers["cache-control"],
        "public, max-age=31536000, immutable",
      );
    } finally {
      await closeServer(app);
    }
  }, [
    SERVER_PATH,
    TEMPLATING_PATH,
    CONFIGURATION_PATH,
    CREATE_SVG_PATH,
    CHECK_OUTPUT_DIRECTORY_PATH,
    CLIENT_CONFIGURATION_PATH,
    JWTAUTH_PATH,
  ]);
});
