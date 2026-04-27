import * as fsp from "node:fs/promises";
import * as os from "node:os";
import { Session } from "node:inspector";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

const historyDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wbo-bench-"));
process.env.WBO_HISTORY_DIR = historyDir;
process.env.WBO_SILENT ||= "true";

const { BoardData } = await import("../server/board/data.mjs");
const { setLoadedBoard, deleteLoadedBoard } = await import(
  "../server/board/registry.mjs"
);
const { __test: socketsTest } = await import("../server/socket/index.mjs");
const { MutationType } = await import("../client-data/js/mutation_type.js");
const { Hand, Pencil, Rectangle, Text } = await import(
  "../client-data/tools/index.js"
);
const config = await import(
  `../server/configuration.mjs?cache-bust=${encodeURIComponent(import.meta.url)}`
);
const { boardSvgPath, writeBoardState } = await import(
  "../server/persistence/svg_board_store.mjs"
);

const scenario = (process.argv[2] || "all").toLowerCase();
const sampleCount = 3;
const boardItems = config.MAX_ITEM_COUNT;
const pencilEvery = 6;
const pencilPoints = config.MAX_CHILDREN;
const persistPoints = Math.max(8, config.MAX_CHILDREN - 4);
const persistPencilUpdates = 128;
const persistShapeUpdates = 128;
const broadcastCount = 20_000;
const color = "#1f2937";
const timeoutMs = Number.parseInt(
  process.env.WBO_BENCH_TIMEOUT_MS ?? "180000",
  10,
);
const profileCpuOut = process.env.WBO_PROFILE_CPU_OUT;
const profileHeapOut = process.env.WBO_PROFILE_HEAP_OUT;
/** @typedef {string | (() => string)} BenchmarkDetails */
/** @typedef {{timeMs: number, details?: string, retain?: unknown}} BenchmarkSample */
/** @typedef {{timeMs: number, transientBytes: number, retainedBytes: number, details?: string, retainedValue?: unknown}} MeasuredBenchmarkSample */

if (!["all", "e2e", "load", "persist", "broadcast"].includes(scenario)) {
  throw new Error(
    `expected scenario all|e2e|load|persist|broadcast, got ${JSON.stringify(scenario)}`,
  );
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
  throw new Error(
    `invalid WBO_BENCH_TIMEOUT_MS: ${JSON.stringify(process.env.WBO_BENCH_TIMEOUT_MS)}`,
  );
}
if (Boolean(profileCpuOut) !== Boolean(profileHeapOut)) {
  throw new Error(
    "WBO_PROFILE_CPU_OUT and WBO_PROFILE_HEAP_OUT must be set together",
  );
}
if (profileCpuOut && scenario === "all") {
  throw new Error("profiling requires a single scenario");
}

/** @param {string} name */ const shouldRun = (name) =>
  scenario === "all" || scenario === name;
function forceGc() {
  if (typeof global.gc !== "function") return;
  global.gc();
  global.gc();
}
/** @returns {{limit: number, periodMs: number, overrides: {}}} */
function highRateLimit() {
  return { limit: broadcastCount * 2, periodMs: 60_000, overrides: {} };
}
const broadcastBenchmarkConfig = {
  ...config,
  GENERAL_RATE_LIMITS: highRateLimit(),
  CONSTRUCTIVE_ACTION_RATE_LIMITS: highRateLimit(),
  DESTRUCTIVE_ACTION_RATE_LIMITS: highRateLimit(),
  TEXT_CREATION_RATE_LIMITS: highRateLimit(),
  TURNSTILE_SECRET_KEY: "",
};
/**
 * @param {string} boardName
 * @param {string} socketId
 * @returns {{socket: any, handlers: {[event: string]: (...args: any[]) => any}, getRejected: () => {event: string, payload: any} | null, clearRejected: () => void}}
 */
