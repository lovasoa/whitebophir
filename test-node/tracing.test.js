const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { context, metrics, propagation, trace } = require("@opentelemetry/api");
const { logs } = require("@opentelemetry/api-logs");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Cursor } = require("../client-data/tools/index.js");

const {
  MESSAGE_VALIDATION_PATH,
  closeServer,
  SOCKET_POLICY_PATH,
  createConfig,
  createSocket,
  loadSockets,
  request,
  writeBoard,
} = require("./test_helpers.js");

const ROOT = path.join(__dirname, "..");
const OBSERVABILITY_PATH = path.join(ROOT, "server", "observability.mjs");
const SERVER_PATH = path.join(ROOT, "server", "server.mjs");
const BOARD_DATA_PATH = path.join(ROOT, "server", "boardData.mjs");
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
  MESSAGE_VALIDATION_PATH,
  SOCKET_POLICY_PATH,
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
 * @returns {Promise<{createServerApp: (config: any, options?: any) => Promise<import("http").Server>}>}
 */
async function loadServer() {
  return require(SERVER_PATH);
}

/**
 * @returns {Promise<import("http").Server>}
 */
async function createTestServer() {
  const { createServerApp } = await loadServer();
  return createServerApp(createConfig(), {
    logStarted: false,
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
 * @returns {InMemorySpanExporter}
 */
function prepareSharedExporter() {
  if (!sharedExporter) {
    sharedExporter = new InMemorySpanExporter();
  } else {
    sharedExporter.reset();
  }
  return sharedExporter;
}

/**
 * @param {{[key: string]: string | undefined}} settings
 * @returns {{[key: string]: string | undefined}}
 */
function applyTracingEnv(settings) {
  /** @type {{[key: string]: string | undefined}} */
  const previous = {};
  for (const key of Object.keys(settings)) {
    previous[key] = process.env[key];
    const value = settings[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return previous;
}

/**
 * @param {{[key: string]: string | undefined}} settings
 * @param {{[key: string]: string | undefined}} previous
 * @returns {void}
 */
function restoreTracingEnv(settings, previous) {
  for (const key of Object.keys(settings)) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

/**
 * @param {string[]} modulePaths
 * @returns {void}
 */
function clearModuleCaches(modulePaths) {
  for (const modulePath of modulePaths) {
    clearModuleCache(modulePath);
  }
}

/**
 * @returns {any}
 */
function getSharedObservability() {
  if (sharedObservability) return sharedObservability;
  logs.disable();
  metrics.disable();
  propagation.disable();
  context.disable();
  trace.disable();
  clearModuleCache(OBSERVABILITY_PATH);
  sharedObservability = require(OBSERVABILITY_PATH);
  return sharedObservability;
}

/**
 * @template T
 * @param {{[key: string]: string} | undefined} overrides
 * @param {(ctx: {exporter: InMemorySpanExporter, observability: any}) => Promise<T>} fn
 * @param {string[]=} extraModules
 * @returns {Promise<T>}
 */
async function withTracing(overrides, fn, extraModules) {
  const exporter = prepareSharedExporter();
  /** @type {{__WBO_TEST_TRACE_EXPORTER__?: InMemorySpanExporter}} */ (
    globalThis
  ).__WBO_TEST_TRACE_EXPORTER__ = exporter;
  const modulesToClear = TRACING_MODULES_TO_CLEAR.concat(extraModules || []);
  const settings = Object.assign(
    {
      OTEL_TRACES_SAMPLER: "always_on",
      WBO_SILENT: "true",
    },
    overrides || {},
  );
  const previous = applyTracingEnv(settings);
  try {
    clearModuleCaches(modulesToClear);
    return await fn({
      exporter,
      observability: getSharedObservability(),
    });
  } finally {
    restoreTracingEnv(settings, previous);
    clearModuleCaches(modulesToClear);
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
      const app = await createTestServer();
      try {
        const response = await request(app, "/preview/missing-board", {
          traceparent:
            "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        });
        await waitForSpans(exporter, [
          "GET /preview/{board}",
          "preview.render",
        ]);

        const requestSpan = getSpanByName(exporter, "GET /preview/{board}");
        const renderSpan = getSpanByName(exporter, "preview.render");

        assert.equal(response.statusCode, 404);
        assert.equal(requestSpan.attributes["wbo.board"], "missing-board");
        assert.equal(requestSpan.attributes["http.route"], "/preview/{board}");
        assert.equal(requestSpan.attributes["http.response.status_code"], 404);
        assert.equal(requestSpan.attributes["url.scheme"], "http");
        assert.equal(requestSpan.attributes["server.address"], "127.0.0.1");
        assert.equal(renderSpan.attributes["wbo.board.result"], "not_found");
        const address = app.address();
        if (!address || typeof address === "string") {
          throw new Error("Expected test server to listen on a TCP port");
        }
        assert.equal(requestSpan.attributes["server.port"], address.port);
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
      const app = await createTestServer();
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

test("connection replay traces handshake board load and socket bootstrap", async () => {
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
      const sockets = await loadSockets();
      const created = createSocket({
        id: "socket-trace",
        remoteAddress: "203.0.113.10",
        headers: {
          cookie: "wbo-user-secret-v1=abababababababababababababababab",
        },
        query: {
          board: "trace-board",
          tool: "hand",
          color: "#111111",
          size: "6",
        },
      });

      sockets.__test.resetRateLimitMaps();
      await sockets.__test.handleSocketConnection(
        created.socket,
        sockets.__config,
      );
      await waitForSpans(exporter, [
        "socket.connection_replay",
        "socket.connect_board",
        "board.load",
        "board.load_read",
      ]);

      const replaySpan = getSpanByName(exporter, "socket.connection_replay");
      const connectSpan = getSpanByName(exporter, "socket.connect_board");
      const loadSpan = getSpanByName(exporter, "board.load");
      const loadReadSpan = getSpanByName(exporter, "board.load_read");

      assert.equal(replaySpan.attributes["wbo.board"], "trace-board");
      assert.equal(
        replaySpan.attributes["wbo.socket.connection_replay.outcome"],
        "empty",
      );
      assert.equal(connectSpan.attributes["wbo.board"], "trace-board");
      assert.equal(typeof connectSpan.attributes["user.name"], "string");
      assert.equal(
        loadSpan.parentSpanContext.spanId,
        replaySpan.spanContext().spanId,
      );
      assert.equal(
        loadReadSpan.parentSpanContext.spanId,
        loadSpan.spanContext().spanId,
      );
      assert.equal(loadReadSpan.attributes["wbo.board.result"], "success");
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
          const config = createConfig({ HISTORY_DIR: historyDir });
          const board = new BoardData("trace-save", config);
          board.board = {
            "shape-1": {
              id: "shape-1",
              tool: "text",
              x: 1,
              y: 2,
              txt: "hi",
              size: 12,
              color: "#000000",
              time: 1,
            },
          };
          await board.save();
          return correlated;
        },
      );
      await waitForSpans(exporter, [
        "socket.broadcast_write",
        "board.save",
        "board.save_write",
      ]);

      const rootSpan = getSpanByName(exporter, "socket.broadcast_write");
      const saveSpan = getSpanByName(exporter, "board.save");
      const saveWriteSpan = getSpanByName(exporter, "board.save_write");
      const savedBoard = await fs.readFile(saveSpan.attributes["file.path"]);
      const spanContext = trace.getSpanContext(record.context);

      assert.ok(spanContext);
      assert.equal(spanContext.traceId, rootSpan.spanContext().traceId);
      assert.equal(spanContext.spanId, rootSpan.spanContext().spanId);
      assert.equal(record.attributes.trace_id, undefined);
      assert.equal(record.attributes.span_id, undefined);
      assert.equal(saveSpan.attributes["file.size"], savedBoard.length);
      assert.match(saveSpan.attributes["file.path"], /board-trace-save\.svg$/);
      assert.equal(
        saveSpan.parentSpanContext.spanId,
        rootSpan.spanContext().spanId,
      );
      assert.equal(
        saveWriteSpan.parentSpanContext.spanId,
        saveSpan.spanContext().spanId,
      );
      assert.equal(saveWriteSpan.attributes["wbo.board.result"], "success");
    },
    [BOARD_DATA_PATH],
  );
});

test("recording-only and expensive spans avoid accidental roots", async () => {
  await withTracing({}, async ({ exporter, observability }) => {
    await observability.tracing.withRecordingActiveSpan(
      "child.work",
      undefined,
      /**
       * @param {import("@opentelemetry/api").Span | undefined} span
       */
      async (span) => {
        assert.equal(span, undefined);
      },
    );
    assert.equal(exporter.getFinishedSpans().length, 0);

    await observability.tracing.withExpensiveActiveSpan(
      "small.work",
      {
        traceRoot: false,
      },
      async () => {},
    );
    assert.equal(exporter.getFinishedSpans().length, 0);

    await observability.tracing.withExpensiveActiveSpan(
      "large.work",
      {
        traceRoot: true,
      },
      async () => {},
    );
    await waitForSpans(exporter, ["large.work"]);
  });
});

test("board page traces document state and SVG stream setup", async () => {
  const dirs = await createServerDirs();
  await fs.copyFile(
    path.join(ROOT, "client-data", "board.html"),
    path.join(dirs.webroot, "board.html"),
  );
  await withTracing(
    {
      HOST: "127.0.0.1",
      PORT: "0",
      AUTH_SECRET_KEY: "",
      WBO_HISTORY_DIR: dirs.historyDir,
      WBO_WEBROOT: dirs.webroot,
    },
    async ({ exporter }) => {
      const { BoardData } = require(BOARD_DATA_PATH);
      const config = createConfig({ HISTORY_DIR: dirs.historyDir });
      const board = new BoardData("trace-page", config);
      board.board = {
        "shape-1": {
          id: "shape-1",
          tool: "text",
          x: 1,
          y: 2,
          txt: "hi",
          size: 12,
          color: "#000000",
          time: 1,
        },
      };
      await board.save();
      exporter.reset();

      const { createServerApp } = await loadServer();
      const app = await createServerApp(
        createConfig({
          HOST: "127.0.0.1",
          PORT: 0,
          AUTH_SECRET_KEY: "",
          HISTORY_DIR: dirs.historyDir,
          WEBROOT: dirs.webroot,
        }),
        {
          logStarted: false,
        },
      );
      try {
        const response = await request(app, "/boards/trace-page");
        await waitForSpans(exporter, [
          "GET /boards/{board}",
          "board.document_state_read",
          "board.baseline_stream_open",
        ]);

        const requestSpan = getSpanByName(exporter, "GET /boards/{board}");
        const stateSpan = getSpanByName(exporter, "board.document_state_read");
        const streamSpan = getSpanByName(
          exporter,
          "board.baseline_stream_open",
        );

        assert.equal(response.statusCode, 200);
        assert.equal(stateSpan.attributes["wbo.board"], "trace-page");
        assert.equal(stateSpan.attributes["wbo.board.load_source"], "svg");
        assert.equal(streamSpan.attributes["wbo.board.load_source"], "svg");
        assert.equal(
          stateSpan.parentSpanContext.spanId,
          requestSpan.spanContext().spanId,
        );
        assert.equal(
          streamSpan.parentSpanContext.spanId,
          requestSpan.spanContext().spanId,
        );
      } finally {
        await closeServer(app);
      }
    },
    [BOARD_DATA_PATH],
  );
});

test("large standalone board loads create their own root span", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-trace-standalone-load-"),
  );
  /** @type {{[id: string]: any}} */
  const storedBoard = {};
  for (let index = 0; index < 512; index++) {
    storedBoard[`shape-${index}`] = {
      id: `shape-${index}`,
      tool: "text",
      x: index,
      y: index,
      txt: "x".repeat(4096),
      size: 12,
      color: "#000000",
      time: index,
    };
  }
  await writeBoard(historyDir, "standalone-load", storedBoard);

  await withTracing(
    {
      WBO_HISTORY_DIR: historyDir,
    },
    async ({ exporter }) => {
      const { BoardData } = require(BOARD_DATA_PATH);
      const config = createConfig({ HISTORY_DIR: historyDir });
      const board = await BoardData.load("standalone-load", config);

      clearTimeout(board.saveTimeoutId);
      await waitForSpans(exporter, ["board.load"]);

      const loadSpan = getSpanByName(exporter, "board.load");
      assert.equal(loadSpan.parentSpanContext, undefined);
      assert.equal(loadSpan.attributes["wbo.board"], "standalone-load");
      assert.ok(loadSpan.attributes["file.size"] > 1024 * 1024);
    },
    [BOARD_DATA_PATH],
  );
});

test("formatReadableLogRecord only renders sampled span ids", async () => {
  await withTracing({}, async ({ observability }) => {
    const sampledLine = observability.formatReadableLogRecord({
      hrTime: [0, 0],
      severityText: "INFO",
      severityNumber: 9,
      body: "sampled",
      eventName: "sampled.log",
      attributes: {},
      spanContext: {
        traceId: "0123456789abcdef0123456789abcdef",
        spanId: "0123456789abcdef",
        traceFlags: 1,
      },
    });
    const unsampledLine = observability.formatReadableLogRecord({
      hrTime: [0, 0],
      severityText: "INFO",
      severityNumber: 9,
      body: "unsampled",
      eventName: "unsampled.log",
      attributes: {},
      spanContext: {
        traceId: "fedcba9876543210fedcba9876543210",
        spanId: "fedcba9876543210",
        traceFlags: 0,
      },
    });

    assert.match(sampledLine, /trace_id=0123456789abcdef0123456789abcdef/);
    assert.match(sampledLine, /span_id=0123456789abcdef/);
    assert.doesNotMatch(unsampledLine, /trace_id=/);
    assert.doesNotMatch(unsampledLine, /span_id=/);
  });
});

test("LOG_LEVEL filters lower-severity logs", async () => {
  const observability = getSharedObservability();
  assert.equal(
    observability.__test.shouldEmitLogAtLevel("debug", "warn"),
    false,
  );
  assert.equal(
    observability.__test.shouldEmitLogAtLevel("info", "warn"),
    false,
  );
  assert.equal(observability.__test.shouldEmitLogAtLevel("warn", "warn"), true);
  assert.equal(
    observability.__test.shouldEmitLogAtLevel("error", "warn"),
    true,
  );
});

test("successful and invalid cursor broadcasts stay untraced without a parent span", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-trace-cursor-"),
  );

  await withTracing(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_HISTORY_DIR: historyDir,
    },
    async ({ exporter }) => {
      const sockets = await loadSockets();
      const created = createSocket({
        id: "socket-cursor",
        remoteAddress: "203.0.113.12",
        query: { board: "anonymous" },
      });

      sockets.__test.resetRateLimitMaps();
      await sockets.__test.handleSocketConnection(
        created.socket,
        sockets.__config,
      );

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
        tool: Cursor.id,
        type: MutationType.UPDATE,
        x: 10,
        y: 20,
        color: "#123456",
        size: 2,
      });
      assert.equal(
        exporter
          .getFinishedSpans()
          .some((span) => span.name === "socket.broadcast_write"),
        false,
      );
      const spanCountBeforeInvalidMessage = exporter.getFinishedSpans().length;

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
        tool: Cursor.id,
        type: MutationType.UPDATE,
        x: 10,
        y: 20,
      });
      assert.equal(
        exporter.getFinishedSpans().length,
        spanCountBeforeInvalidMessage,
      );
    },
  );
});
