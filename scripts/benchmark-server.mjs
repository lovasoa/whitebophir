import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

const historyDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wbo-bench-"));
process.env.WBO_HISTORY_DIR = historyDir;
process.env.WBO_SILENT ||= "true";

const { BoardData } = await import("../server/boardData.mjs");
const { processBoardBroadcastMessage } = await import(
  "../server/broadcast_processing.mjs"
);
const { MutationType } = await import("../client-data/js/mutation_type.js");
const { Hand, Pencil, Rectangle, Text } = await import(
  "../client-data/tools/index.js"
);
const { readConfiguration } = await import("../server/configuration.mjs");
const { boardSvgPath, writeBoardState } = await import(
  "../server/svg_board_store.mjs"
);

const config = readConfiguration();
const scenario = (process.argv[2] || "all").toLowerCase();
const sampleCount = 3;
const boardItems = 18_000;
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
const browserSampleCount = 1;
/** @typedef {string | (() => string)} BenchmarkDetails */
/** @typedef {{timeMs: number, metric?: number, details?: string}} BenchmarkSample */

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

/** @param {string} name */ const shouldRun = (name) =>
  scenario === "all" || scenario === name;
const forceGc = () =>
  typeof global.gc === "function" && (global.gc(), global.gc());
/** @param {number[]} values */ const median = (values) =>
  values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;
/** @param {number} value */ const formatMs = (value) =>
  value < 10 ? `${value.toFixed(2)} ms` : `${value.toFixed(1)} ms`;
/** @param {number} bytes */ const formatMiB = (bytes) =>
  `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
/** @param {string} name @param {number[]} times @param {string} details @param {{label: string, values: number[]} | undefined} metric */
function printResult(name, times, details, metric) {
  const sorted = times.slice().sort((a, b) => a - b);
  console.log(name);
  console.log(
    `  time median: ${formatMs(median(times))} (${formatMs(sorted[0] || 0)}..${formatMs(sorted.at(-1) || 0)})`,
  );
  console.log(`  samples:     ${times.length}`);
  if (metric)
    console.log(`  ${metric.label}: ${median(metric.values).toFixed(1)}`);
  console.log(`  details:     ${details}`);
  console.log("");
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
        size: 4,
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
        size: 2,
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
          size: 2,
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
      size: 2,
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
      y: index,
      txt: `seed-${index}`,
    };
  }
  for (let index = 0; index < 100; index += 1) {
    board[`pencil-${index}`] = {
      id: `pencil-${index}`,
      tool: "pencil",
      type: "path",
      color,
      size: 4,
      _children: [
        { x: index, y: index },
        { x: index + 4, y: index + 6 },
      ],
    };
  }
  return board;
}
const broadcastMessages = Array.from({ length: broadcastCount }, (_, index) => {
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
    size: 2,
    x: index % 3000,
    y: (index * 2) % 3000,
    x2: (index % 3000) + 20,
    y2: ((index * 2) % 3000) + 16,
  };
});
/** @param {string} name @param {{[id: string]: any}} board */
async function writeFixture(name, board) {
  await writeBoardState(name, board, { readonly: false }, 0, { historyDir });
  return (await fsp.stat(boardSvgPath(name, historyDir))).size;
}
/** @param {string} name @param {BenchmarkDetails | undefined} details @param {(index: number) => Promise<BenchmarkSample>} run @param {string} [metricLabel] @param {number} [count] */
async function bench(name, details, run, metricLabel, count = sampleCount) {
  const times = [],
    metrics = [];
  let finalDetails = typeof details === "function" ? details() : details || "";
  for (let index = 0; index < count; index += 1) {
    const sample = await run(index);
    times.push(sample.timeMs);
    if (sample.metric !== undefined) metrics.push(sample.metric);
    if (sample.details) finalDetails = sample.details;
  }
  printResult(
    name,
    times,
    finalDetails,
    metricLabel ? { label: metricLabel, values: metrics } : undefined,
  );
}
const loadFixture = buildBoard(boardItems, pencilPoints);
const persistFixture = buildBoard(boardItems, persistPoints);
const loadBoardName = "bench-load";
const persistTemplateName = "bench-persist-template";
const persistBoardName = "bench-persist";
const loadBytes = await writeFixture(loadBoardName, loadFixture.board);
await writeFixture(persistTemplateName, persistFixture.board);
const timeout = setTimeout(() => {
  console.error(`benchmark timed out after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);