function createBenchmarkSocket(boardName, socketId) {
  /** @type {{[event: string]: (...args: any[]) => any}} */
  const handlers = {};
  /** @type {{event: string, payload: any} | null} */
  let rejected = null;
  const socket = /** @type {any} */ ({
    id: socketId,
    handshake: { query: { board: boardName } },
    rooms: new Set(),
    client: {
      request: {
        headers: { "user-agent": "benchmark" },
        socket: { remoteAddress: "127.0.0.1" },
      },
    },
    broadcast: {
      to: () => ({
        emit: () => true,
      }),
    },
    on: (
      /** @type {string} */ event,
      /** @type {(...args: any[]) => any} */ handler,
    ) => {
      handlers[event] = handler;
    },
    join: function (/** @type {string} */ room) {
      this.rooms.add(room);
    },
    emit: (/** @type {string} */ event, /** @type {any} */ payload) => {
      if (event === "mutation_rejected" || event === "rate-limited") {
        rejected = { event, payload };
      }
      return true;
    },
    disconnect: function () {
      this.disconnected = true;
    },
  });
  return {
    socket,
    handlers,
    getRejected: () => rejected,
    clearRejected: () => {
      rejected = null;
    },
  };
}
/** @param {Session} session @param {string} method @param {object} [params] */
function postSession(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) =>
      error ? reject(error) : resolve(result || {}),
    );
  });
}
/** @param {number[]} values */ const average = (values) =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
/** @param {number} value */ const formatMs = (value) =>
  value < 10 ? `${value.toFixed(2)}ms` : `${value.toFixed(1)}ms`;
