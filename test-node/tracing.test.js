const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { context, metrics, propagation, trace } = require("@opentelemetry/api");
const { logs } = require("@opentelemetry/api-logs");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");

const {
  CONFIG_PATH,
  MESSAGE_VALIDATION_PATH,
  SOCKET_POLICY_PATH,
  SOCKETS_PATH,
  createSocket,
  writeBoard,
} = require("./test_helpers.js");

const ROOT = path.join(__dirname, "..");
const OBSERVABILITY_PATH = path.join(ROOT, "server", "observability.js");
const SERVER_PATH = path.join(ROOT, "server", "server.js");
const BOARD_DATA_PATH = path.join(ROOT, "server", "boardData.js");
const TEMPLATING_PATH = path.join(ROOT, "server", "templating.mjs");
const CREATE_SVG_PATH = path.join(ROOT, "server", "createSVG.mjs");
const CHECK_OUTPUT_DIRECTORY_PATH = path.join(
  ROOT,
  "server",
  "check_output_directory.mjs",
);
const CLIENT_CONFIGURATION_PATH = path.join(
  ROOT,
  "server",
  "client_configuration.mjs",
);
const JWTAUTH_PATH = path.join(ROOT, "server", "jwtauth.mjs");
const TRACING_MODULES_TO_CLEAR = [
  CONFIG_PATH,
  MESSAGE_VALIDATION_PATH,
  SOCKET_POLICY_PATH,
  SOCKETS_PATH,
  SERVER_PATH,
  BOARD_DATA_PATH,
  TEMPLATING_PATH,
  CREATE_SVG_PATH,
  CHECK_OUTPUT_DIRECTORY_PATH,
  CLIENT_CONFIGURATION_PATH,
  JWTAUTH_PATH,
];
/** @type {{shutdownObservability: () => Promise<void>} | null} */
let sharedObservability = null;
/** @type {InMemorySpanExporter | null} */
let sharedExporter = null;

/**
 * @param {string} modulePath
 * @returns {void}
 */
