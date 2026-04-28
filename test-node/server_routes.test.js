const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const jsonwebtoken = require("jsonwebtoken");

const {
  closeServer,
  createConfig,
  getTcpAddress,
  request,
  requestRaw,
  withEnv,
} = require("./test_helpers.js");

const SERVER_PATH = path.join(__dirname, "..", "server", "server.mjs");
const TEMPLATING_PATH = path.join(
  __dirname,
  "..",
  "server",
  "http",
  "templating.mjs",
);
const CREATE_SVG_PATH = path.join(
  __dirname,
  "..",
  "server",
  "persistence",
  "create_svg.mjs",
);
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
  "runtime",
  "check_output_directory.mjs",
);
const CLIENT_CONFIGURATION_PATH = path.join(
  __dirname,
  "..",
  "server",
  "http",
  "client_configuration.mjs",
);
const COMPRESSION_PATH = path.join(
  __dirname,
  "..",
  "server",
  "http",
  "compression.mjs",
);
const OBSERVABILITY_PATH = path.join(
  __dirname,
  "..",
  "server",
  "observability",
  "index.mjs",
);
const CLIENT_WEBROOT = path.join(__dirname, "..", "client-data");
const JWTAUTH_PATH = path.join(__dirname, "..", "server", "auth", "jwt.mjs");

/**
 * @returns {Promise<{createServerApp: (config: any, options?: any) => Promise<import("http").Server>}>}
 */
async function loadServer() {
  return require(SERVER_PATH);
}

/**
 * @param {{historyDir: string, webroot?: string}} dirs
 * @param {{[key: string]: any}=} overrides
 * @returns {any}
 */
function createServerConfig(dirs, overrides = {}) {
  return createConfig({
    HOST: "127.0.0.1",
    PORT: 0,
    AUTH_SECRET_KEY: "",
    HISTORY_DIR: dirs.historyDir,
    WEBROOT: dirs.webroot,
    ...overrides,
  });
}

/**
 * @param {{[key: string]: any}} [configOverrides]
 * @returns {Promise<import("http").Server>}
 */
