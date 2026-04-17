import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

import { BoardData } from "../server/boardData.mjs";
import { readConfiguration } from "../server/configuration.mjs";
import { renderBoardToSVG } from "../server/createSVG.mjs";

const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbo-server-bench-"));
process.env.WBO_HISTORY_DIR = historyDir;
process.env.WBO_SILENT = process.env.WBO_SILENT || "true";

const config = readConfiguration();

const DEFAULT_COLOR = "#1f2937";
const WARMUP_COUNT = 1;
const SAMPLE_COUNT = 5;
const DEFAULT_BENCH_TIMEOUT_MS = 150_000;
const DENSE_BOARD_ITEMS = 18000;
const DENSE_BOARD_PENCIL_EVERY = 6;
const DENSE_PENCIL_POINTS = config.MAX_CHILDREN;
const SNAPSHOT_BOARD_ITEMS = 24000;
const OVERFULL_BOARD_ITEMS = config.MAX_ITEM_COUNT + 2048;
const HAND_BATCH_ITEMS = config.MAX_CHILDREN;
const HAND_BATCH_PASSES = 96;
const EXPORT_PENCIL_SHAPES = 768;

/** @typedef {{heapUsed: number, rss: number}} MemorySnapshot */
/** @typedef {{[id: string]: any}} BenchBoard */
/** @typedef {{file: string, bytes: number}} BenchFixture */
/** @typedef {{durationMs: number, activeHeapDelta: number, retainedHeapDelta: number, rssDelta: number, details: string}} BenchSample */
/** @typedef {{name: string, prepare?: () => Promise<void>, setup: () => Promise<any>, run: (context: any) => Promise<string>, teardown?: (context: any) => Promise<void>}} Scenario */

/**
 * @param {number} bytes
 * @returns {string}
 */
function bytesToMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatDelta(bytes) {
  const sign = bytes >= 0 ? "+" : "-";
  return sign + bytesToMiB(Math.abs(bytes));
}

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function formatMs(milliseconds) {
  return `${milliseconds.toFixed(1)} ms`;
}

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function formatTimeout(milliseconds) {
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  return `${(milliseconds / 1000).toFixed(milliseconds % 1000 === 0 ? 0 : 1)} s`;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (sorted.length === 0) {
    throw new Error("median requires at least one value");
  }
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) {
    throw new Error("median could not resolve the middle value");
  }
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? current) + current) / 2
    : current;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function spreadPercent(values) {
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  const mid = median(values);
  return mid === 0 ? 0 : ((max - min) / mid) * 100;
}

function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
    global.gc();
  }
}

/**
 * @returns {MemorySnapshot}
 */
function snapshotMemory() {
  const memory = process.memoryUsage();
  return {
    heapUsed: memory.heapUsed,
    rss: memory.rss,
  };
}

/**
 * @param {string | undefined} rawValue
 * @returns {number}
 */
function readBenchTimeoutMs(rawValue) {
  const value = rawValue ?? String(DEFAULT_BENCH_TIMEOUT_MS);
  const timeoutMs = Number.parseInt(value, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(
      `WBO_BENCH_TIMEOUT_MS must be a non-negative integer, got ${JSON.stringify(rawValue)}`,
    );
  }
  return timeoutMs;
}

/**
 * @param {string} name
 * @returns {string}
 */
function boardFile(name) {
  return path.join(historyDir, `board-${encodeURIComponent(name)}.json`);
}

/**
 * @param {string} name
 * @param {BenchBoard} board
 * @returns {Promise<BenchFixture>}
 */
async function writeBoardFile(name, board) {
  const file = boardFile(name);
  const text = JSON.stringify(board);
  await fsp.writeFile(file, text);
  return { file, bytes: Buffer.byteLength(text) };
}

/**
 * @param {number} index
 * @returns {any}
 */
function rectangleItem(index) {
  const base = index * 3;
  return {
    tool: "Rectangle",
    type: "rect",
    color: DEFAULT_COLOR,
    size: 2,
    x: base % 6000,
    y: Math.floor(base / 4) % 6000,
    x2: (base % 6000) + 40,
    y2: (Math.floor(base / 4) % 6000) + 24,
    time: index,
  };
}