let persistBytes = 0;
try {
  if (shouldRun("e2e")) {
    const { runPeerVisibleEraseBenchmark } = await import(
      "./benchmark-peer-visible-erase.mjs"
    );
    await bench(
      "open large board to peer-visible erase",
      undefined,
      async () => runPeerVisibleEraseBenchmark(config.MAX_CHILDREN),
      undefined,
      browserSampleCount,
    );
  }

  if (shouldRun("load")) {
    await bench(
      "load large board",
      `${boardItems} items from ${formatMiB(loadBytes)}`,
      async () => {
        forceGc();
        const startedAt = performance.now();
        const board = await BoardData.load(loadBoardName);
        clearPendingSave(board);
        return { timeMs: performance.now() - startedAt };
      },
    );
  }

  if (shouldRun("persist")) {
    await bench(
      "persist modifications to large board",
      () =>
        `${boardItems} items, ${persistPencilUpdates} pencil appends, ${persistShapeUpdates} transforms, wrote ${formatMiB(persistBytes)}`,
      async () => {
        await fsp.copyFile(
          boardSvgPath(persistTemplateName, historyDir),
          boardSvgPath(persistBoardName, historyDir),
        );
        const board = await BoardData.load(persistBoardName);
        board.delaySave = () => {};
        clearPendingSave(board);
        for (const id of persistFixture.pencilIds.slice(
          0,
          persistPencilUpdates,
        )) {
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
        for (const id of persistFixture.shapeIds.slice(
          0,
          persistShapeUpdates,
        )) {
          const result = board.processMessage({
            tool: Hand.id,
            type: MutationType.UPDATE,
            id,
            transform: { a: 1, b: 0, c: 0, d: 1, e: 12, f: 18 },
          });
          if (!result.ok) throw new Error(result.reason);
        }
        forceGc();
        const startedAt = performance.now();
        await board.save();
        persistBytes = (
          await fsp.stat(boardSvgPath(persistBoardName, historyDir))
        ).size;
        clearPendingSave(board);
        return { timeMs: performance.now() - startedAt };
      },
    );
  }

  if (shouldRun("broadcast")) {
    await bench(
      "server broadcast throughput",
      `${broadcastCount} mixed socket broadcasts`,
      async (index) => {
        const board = new BoardData(`bench-broadcast-${index}`);
        board.delaySave = () => {};
        board.board = buildBroadcastSeed();
        forceGc();
        const startedAt = performance.now();
        for (const message of broadcastMessages) {
          const result = processBoardBroadcastMessage(
            config,
            board.name,
            board,
            message,
            /** @type {any} */ ({
              id: "bench-socket",
              handshake: { query: {} },
              client: { request: { socket: { remoteAddress: "127.0.0.1" } } },
              emit: () => true,
              disconnect: () => true,
              rooms: new Set(),
              boardName: board.name,
              turnstileValidatedUntil: Date.now() + 60_000,
              user: undefined,
            }),
            { now: Date.now() },
          );
          if (!result.ok)
            throw new Error(
              `broadcast benchmark rejected message: ${result.reason}`,
            );
        }
        const timeMs = performance.now() - startedAt;
        clearPendingSave(board);
        return { timeMs, metric: (broadcastCount / timeMs) * 1000 };
      },
      "broadcasts/s",
    );
  }
} finally {
  clearTimeout(timeout);
  await fsp.rm(historyDir, { recursive: true, force: true });
}