async function createTestServer(configOverrides) {
  const { createServerApp } = await loadServer();
  return createServerApp(createConfig(configOverrides), {
    logStarted: false,
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

/**
 * @param {import("http").IncomingHttpHeaders} headers
 * @returns {string}
 */
function getSingleSetCookie(headers) {
  const value = headers["set-cookie"];
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

/**
 * @param {string} historyDir
 * @param {string} name
 * @returns {string}
 */
function boardSvgFile(historyDir, name) {
  return path.join(historyDir, `board-${name}.svg`);
}

/**
 * @param {string} body
 * @param {string} snippet
 * @returns {void}
 */
function assertSnippetBeforeHeadEnd(body, snippet) {
  const snippetIndex = body.indexOf(snippet);
  const headEndIndex = body.indexOf("</head>");
  assert.notEqual(snippetIndex, -1);
  assert.notEqual(headEndIndex, -1);
  assert.ok(snippetIndex < headEndIndex);
}

test("in-process server imports do not register process signal handlers", async () => {
  const dirs = await createServerDirs();
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: dirs.webroot,
    WBO_SILENT: "true",
  }, async () => {
    const app = await createTestServer();
    try {
      assert.equal(process.listenerCount("SIGINT"), sigintBefore);
      assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
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
    const app = await createTestServer();
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
    const app = await createTestServer();
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

test("board pages redirect non-canonical board names to canonical urls", async () => {
  const dirs = await createServerDirs();

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: dirs.webroot,
    WBO_SILENT: "true",
  }, async () => {
    const app = await createTestServer();
    try {
      const canonicalResponse = await request(
        app,
        "/boards/Refugee%20Camp%202?token=test-token",
      );
      assert.equal(canonicalResponse.statusCode, 301);
      assert.equal(typeof canonicalResponse.headers["x-request-id"], "string");
      assert.equal(
        canonicalResponse.headers.location,
        "/boards/refugee-camp-2?token=test-token",
      );

      const unicodeResponse = await request(
        app,
        "/boards/%D0%A2%D0%95%D0%A1%D0%A2",
      );
      assert.equal(unicodeResponse.statusCode, 301);
      assert.equal(typeof unicodeResponse.headers["x-request-id"], "string");
      assert.equal(
        unicodeResponse.headers.location,
        `/boards/${encodeURIComponent("тест")}`,
      );

      const emptyResponse = await request(app, "/boards/%3A%2F%3F%23");
      assert.equal(emptyResponse.statusCode, 400);
      assert.equal(typeof emptyResponse.headers["x-request-id"], "string");
      assert.equal(emptyResponse.body, "error-page");
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

test("server rejects invalid non-board-page board names with 400 instead of 500", async () => {
  const dirs = await createServerDirs();

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: dirs.webroot,
    WBO_SILENT: "true",
  }, async () => {
    const app = await createTestServer();
    try {
      const invalidPaths = [
        "/boards?board=test:board",
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

test("random route redirects to a canonical pronounceable board name", async () => {
  const dirs = await createServerDirs();

  await withEnv({
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_SECRET_KEY: "",
    WBO_HISTORY_DIR: dirs.historyDir,
    WBO_WEBROOT: dirs.webroot,
    WBO_SILENT: "true",
  }, async () => {
    const app = await createTestServer();
    try {
      const response = await request(app, "/random");
      assert.equal(response.statusCode, 307);
      assert.equal(typeof response.headers["x-request-id"], "string");
      assert.match(
        response.body,
        /^(?:[a-z]{4}|[a-z]{6})(?:-(?:[a-z]{4}|[a-z]{6})){3}$/,
      );
      assert.equal(response.headers.location, `/boards/${response.body}`);
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

test("index route canonicalizes configured default board redirects", async () => {
  const dirs = await createServerDirs();
  const app = await createTestServer({
    HISTORY_DIR: dirs.historyDir,
    WEBROOT: dirs.webroot,
    DEFAULT_BOARD: "Refugee Camp 2",
  });
  try {
    const response = await request(app, "/");
    assert.equal(response.statusCode, 302);
    assert.equal(typeof response.headers["x-request-id"], "string");
    assert.equal(response.headers.location, "/boards/refugee-camp-2");
    assert.equal(response.body, "refugee-camp-2");
  } finally {
    await closeServer(app);
  }
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
    const app = await createTestServer();
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
    const app = await createTestServer();
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
    const app = await createTestServer();
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
    const app = await createTestServer();
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
    const app = await createTestServer();
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
    const app = await createTestServer();
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

test("board pages are no-store in development and render plain asset URLs", async () => {
  const dirs = await createServerDirs();
  const app = await createTestServer(
    createServerConfig(dirs, { WEBROOT: CLIENT_WEBROOT, IS_DEVELOPMENT: true }),
  );
  try {
    const response = await request(app, "/boards/cache-test");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /\.\.\/board\.css(?:["'])/);
    assert.match(response.body, /\.\.\/js\/board_main\.js(?:["'])/);
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/app_tools\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_access_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_connection_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_message_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_optimistic_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_presence_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_replay_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_runtime_core\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_shell_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_status_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_tool_registry_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_viewport\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/board_write_module\.js"/,
    );
    assert.match(
      response.body,
      /rel="modulepreload" href="\.\.\/js\/path-data-polyfill\.js"/,
    );
    assert.match(response.body, /\.\.\/tools\/pencil\/icon\.svg(?:["'])/);
    assert.match(response.body, /\.\.\/users\.svg(?:["'])/);
    assert.match(response.body, /\.\.\/icon-size\.svg(?:["'])/);
    assert.doesNotMatch(response.body, /\?v=/);
  } finally {
    await closeServer(app);
  }
});

test("server inserts configured html head snippet into rendered html pages", async () => {
  const dirs = await createServerDirs();
  const snippetPath = path.join(dirs.webroot, "head-snippet.html");
  const snippet =
    '<script data-user-analytics>window.__wboTestAnalytics = "{{analyticsId}}";</script>';
  await fs.writeFile(snippetPath, snippet, "utf8");

  const app = await createTestServer(
    createServerConfig(dirs, {
      WEBROOT: CLIENT_WEBROOT,
      HTML_HEAD_SNIPPET_PATH: snippetPath,
    }),
  );
  try {
    await fs.writeFile(
      snippetPath,
      "<script data-user-analytics>window.__wboTestAnalytics = 'changed';</script>",
      "utf8",
    );

    const indexResponse = await request(app, "/");
    const boardResponse = await request(app, "/boards/head-snippet");
    const errorResponse = await request(app, "/preview");

    assert.equal(indexResponse.statusCode, 200);
    assert.equal(boardResponse.statusCode, 200);
    assert.equal(errorResponse.statusCode, 400);
    assertSnippetBeforeHeadEnd(indexResponse.body, snippet);
    assertSnippetBeforeHeadEnd(boardResponse.body, snippet);
    assertSnippetBeforeHeadEnd(errorResponse.body, snippet);
    assert.doesNotMatch(indexResponse.body, /changed/);
    assert.doesNotMatch(boardResponse.body, /changed/);
    assert.doesNotMatch(errorResponse.body, /changed/);
  } finally {
    await closeServer(app);
  }
});

test("server logs and skips missing configured html head snippet", async () => {
  const dirs = await createServerDirs();
  const missingSnippetPath = path.join(dirs.webroot, "missing-snippet.html");
  const observability = require("../server/observability/index.mjs");
  const originalError = observability.logger.error;
  /** @type {{name: string, fields: any}[]} */
  const errorLogs = [];
  /** @type {import("http").Server | undefined} */
  let app;
  observability.logger.error = (name, fields) => {
    errorLogs.push({ name, fields });
  };

  try {
    app = await createTestServer(
      createServerConfig(dirs, {
        WEBROOT: CLIENT_WEBROOT,
        HTML_HEAD_SNIPPET_PATH: missingSnippetPath,
      }),
    );
    const firstResponse = await request(app, "/");
    const secondResponse = await request(app, "/");

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.deepEqual(
      errorLogs.map((entry) => entry.name),
      ["html_head_snippet.read_failed"],
    );
    const errorLog = errorLogs[0];
    assert.ok(errorLog);
    assert.equal(errorLog.fields.path, missingSnippetPath);
  } finally {
    observability.logger.error = originalError;
    if (app) await closeServer(app);
  }
});

test("board pages use seq-based etag and return 304 on cache hit", async () => {
  const dirs = await createServerDirs();
  await fs.writeFile(
    boardSvgFile(dirs.historyDir, "etag-board"),
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="3" data-wbo-readonly="false"><defs id="defs"></defs><g id="drawingArea"><line id="line-1" x1="0" y1="0" x2="10" y2="20" stroke="#000000" stroke-width="2" fill="none"></line></g><g id="cursors"></g></svg>',
    "utf8",
  );

  const app = await createTestServer(
    createServerConfig(dirs, {
      WEBROOT: CLIENT_WEBROOT,
      IS_DEVELOPMENT: false,
    }),
  );
  try {
    const firstResponse = await request(app, "/boards/etag-board");

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(firstResponse.headers.etag, 'W/"wbo-seq-3"');

    const cachedResponse = await request(app, "/boards/etag-board", {
      "If-None-Match": firstResponse.headers.etag,
    });

    assert.equal(cachedResponse.statusCode, 304);
    assert.equal(cachedResponse.headers.etag, firstResponse.headers.etag);

    const staleResponse = await request(app, "/boards/etag-board", {
      "If-None-Match": 'W/"wbo-seq-2"',
    });

    assert.equal(staleResponse.statusCode, 200);
    assert.equal(staleResponse.headers.etag, 'W/"wbo-seq-3"');
  } finally {
    await closeServer(app);
  }
});

test("board pages inline the authoritative svg baseline before client boot", async () => {
  const dirs = await createServerDirs();
  await fs.writeFile(
    boardSvgFile(dirs.historyDir, "inline-baseline"),
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="7" data-wbo-readonly="true"><defs id="defs"></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"></g></svg>',
    "utf8",
  );

  const app = await createTestServer(
    createServerConfig(dirs, { WEBROOT: CLIENT_WEBROOT }),
  );
  try {
    const response = await request(app, "/boards/inline-baseline");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-length"], undefined);
    assert.ok(
      response.body.indexOf('id="loadingMessage"') <
        response.body.indexOf('<div id="board">'),
    );
    assert.ok(
      response.body.indexOf('id="menu"') <
        response.body.indexOf('<div id="board">'),
    );
    assert.ok(
      response.body.indexOf("window.__wboEarlyChrome") <
        response.body.indexOf('<div id="board">'),
    );
    assert.match(
      response.body,
      /<div id="board">\s*<svg id="canvas"[\s\S]*data-wbo-seq="7"[\s\S]*<rect id="rect-1"/,
    );
    assert.doesNotMatch(
      response.body,
      /<div id="board">\s*<svg id="canvas" width="4000" height="4000" version="1\.1" xmlns="http:\/\/www\.w3\.org\/2000\/svg">\s*<defs id="defs"><\/defs>\s*<g id="drawingArea"><\/g>\s*<g id="cursors"><\/g>\s*<\/svg>/,
    );
  } finally {
    await closeServer(app);
  }
});

test("board pages fall back to legacy json metadata and inline baseline rendering", async () => {
  const dirs = await createServerDirs();
  await fs.writeFile(
    path.join(dirs.historyDir, "board-legacy-inline.json"),
    JSON.stringify({
      __wbo_meta__: { readonly: true },
      "rect-1": {
        id: "rect-1",
        tool: "rectangle",
        type: "rect",
        x: 1,
        y: 2,
        x2: 30,
        y2: 40,
        color: "#123456",
        size: 4,
      },
    }),
    "utf8",
  );

  const app = await createTestServer(
    createServerConfig(dirs, { WEBROOT: CLIENT_WEBROOT }),
  );
  try {
    const response = await request(app, "/boards/legacy-inline");

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /toolID-hand/);
    assert.doesNotMatch(response.body, /toolID-pencil/);
    assert.match(
      response.body,
      /<div id="board">\s*<svg id="canvas"[\s\S]*data-wbo-readonly="true"[\s\S]*<rect id="rect-1"/,
    );
  } finally {
    await closeServer(app);
  }
});

test("canonical board svg endpoint serves the authoritative baseline with short cache headers", async () => {
  const dirs = await createServerDirs();
  await fs.writeFile(
    boardSvgFile(dirs.historyDir, "canonical-svg"),
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="3" data-wbo-readonly="false"><defs id="defs"></defs><g id="drawingArea"><line id="line-1" x1="0" y1="0" x2="10" y2="20" stroke="#000000" stroke-width="2" fill="none"></line></g><g id="cursors"></g></svg>',
    "utf8",
  );

  const app = await createTestServer(
    createServerConfig(dirs, {
      WEBROOT: CLIENT_WEBROOT,
      IS_DEVELOPMENT: false,
    }),
  );
  try {
    const response = await request(app, "/boards/canonical-svg.svg");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "image/svg+xml");
    assert.equal(
      response.headers["cache-control"],
      "public, max-age=3, must-revalidate",
    );
    assert.equal(response.headers.etag, 'W/"wbo-seq-3"');
    assert.match(response.body, /data-wbo-seq="3"/);
    assert.match(response.body, /<line id="line-1"/);

    const cachedResponse = await request(app, "/boards/canonical-svg.svg", {
      "If-None-Match": String(response.headers.etag),
    });

    assert.equal(cachedResponse.statusCode, 304);
    assert.equal(
      cachedResponse.headers["cache-control"],
      "public, max-age=3, must-revalidate",
    );
    assert.equal(cachedResponse.headers.etag, response.headers.etag);
    assert.equal(cachedResponse.body, "");
  } finally {
    await closeServer(app);
  }
});

test("canonical board svg endpoint remains no-store in development", async () => {
  const dirs = await createServerDirs();
  await fs.writeFile(
    boardSvgFile(dirs.historyDir, "canonical-svg-dev"),
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="4" data-wbo-readonly="false"><defs id="defs"></defs><g id="drawingArea"></g><g id="cursors"></g></svg>',
    "utf8",
  );

  const app = await createTestServer(
    createServerConfig(dirs, {
      WEBROOT: CLIENT_WEBROOT,
      IS_DEVELOPMENT: true,
    }),
  );
  try {
    const response = await request(app, "/boards/canonical-svg-dev.svg");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers.etag, 'W/"wbo-seq-4"');
  } finally {
    await closeServer(app);
  }
});

test("board html svg and preview routes negotiate compression when requested", async () => {
  const dirs = await createServerDirs();
  await fs.writeFile(
    boardSvgFile(dirs.historyDir, "compressed-board"),
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="6" data-wbo-readonly="false"><defs id="defs"></defs><g id="drawingArea"><line id="line-1" x1="0" y1="0" x2="10" y2="20" stroke="#000000" stroke-width="2" fill="none"></line></g><g id="cursors"></g></svg>',
    "utf8",
  );
  const compressionModule = require(COMPRESSION_PATH);
  const expectedEncoding =
    compressionModule.selectCompressionEncoding("zstd, br, gzip");
  if (compressionModule.selectCompressionEncoding("zstd") === "zstd") {
    assert.equal(expectedEncoding, "zstd");
  }
  const wildcardEncoding = compressionModule.selectCompressionEncoding("*");
  if (expectedEncoding) {
    assert.equal(wildcardEncoding, expectedEncoding);
  }
  const app = await createTestServer(
    createServerConfig(dirs, {
      WEBROOT: CLIENT_WEBROOT,
      IS_DEVELOPMENT: false,
    }),
  );
  const observability = require(OBSERVABILITY_PATH);
  const originalRecordHttpRequest = observability.metrics.recordHttpRequest;
  /** @type {any[]} */
  const httpRequestMetrics = [];
  observability.metrics.recordHttpRequest = (
    /** @type {Parameters<typeof originalRecordHttpRequest>[0]} */ sample,
  ) => {
    httpRequestMetrics.push(sample);
    originalRecordHttpRequest(sample);
  };
  try {
    const plainResponse = await request(app, "/boards/compressed-board");
    assert.equal(plainResponse.statusCode, 200);
    assert.equal(plainResponse.headers["content-encoding"], undefined);
    assert.match(String(plainResponse.headers.vary || ""), /Accept-Encoding/);

    const htmlResponse = await request(app, "/boards/compressed-board", {
      "Accept-Encoding": "zstd, br, gzip",
    });
    assert.equal(htmlResponse.statusCode, 200);

    const svgResponse = await request(app, "/boards/compressed-board.svg", {
      "Accept-Encoding": "zstd, br, gzip",
    });
    assert.equal(svgResponse.statusCode, 200);

    const previewResponse = await request(app, "/preview/compressed-board", {
      "Accept-Encoding": "zstd, br, gzip",
    });
    assert.equal(previewResponse.statusCode, 200);

    for (const response of [htmlResponse, svgResponse, previewResponse]) {
      if (expectedEncoding === undefined) {
        assert.equal(response.headers["content-encoding"], undefined);
      } else {
        assert.equal(response.headers["content-encoding"], expectedEncoding);
        assert.equal(response.headers["content-length"], undefined);
      }
      assert.match(String(response.headers.vary || ""), /Accept-Encoding/);
    }

    const responseEncodings = httpRequestMetrics.map(
      (sample) => sample.responseContentEncoding,
    );
    assert.ok(responseEncodings.includes("identity"));
    if (expectedEncoding !== undefined) {
      assert.equal(
        responseEncodings.filter((encoding) => encoding === expectedEncoding)
          .length,
        3,
      );
    }
  } finally {
    observability.metrics.recordHttpRequest = originalRecordHttpRequest;
    await closeServer(app);
  }
});

test("static assets are no-store in development and revalidate in production", async () => {
  const dirs = await createServerDirs();

  const developmentApp = await createTestServer(
    createServerConfig(dirs, { WEBROOT: CLIENT_WEBROOT, IS_DEVELOPMENT: true }),
  );
  try {
    const response = await request(developmentApp, "/board.css");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
  } finally {
    await closeServer(developmentApp);
  }

  const productionApp = await createTestServer(
    createServerConfig(dirs, {
      WEBROOT: CLIENT_WEBROOT,
      IS_DEVELOPMENT: false,
    }),
  );
  try {
    const response = await request(productionApp, "/board.css");

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["cache-control"],
      "public, max-age=60, must-revalidate",
    );
    assert.ok(response.headers.etag);

    const cachedResponse = await request(productionApp, "/board.css", {
      "If-None-Match": String(response.headers.etag),
    });
    assert.equal(cachedResponse.statusCode, 304);
    assert.equal(
      cachedResponse.headers["cache-control"],
      "public, max-age=60, must-revalidate",
    );
    assert.equal(cachedResponse.headers.etag, response.headers.etag);
  } finally {
    await closeServer(productionApp);
  }
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

  const app = await createTestServer(
    createServerConfig(dirs, {
      WEBROOT: CLIENT_WEBROOT,
      AUTH_SECRET_KEY: authSecret,
    }),
  );
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
    assert.match(readonlyResponse.body, /toolID-hand/);
    assert.match(editorResponse.body, /id="menu"/);
  } finally {
    await closeServer(app);
  }
});