/**
 * @param {number} index
 * @returns {any}
 */
function textItem(index) {
  return {
    tool: "Text",
    type: "new",
    color: DEFAULT_COLOR,
    size: 18,
    x: (index * 7) % 7000,
    y: (index * 11) % 7000,
    txt: `bench-${index}-payload`,
    time: index,
  };
}

/**
 * @param {number} index
 * @returns {any}
 */
function lineItem(index) {
  const x = (index * 5) % 6500;
  const y = (index * 9) % 6500;
  return {
    tool: "Straight line",
    type: "straight",
    color: DEFAULT_COLOR,
    size: 2,
    x: x,
    y: y,
    x2: x + 28,
    y2: y + 32,
    time: index,
  };
}

/**
 * @param {number} pointCount
 * @param {number} seed
 * @returns {{x: number, y: number}[]}
 */
function pencilPoints(pointCount, seed) {
  const points = [];
  for (let index = 0; index < pointCount; index++) {
    points.push({
      x: seed + index * 2,
      y: seed + ((index % 8) - 4) * 3 + index,
    });
  }
  return points;
}

/**
 * @param {number} index
 * @param {number} pointCount
 * @returns {any}
 */
function pencilItem(index, pointCount) {
  return {
    tool: "Pencil",
    type: "line",
    color: DEFAULT_COLOR,
    size: 2,
    _children: pencilPoints(pointCount, index * 6),
    time: index,
  };
}

/**
 * @param {number} itemCount
 * @param {number} pencilEvery
 * @param {number} pencilPointsPerShape
 * @returns {BenchBoard}
 */
function buildMixedBoard(itemCount, pencilEvery, pencilPointsPerShape) {
  /** @type {BenchBoard} */
  const board = {};
  for (let index = 0; index < itemCount; index++) {
    const id = `item-${index}`;
    if (index % pencilEvery === 0) {
      board[id] = pencilItem(index, pencilPointsPerShape);
      continue;
    }
    switch (index % 3) {
      case 0:
        board[id] = rectangleItem(index);
        break;
      case 1:
        board[id] = lineItem(index);
        break;
      default:
        board[id] = textItem(index);
        break;
    }
  }
  return board;
}

/**
 * @param {BoardData} boardData
 * @returns {void}
 */
function clearPendingSave(boardData) {
  if (boardData.saveTimeoutId !== undefined) {
    clearTimeout(boardData.saveTimeoutId);
    boardData.saveTimeoutId = undefined;
  }
}

/**
 * @param {(context: any) => Promise<string>} run
 * @param {any} context
 * @returns {Promise<BenchSample>}
 */
async function runMeasuredSample(run, context) {
  forceGc();
  const before = snapshotMemory();
  const startedAt = performance.now();
  const details = await run(context);
  const active = snapshotMemory();
  const durationMs = performance.now() - startedAt;
  forceGc();
  const retained = snapshotMemory();
  return {
    durationMs,
    activeHeapDelta: active.heapUsed - before.heapUsed,
    retainedHeapDelta: retained.heapUsed - before.heapUsed,
    rssDelta: active.rss - before.rss,
    details,
  };
}

/**
 * @param {Scenario} scenario
 * @returns {Promise<void>}
 */