function clearModuleCache(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
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
 * @param {{[key: string]: string}=} headers
 * @returns {Promise<{statusCode: number, headers: http.IncomingHttpHeaders, body: string}>}
 */
function request(server, requestPath, headers) {
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
        headers: headers,
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wbo-tracing-"));
  const historyDir = path.join(root, "history");
  const webroot = path.join(root, "webroot");
  await fs.mkdir(historyDir);
  await fs.mkdir(webroot);
  await fs.writeFile(path.join(webroot, "error.html"), "error-page", "utf8");
  await fs.writeFile(path.join(webroot, "board.html"), "board-page", "utf8");
  await fs.writeFile(path.join(webroot, "index.html"), "index-page", "utf8");
  await fs.writeFile(
    path.join(webroot, "script.js"),
    "console.log('x');",
    "utf8",
  );
  return { historyDir, webroot };
}

/**
 * @template T
 * @param {{[key: string]: string} | undefined} overrides
 * @param {(ctx: {exporter: InMemorySpanExporter, observability: any}) => Promise<T>} fn
 * @param {string[]=} extraModules
 * @returns {Promise<T>}
 */
async function withTracing(overrides, fn, extraModules) {
  if (!sharedExporter) {
    sharedExporter = new InMemorySpanExporter();
  } else {
    sharedExporter.reset();
  }
  /** @type {{__WBO_TEST_TRACE_EXPORTER__?: InMemorySpanExporter}} */ (
    globalThis
  ).__WBO_TEST_TRACE_EXPORTER__ = sharedExporter;
  const modulesToClear = TRACING_MODULES_TO_CLEAR.concat(extraModules || []);
  /** @type {{[key: string]: string | undefined}} */
  const previous = {};
  const settings = Object.assign(
    {
      OTEL_TRACES_SAMPLER: "always_on",
      WBO_SILENT: "true",
    },
    overrides || {},
  );
  try {
    for (const key of Object.keys(settings)) {
      previous[key] = process.env[key];
      const value = settings[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const modulePath of modulesToClear) {
      clearModuleCache(modulePath);
    }
    if (!sharedObservability) {
      logs.disable();
      metrics.disable();
      propagation.disable();
      context.disable();
      trace.disable();
      clearModuleCache(OBSERVABILITY_PATH);
      sharedObservability = require(OBSERVABILITY_PATH);
    }
    return await fn({
      exporter: sharedExporter,
      observability: sharedObservability,
    });
  } finally {
    for (const key of Object.keys(settings)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    for (const modulePath of modulesToClear) {
      clearModuleCache(modulePath);
    }
    delete (
      /** @type {{__WBO_TEST_TRACE_EXPORTER__?: InMemorySpanExporter}} */ (
        globalThis
      ).__WBO_TEST_TRACE_EXPORTER__
    );
  }
}

test.after(async function shutdownTracingObservability() {
  if (sharedObservability) {
    await sharedObservability.shutdownObservability();
    sharedObservability = null;
  }
  logs.disable();
  metrics.disable();
  propagation.disable();
  context.disable();
  trace.disable();
  sharedExporter = null;
  clearModuleCache(OBSERVABILITY_PATH);
});

/**
 * @param {InMemorySpanExporter} exporter
 * @param {string} name
 * @returns {any}
 */
function getSpanByName(exporter, name) {
  const span = exporter
    .getFinishedSpans()
    .find((candidate) => candidate.name === name);
  assert.ok(span, `expected span ${name}`);
  return span;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {InMemorySpanExporter} exporter
 * @param {string[]} names
 * @param {number=} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForSpans(exporter, names, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 1000);
  while (Date.now() < deadline) {
    const exportedNames = exporter.getFinishedSpans().map((span) => span.name);
    const hasAllSpans = names.every((name) => exportedNames.includes(name));
    if (hasAllSpans) return;
    await sleep(20);
  }
  assert.fail(
    `timed out waiting for spans: ${names.join(", ")}; got ${exporter
      .getFinishedSpans()
      .map((span) => span.name)
      .join(", ")}`,
  );
}

/**
 * @param {{[event: string]: ((...args: any[]) => any) | undefined}} handlers
 * @param {string} eventName
 * @returns {(...args: any[]) => any}
 */
function getRequiredHandler(handlers, eventName) {
  const handler = handlers[eventName];
  assert.equal(typeof handler, "function");
  return /** @type {(...args: any[]) => any} */ (handler);
}

test("preview requests continue traceparent and create a child render span", async () => {
  const dirs = await createServerDirs();
  await withTracing(
    {
      HOST: "127.0.0.1",
      PORT: "0",
      AUTH_SECRET_KEY: "",
      WBO_HISTORY_DIR: dirs.historyDir,
      WBO_WEBROOT: dirs.webroot,
    },
    async ({ exporter }) => {
      const app = require(SERVER_PATH);
      await waitForListening(app);
      try {
        await request(app, "/preview/missing-board", {
          traceparent:
            "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        });
        await waitForSpans(exporter, [
          "GET /preview/{board}",
          "preview.render",
        ]);

        const requestSpan = getSpanByName(exporter, "GET /preview/{board}");
        const renderSpan = getSpanByName(exporter, "preview.render");

        assert.equal(requestSpan.attributes["wbo.board"], "missing-board");
        assert.equal(requestSpan.attributes["http.route"], "/preview/{board}");
        assert.equal(requestSpan.attributes["url.scheme"], "http");
        assert.equal(requestSpan.attributes["server.address"], "127.0.0.1");
        assert.equal(requestSpan.attributes["server.port"], app.address().port);
        assert.equal(requestSpan.attributes["url.path"], undefined);
        assert.equal(
          requestSpan.parentSpanContext.traceId,
          "0123456789abcdef0123456789abcdef",
        );
        assert.equal(requestSpan.parentSpanContext.spanId, "0123456789abcdef");
        assert.equal(
          renderSpan.parentSpanContext.spanId,
          requestSpan.spanContext().spanId,
        );
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

test("static asset requests do not create spans", async () => {
  const dirs = await createServerDirs();
  await withTracing(
    {
      HOST: "127.0.0.1",
      PORT: "0",
      AUTH_SECRET_KEY: "",
      WBO_HISTORY_DIR: dirs.historyDir,
      WBO_WEBROOT: dirs.webroot,
    },
    async ({ exporter }) => {
      const app = require(SERVER_PATH);
      await waitForListening(app);
      try {
        const response = await request(app, "/script.js");
        assert.equal(response.statusCode, 200);
        assert.equal(exporter.getFinishedSpans().length, 0);
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

test("getboard traces the root socket event and board load", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-trace-socket-"),
  );
  await writeBoard(historyDir, "trace-board", {});

  await withTracing(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_HISTORY_DIR: historyDir,
    },
    async ({ exporter }) => {
      const sockets = require(SOCKETS_PATH);
      const created = createSocket({
        id: "socket-trace",
        remoteAddress: "203.0.113.10",
        query: {
          userSecret: "trace-secret",
          tool: "Hand",
          color: "#111111",
          size: "6",
        },
      });

      sockets.__test.resetRateLimitMaps();
      sockets.__test.handleSocketConnection(created.socket);
      await getRequiredHandler(created.handlers, "getboard")("trace-board");
      await waitForSpans(exporter, ["socket.getboard", "board.load"]);

      const rootSpan = getSpanByName(exporter, "socket.getboard");
      const loadSpan = getSpanByName(exporter, "board.load");

      assert.equal(rootSpan.attributes["wbo.board"], "trace-board");
      assert.equal(typeof rootSpan.attributes["user.name"], "string");
      assert.equal(
        loadSpan.parentSpanContext.spanId,
        rootSpan.spanContext().spanId,
      );
    },
  );
});

test("active traces correlate log records and board.save spans", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-trace-save-"),
  );

  await withTracing(
    {
      WBO_HISTORY_DIR: historyDir,
    },
    async ({ exporter, observability }) => {
      const { BoardData } = require(BOARD_DATA_PATH);

      const record = await observability.tracing.withActiveSpan(
        "socket.broadcast_write",
        {
          kind: observability.tracing.SpanKind.INTERNAL,
          attributes: {
            "wbo.board": "trace-save",
          },
        },
        async function traceSave() {
          const correlated = observability.__test.createLogRecord(
            "info",
            "board.saved",
            { board: "trace-save" },
          );
          const board = new BoardData("trace-save");
          board.board["shape-1"] = {
            id: "shape-1",
            tool: "Text",
            x: 1,
            y: 2,
            text: "hi",
            size: 12,
            color: "#000000",
            time: 1,
          };
          await board.save();
          return correlated;
        },
      );
      await waitForSpans(exporter, ["socket.broadcast_write", "board.save"]);

      const rootSpan = getSpanByName(exporter, "socket.broadcast_write");
      const saveSpan = getSpanByName(exporter, "board.save");
      const savedBoard = await fs.readFile(saveSpan.attributes["file.path"]);

      assert.equal(record.attributes.trace_id, rootSpan.spanContext().traceId);
      assert.equal(record.attributes.span_id, rootSpan.spanContext().spanId);
      assert.equal(saveSpan.attributes["file.size"], savedBoard.length);
      assert.match(saveSpan.attributes["file.path"], /board-trace-save\.json$/);
      assert.equal(
        saveSpan.parentSpanContext.spanId,
        rootSpan.spanContext().spanId,
      );
    },
    [BOARD_DATA_PATH],
  );
});

test("successful cursor broadcasts stay untraced, but invalid cursor messages create rejection spans", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-trace-cursor-"),
  );

  await withTracing(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_HISTORY_DIR: historyDir,
    },
    async ({ exporter }) => {
      const sockets = require(SOCKETS_PATH);
      const created = createSocket({
        id: "socket-cursor",
        remoteAddress: "203.0.113.12",
      });

      sockets.__test.resetRateLimitMaps();
      sockets.__test.handleSocketConnection(created.socket);

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
        board: "anonymous",
        data: {
          tool: "Cursor",
          type: "update",
          x: 10,
          y: 20,
          color: "#123456",
          size: 2,
        },
      });
      assert.equal(exporter.getFinishedSpans().length, 0);

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
        board: "anonymous",
        data: {
          tool: "Cursor",
          type: "update",
          x: 10,
          y: 20,
        },
      });
      await waitForSpans(exporter, ["socket.message_invalid"]);

      const invalidSpan = getSpanByName(exporter, "socket.message_invalid");
      assert.equal(
        invalidSpan.attributes["wbo.rejection.reason"],
        "missing color",
      );
    },
  );
});