/** @param {number} bytes */ const formatMemory = (bytes) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
/** @param {number} bytes */ const formatMiB = (bytes) =>
  `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
const usedMemoryBytes = () => {
  const { heapUsed, external } = process.memoryUsage();
  return heapUsed + external;
};
/** @param {() => Promise<BenchmarkSample>} run @param {boolean} [keepRetainedValue] */
async function measureSample(run, keepRetainedValue = false) {
  forceGc();
  const beforeBytes = usedMemoryBytes();
  const { retain, ...sample } = await run();
  const liveBytes = Math.max(0, usedMemoryBytes() - beforeBytes);
  forceGc();
  const retainedBytes = Math.max(0, usedMemoryBytes() - beforeBytes);
  // Keep the final object graph alive until after retained-memory measurement.
  void retain;
  return {
    ...sample,
    transientBytes: Math.max(0, liveBytes - retainedBytes),
    retainedBytes,
    ...(keepRetainedValue ? { retainedValue: retain } : {}),
  };
}
/** @param {string} shortName @param {string} longName @param {MeasuredBenchmarkSample[]} samples @param {string} details */
function printResult(shortName, longName, samples, details) {
  const times = samples.map((sample) => sample.timeMs).sort((a, b) => a - b);
  console.log(`${shortName}: ${longName}${details ? ` with ${details}` : ""}`);
  console.log(
    `  time: avg ${average(times).toFixed(1)}ms (samples: ${times.map(formatMs).join(", ")})`,
  );
  console.log(
    `  memory: ${formatMemory(average(samples.map((sample) => sample.transientBytes)))} transient ${formatMemory(average(samples.map((sample) => sample.retainedBytes)))} retained`,
  );
  console.log("");
}
/** @param {() => Promise<unknown>} run */
async function maybeWriteProfiles(run) {
  if (!profileCpuOut || !profileHeapOut) {
    await run();
    return;
  }
  const session = new Session();
  session.connect();
  await postSession(session, "Profiler.enable");
  await postSession(session, "Profiler.start");
  await postSession(session, "HeapProfiler.startSampling", {
    samplingInterval: 4096,
  });
  try {
    const retained = await run();
    void retained;
  } finally {
    const { profile: cpuProfile } = await postSession(session, "Profiler.stop");
    const { profile: heapProfile } = await postSession(
      session,
      "HeapProfiler.stopSampling",
    );
    session.disconnect();
    await Promise.all([
      fsp.writeFile(profileCpuOut, JSON.stringify(cpuProfile)),
      fsp.writeFile(profileHeapOut, JSON.stringify(heapProfile)),
    ]);
  }
}
/** @param {any} board */
function clearPendingSave(board) {
  if (board.saveTimeoutId !== undefined) clearTimeout(board.saveTimeoutId);
  board.saveTimeoutId = undefined;
}
/** @param {number} itemCount @param {number} pathPoints @returns {{board: {[id: string]: any}, pencilIds: string[], shapeIds: string[]}} */
function buildBoard(itemCount, pathPoints) {
  const board = /** @type {{[id: string]: any}} */ ({}),
    pencilIds = [],
    shapeIds = [];
  for (let index = 0; index < itemCount; index += 1) {
    const x = (index * 13) % 8000,
      y = Math.floor((index * 17) / 3) % 8000;
    if (index % pencilEvery === 0) {
      const id = `pencil-${index}`;
      board[id] = {
        id,
        tool: "pencil",
        type: "path",
        color,
        size: 10,
        _children: Array.from({ length: pathPoints }, (_, pointIndex) => ({
          x: x + pointIndex,
          y: y + ((pointIndex * 3) % 120),
        })),
        time: index,
      };
      pencilIds.push(id);
      continue;
    }
    if (index % 3 === 1) {
      const id = `line-${index}`;
      board[id] = {
        id,
        tool: "straight-line",
        type: "line",
        color,
        size: 10,
        x,
        y,
        x2: x + 36,
        y2: y + 22,
        time: index,
      };
      shapeIds.push(id);
      continue;
    }
    const isRect = index % 3 === 0,
      id = isRect ? `rect-${index}` : `text-${index}`;
    board[id] = isRect
      ? {
          id,
          tool: "rectangle",
          type: "rect",
          color,
          size: 10,
          x,
          y,
          x2: x + 48,
          y2: y + 28,
          time: index,
        }
      : {
          id,
          tool: "text",
          type: "text",
          color,
          size: 18,
          x,
          y,
          txt: `note-${index}`,
          time: index,
        };
    shapeIds.push(id);
  }
  return { board, pencilIds, shapeIds };
}
/** @returns {{[id: string]: any}} */
function buildBroadcastSeed() {
  const board = /** @type {{[id: string]: any}} */ ({});
  for (let index = 0; index < 500; index += 1) {
    board[`rect-${index}`] = {
      id: `rect-${index}`,
      tool: "rectangle",
      type: "rect",
      color,
      size: 10,
      x: index,
      y: index,
      x2: index + 12,
      y2: index + 12,
    };
    board[`text-${index}`] = {
      id: `text-${index}`,
      tool: "text",
      type: "text",
      color,
      size: 18,
      x: index,
      y: index + 18,
      txt: `seed-${index}`,
    };
  }
  for (let index = 0; index < 100; index += 1) {
    board[`pencil-${index}`] = {
      id: `pencil-${index}`,
      tool: "pencil",
      type: "path",
      color,
      size: 10,
      _children: [
        { x: index, y: index },
        { x: index + 4, y: index + 6 },
      ],
    };
  }
  return board;
}
function buildBroadcastMessages() {
  return Array.from({ length: broadcastCount }, (_, index) => {
    if (index % 4 === 0)
      return {
        tool: Pencil.id,
        type: MutationType.APPEND,
        parent: `pencil-${index % 100}`,
        x: (index * 3) % 3000,
        y: (index * 7) % 3000,
      };
    if (index % 4 === 1)
      return {
        tool: Rectangle.id,
        type: MutationType.UPDATE,
        id: `rect-${index % 500}`,
        x: index % 3000,
        y: (index * 2) % 3000,
        x2: (index % 3000) + 24,
        y2: ((index * 2) % 3000) + 18,
      };
    if (index % 4 === 2)
      return {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: `text-${index % 500}`,
        txt: `bench-${index}`,
      };
    return {
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: `shape-${index}`,
      color,
      size: 10,
      x: index % 3000,
      y: (index * 2) % 3000,
      x2: (index % 3000) + 20,
      y2: ((index * 2) % 3000) + 16,
    };
  });
}
/** @param {string} name @param {{[id: string]: any}} board */
async function writeFixture(name, board) {
  await writeBoardState(name, board, { readonly: false }, 0, { historyDir });
  return (await fsp.stat(boardSvgPath(name, historyDir))).size;
}
/** @param {string} shortName @param {string} longName @param {BenchmarkDetails | undefined} details @param {(index: number) => Promise<BenchmarkSample>} run @param {number} [count] */
async function bench(shortName, longName, details, run, count = sampleCount) {
  const samples = [];
  let finalDetails = typeof details === "string" ? details : "";
  let retainedValue;
  for (let index = 0; index < count; index += 1) {
    const sample = await measureSample(
      () => run(index),
      Boolean(profileCpuOut) && index === count - 1,
    );
    if (sample.retainedValue !== undefined)
      retainedValue = sample.retainedValue;
    samples.push(sample);
    if (sample.details) finalDetails = sample.details;
  }
  if (!finalDetails && typeof details === "function") finalDetails = details();
  printResult(shortName, longName, samples, finalDetails);
  return retainedValue;
}
const loadBoardName = "bench-load";
const persistTemplateName = "bench-persist-template";
const persistBoardName = "bench-persist";
const timeout = setTimeout(() => {
  console.error(`benchmark timed out after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);
