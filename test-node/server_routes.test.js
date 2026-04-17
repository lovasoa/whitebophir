const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const jsonwebtoken = require("jsonwebtoken");

const {
  closeServer,
  getTcpAddress,
  request,
  requestRaw,
  waitForListening,
  withEnv,
} = require("./test_helpers.js");

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

/**
 * @param {import("http").IncomingHttpHeaders} headers
 * @returns {string}
 */
function getSingleSetCookie(headers) {
  const value = headers["set-cookie"];
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

test("server returns 400 for preview and download routes without a board name", async () => {
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

      assert.equal(preview.statusCode, 400);
      assert.equal(download.statusCode, 400);
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

test("server returns 404 instead of 500 when preview board data is missing", async () => {
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

      assert.equal(response.statusCode, 404);
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

test("server rejects invalid board names with 400 instead of 500", async () => {
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
      const invalidPaths = [
        "/boards?board=test:board",
        "/boards/test:board",
        "/boards/test%3Aboard",
        "/preview/test:board",
        "/download/test%3Aboard",
      ];

      for (const invalidPath of invalidPaths) {
        const response = await request(app, invalidPath);
        assert.equal(response.statusCode, 400, invalidPath);
        assert.equal(typeof response.headers["x-request-id"], "string");
        assert.equal(response.body, "error-page");
      }
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

test("board pages set an httpOnly user secret cookie when missing", async () => {
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
      const response = await request(app, "/boards/demo");
      const setCookie = getSingleSetCookie(response.headers);

      assert.equal(response.statusCode, 200);
      assert.match(
        setCookie,
        /^wbo-user-secret-v1=[0-9a-f]{32}; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax$/,
      );
      assert.doesNotMatch(setCookie, /;\s*Secure(?:;|$)/);
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

test("board pages preserve a valid incoming user secret cookie and do not rotate it", async () => {
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
      const response = await request(app, "/boards/demo", {
        cookie: "wbo-user-secret-v1=abababababababababababababababab",
        "x-forwarded-proto": "https",
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["set-cookie"], undefined);
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

test("board pages mark the user secret cookie secure on https requests", async () => {
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
      const response = await request(app, "/boards/demo", {
        "x-forwarded-proto": "https",
      });
      const setCookie = getSingleSetCookie(response.headers);

      assert.equal(response.statusCode, 200);
      assert.match(setCookie, /;\s*Secure(?:;|$)/);
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
      const response = await request(app, "/", { "X-Request-Id": "req-123" });
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

test("server rejects malformed double-slash request targets with 400", async () => {
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
      const { port } = getTcpAddress(app);
      const rawResponse = await requestRaw(
        app,
        `GET // HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );

      assert.match(rawResponse, /^HTTP\/1\.1 400 Bad Request/m);
      assert.match(rawResponse, /^X-Request-Id: .+/m);
      assert.match(rawResponse, /\r\n\r\nerror-page$/m);
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

test("server returns 400 for malformed low-level HTTP parser input", async () => {
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
      const rawResponse = await requestRaw(
        app,
        "G\0T / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
      );

      assert.match(rawResponse, /^HTTP\/1\.1 400 Bad Request/m);
      assert.match(rawResponse, /\r\n\r\nBad Request$/m);
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

test("board-scoped JWTs can access their authorized board pages", async () => {
  const dirs = await createServerDirs();
  const authSecret = "test-secret";
  const boardReaderToken = jsonwebtoken.sign(
    { sub: "reader", roles: ["reader:readonly-test"] },
    authSecret,
  );
  const boardEditorToken = jsonwebtoken.sign(
    { sub: "editor", roles: ["editor:testboard"] },
    authSecret,
  );

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: authSecret,
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: CLIENT_WEBROOT,
    WBO_SILENT: "true",
  }, async () => {
    const { default: app } = await loadServer();
    await waitForListening(app);
    try {
      const readonlyResponse = await request(
        app,
        `/boards/readonly-test?token=${encodeURIComponent(boardReaderToken)}`,
      );
      const editorResponse = await request(
        app,
        `/boards/testboard?token=${encodeURIComponent(boardEditorToken)}`,
      );

      assert.equal(readonlyResponse.statusCode, 200);
      assert.equal(editorResponse.statusCode, 200);
      assert.match(readonlyResponse.body, /toolID-Hand/);
      assert.match(editorResponse.body, /id="menu"/);
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