async function measureScenario(scenario) {
  if (scenario.prepare) {
    await scenario.prepare();
  }

  for (let warmup = 0; warmup < WARMUP_COUNT; warmup++) {
    const context = await scenario.setup();
    try {
      await scenario.run(context);
    } finally {
      if (scenario.teardown) await scenario.teardown(context);
    }
  }

  /** @type {BenchSample[]} */
  const samples = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    const context = await scenario.setup();
    try {
      samples.push(await runMeasuredSample(scenario.run, context));
    } finally {
      if (scenario.teardown) await scenario.teardown(context);
    }
  }

  const durations = samples.map((sample) => sample.durationMs);
  const activeHeaps = samples.map((sample) => sample.activeHeapDelta);
  const retainedHeaps = samples.map((sample) => sample.retainedHeapDelta);
  const rssDeltas = samples.map((sample) => sample.rssDelta);
  const representative = samples[Math.floor(samples.length / 2)] || samples[0];
  if (!representative) throw new Error("No benchmark samples recorded");

  console.log(scenario.name);
  console.log(
    "  time median:   " +
      formatMs(median(durations)) +
      " (" +
      formatMs(Math.min.apply(null, durations)) +
      ".." +
      formatMs(Math.max.apply(null, durations)) +
      ", spread " +
      spreadPercent(durations).toFixed(1) +
      "%)",
  );
  console.log(`  heap active:   ${formatDelta(median(activeHeaps))}`);
  console.log(`  heap retained: ${formatDelta(median(retainedHeaps))}`);
  console.log(`  rss delta:     ${formatDelta(median(rssDeltas))}`);
  console.log(`  samples:       ${SAMPLE_COUNT} + ${WARMUP_COUNT} warmup`);
  if (representative.details) {
    console.log(`  details:       ${representative.details}`);
  }
}