try {
  if (shouldRun("e2e")) {
    const { runPeerVisibleEraseBenchmark } = await import(
      "./benchmark-peer-visible-erase.mjs"
    );
    await maybeWriteProfiles(async () => {
      const samples = await Promise.all(
        Array.from({ length: sampleCount }, () =>
          measureSample(() =>
            runPeerVisibleEraseBenchmark(config.MAX_CHILDREN),
          ),
        ),
      );
      printResult(
        "e2e",
        "open large board to peer-visible erase",
        samples,
        samples.find((sample) => sample.details)?.details ?? "",
      );
    });
  }

  if (shouldRun("load")) {
    const loadBytes = await writeFixture(
      loadBoardName,
      buildBoard(boardItems, pencilPoints).board,
    );
    forceGc();
    await maybeWriteProfiles(async () => {
      return bench(
        "load",
        "load large board",
        `${boardItems} items from ${formatMiB(loadBytes)}`,
        async () => {
          const startedAt = performance.now();
          const board = await BoardData.load(loadBoardName, config);
          clearPendingSave(board);
          return { timeMs: performance.now() - startedAt, retain: board };
        },
      );
    });
  }

  if (shouldRun("persist")) {
    const persistFixture = buildBoard(boardItems, persistPoints);
    const pencilIds = persistFixture.pencilIds;
    const shapeIds = persistFixture.shapeIds;
    await writeFixture(persistTemplateName, persistFixture.board);
    forceGc();
    let persistBytes = 0;
    await maybeWriteProfiles(async () => {
      return bench(
        "persist",
        "persist modifications to large board",
        () =>
          `${boardItems} items, ${persistPencilUpdates} pencil appends, ${persistShapeUpdates} transforms, wrote ${formatMiB(persistBytes)}`,
        async () => {
          await fsp.copyFile(
            boardSvgPath(persistTemplateName, historyDir),
            boardSvgPath(persistBoardName, historyDir),
          );
          const board = await BoardData.load(persistBoardName, config);
          board.delaySave = () => {};
          clearPendingSave(board);
          for (const id of pencilIds.slice(0, persistPencilUpdates)) {
            const bounds = board.itemsById.get(id)?.bounds;
            const result = board.processMessage({
              tool: Pencil.id,
              type: MutationType.APPEND,
              parent: id,
              x: (bounds?.maxX ?? 0) + 1,
              y: (bounds?.maxY ?? 0) + 1,
            });
            if (!result.ok) throw new Error(result.reason);
          }
          for (const id of shapeIds.slice(0, persistShapeUpdates)) {
            const result = board.processMessage({
              tool: Hand.id,
              type: MutationType.UPDATE,
              id,
              transform: { a: 1, b: 0, c: 0, d: 1, e: 12, f: 18 },
            });
            if (!result.ok) throw new Error(result.reason);
          }
          const startedAt = performance.now();
          await board.save();
          persistBytes = (
            await fsp.stat(boardSvgPath(persistBoardName, historyDir))
          ).size;
          clearPendingSave(board);
          return { timeMs: performance.now() - startedAt, retain: board };
        },
      );
    });
  }

  if (shouldRun("broadcast")) {
    const broadcastMessages = buildBroadcastMessages();
    forceGc();
    await maybeWriteProfiles(async () => {
      return bench(
        "broadcast",
        "server broadcast throughput",
        `${broadcastCount} mixed socket broadcasts`,
        async (index) => {
          const board = new BoardData(`bench-broadcast-${index}`, config);
          board.delaySave = () => {};
          board.board = buildBroadcastSeed();
          socketsTest.resetRateLimitMaps();
          setLoadedBoard(board.name, Promise.resolve(board));
          const socketContext = createBenchmarkSocket(
            board.name,
            `bench-socket-${index}`,
          );
          await socketsTest.handleSocketConnection(
            socketContext.socket,
            broadcastBenchmarkConfig,
          );
          const broadcast = socketContext.handlers.broadcast;
          if (typeof broadcast !== "function") {
            throw new Error("broadcast benchmark socket handler missing");
          }
          const startedAt = performance.now();
          for (const message of broadcastMessages) {
            socketContext.clearRejected();
            await broadcast(message);
            const rejected = socketContext.getRejected();
            if (rejected)
              throw new Error(
                `broadcast benchmark rejected message ${JSON.stringify(message)}: ${JSON.stringify(rejected)}`,
              );
          }
          const timeMs = performance.now() - startedAt;
          clearPendingSave(board);
          deleteLoadedBoard(board.name);
          return { timeMs, retain: board };
        },
      );
    });
  }
} finally {
  clearTimeout(timeout);
  await fsp.rm(historyDir, { recursive: true, force: true });
}