async function main() {
  const benchTimeoutMs = readBenchTimeoutMs(process.env.WBO_BENCH_TIMEOUT_MS);
  const timeoutId =
    benchTimeoutMs > 0
      ? setTimeout(() => {
          console.error(
            `benchmark exceeded hard timeout of ${formatTimeout(benchTimeoutMs)} and was aborted`,
          );
          void fsp
            .rm(historyDir, { recursive: true, force: true })
            .finally(() => process.exit(1));
        }, benchTimeoutMs)
      : undefined;
  timeoutId?.unref?.();

  try {
    /** @type {{loadDense?: BenchFixture, snapshot?: BenchFixture, saveDense?: BenchFixture, exportDense?: BenchFixture}} */
    const fixtures = {};

    /** @type {Scenario[]} */
    const scenarios = [
      {
        name: "load dense persisted board",
        prepare: async () => {
          fixtures.loadDense = await writeBoardFile(
            "bench-load-dense-board",
            buildMixedBoard(
              DENSE_BOARD_ITEMS,
              DENSE_BOARD_PENCIL_EVERY,
              DENSE_PENCIL_POINTS,
            ),
          );
        },
        setup: async () => fixtures.loadDense,
        run: async (fixture) => {
          const boardData = await BoardData.load("bench-load-dense-board");
          clearPendingSave(boardData);
          return (
            Object.keys(boardData.board).length +
            " items normalized from " +
            bytesToMiB(fixture.bytes)
          );
        },
      },
      {
        name: "materialize initial board snapshot",
        prepare: async () => {
          fixtures.snapshot = await writeBoardFile(
            "bench-initial-board-snapshot",
            buildMixedBoard(SNAPSHOT_BOARD_ITEMS, 8, 64),
          );
        },
        setup: async () => {
          const boardData = await BoardData.load(
            "bench-initial-board-snapshot",
          );
          clearPendingSave(boardData);
          return { boardData, fixture: fixtures.snapshot };
        },
        run: async (context) => {
          const payload = { _children: context.boardData.getAll() };
          const snapshot = JSON.stringify(payload);
          return (
            payload._children.length +
            " items materialized and serialized to " +
            bytesToMiB(Buffer.byteLength(snapshot)) +
            " from " +
            bytesToMiB(context.fixture.bytes)
          );
        },
      },
      {
        name: "save dense board to disk",
        prepare: async () => {
          fixtures.saveDense = await writeBoardFile(
            "bench-save-dense-board",
            buildMixedBoard(
              DENSE_BOARD_ITEMS,
              DENSE_BOARD_PENCIL_EVERY,
              DENSE_PENCIL_POINTS,
            ),
          );
        },
        setup: async () => {
          const boardData = await BoardData.load("bench-save-dense-board");
          clearPendingSave(boardData);
          return { boardData, fixture: fixtures.saveDense };
        },
        run: async (context) => {
          await context.boardData.save();
          clearPendingSave(context.boardData);
          const stat = await fsp.stat(context.boardData.file);
          return (
            Object.keys(context.boardData.board).length +
            " items stringified and written as " +
            bytesToMiB(stat.size) +
            " from " +
            bytesToMiB(context.fixture.bytes)
          );
        },
      },
      {
        name: "clean and save overfull board",
        setup: async () => {
          const boardData = new BoardData("bench-clean-overfull-board");
          for (let index = 0; index < OVERFULL_BOARD_ITEMS; index++) {
            boardData.board[`overflow-${index}`] = rectangleItem(index);
          }
          return { boardData, beforeCount: OVERFULL_BOARD_ITEMS };
        },
        run: async (context) => {
          await context.boardData.save();
          clearPendingSave(context.boardData);
          const afterCount = Object.keys(context.boardData.board).length;
          const removedCount = context.beforeCount - afterCount;
          const stat = await fsp.stat(context.boardData.file);
          return (
            "cleaned " +
            removedCount +
            " items, kept " +
            afterCount +
            ", wrote " +
            bytesToMiB(stat.size)
          );
        },
      },
      {
        name: "apply hand batch transforms to dense pencils",
        setup: async () => {
          const boardData = new BoardData("bench-hand-batch-move");
          const batches = [];
          for (let index = 0; index < HAND_BATCH_ITEMS; index++) {
            const result = boardData.set(
              `pencil-${index}`,
              pencilItem(index, DENSE_PENCIL_POINTS),
            );
            if (!result.ok) throw new Error(result.reason);
          }
          for (let pass = 0; pass < HAND_BATCH_PASSES; pass++) {
            const delta = pass + 1;
            batches.push({
              tool: "Hand",
              _children: Array.from(
                { length: HAND_BATCH_ITEMS },
                (_, index) => ({
                  type: "update",
                  id: `pencil-${index}`,
                  transform: {
                    a: 1,
                    b: 0,
                    c: 0,
                    d: 1,
                    e: delta * 2,
                    f: delta * 3,
                  },
                }),
              ),
            });
          }
          clearPendingSave(boardData);
          return { boardData, batches };
        },
        run: async (context) => {
          let moved = 0;
          for (const batch of context.batches) {
            const result = context.boardData.processMessage(batch);
            if (!result.ok) throw new Error(result.reason);
            moved += HAND_BATCH_ITEMS;
          }
          clearPendingSave(context.boardData);
          return (
            moved +
            " batched transform updates across " +
            HAND_BATCH_ITEMS +
            " dense pencils"
          );
        },
      },
      {
        name: "export large pencil board to svg",
        prepare: async () => {
          fixtures.exportDense = await writeBoardFile(
            "bench-export-large-pencils",
            buildMixedBoard(EXPORT_PENCIL_SHAPES, 1, DENSE_PENCIL_POINTS),
          );
        },
        setup: async () => fixtures.exportDense,
        run: async (fixture) => {
          const svg = await renderBoardToSVG(fixture.file);
          return (
            EXPORT_PENCIL_SHAPES +
            " dense pencils exported to " +
            bytesToMiB(Buffer.byteLength(svg)) +
            " from " +
            bytesToMiB(fixture.bytes)
          );
        },
      },
    ];

    console.log(`history dir: ${historyDir}`);
    if (benchTimeoutMs > 0) {
      console.log(`hard timeout: ${formatTimeout(benchTimeoutMs)}`);
    } else {
      console.log("hard timeout: disabled");
    }
    if (typeof global.gc !== "function") {
      console.log("note: run with --expose-gc for steadier memory numbers");
    }
    console.log("");

    for (let index = 0; index < scenarios.length; index++) {
      if (index > 0) console.log("");
      const scenario = scenarios[index];
      if (!scenario) throw new Error("missing benchmark scenario");
      await measureScenario(scenario);
    }
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await fsp.rm(historyDir, { recursive: true, force: true });
  });
