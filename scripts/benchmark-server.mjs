import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { once } from "node:events";

import { BoardData } from "../server/boardData.mjs";
import {
  createBroadcastRateLimits,
  processBoardBroadcastMessage,
} from "../server/broadcast_processing.mjs";
import { readConfiguration } from "../server/configuration.mjs";
import { renderBoardToSVG } from "../server/createSVG.mjs";
import { writeBoardState } from "../server/svg_board_store.mjs";
import { streamingUpdate } from "../server/streaming_stored_svg_update.mjs";

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
const STREAM_UPDATE_PENCIL_POINTS = Math.max(8, config.MAX_CHILDREN - 4);
const SNAPSHOT_BOARD_ITEMS = 24000;
const OVERFULL_BOARD_ITEMS = config.MAX_ITEM_COUNT + 2048;
const HAND_BATCH_ITEMS = config.MAX_CHILDREN;
const HAND_BATCH_PASSES = 96;
const EXPORT_PENCIL_SHAPES = 768;
const BROADCAST_BENCH_MESSAGE_COUNT = 1000;
const BROADCAST_PER_MESSAGE_LIMIT_MS = 0.5;
const BROADCAST_CURSOR_MESSAGES = 420;
const BROADCAST_PENCIL_CHILD_MESSAGES = 300;
const BROADCAST_INVALID_MESSAGES = 80;
const BROADCAST_HAND_COPY_MESSAGES = 40;
const BROADCAST_HAND_UPDATE_MESSAGES = 40;
const BROADCAST_HAND_DELETE_MESSAGES = 20;
const BROADCAST_TEXT_UPDATE_MESSAGES = 60;
const BROADCAST_TEXT_NEW_MESSAGES = 20;
const BROADCAST_SHAPE_MESSAGES = 20;
const BROADCAST_CHILD_PARENT_COUNT = 100;
const BROADCAST_CHILDREN_PER_PARENT = config.MAX_CHILDREN - 3;

/** @typedef {{heapUsed: number, rss: number}} MemorySnapshot */
/** @typedef {{[id: string]: any}} BenchBoard */
/** @typedef {{file: string, bytes: number}} BenchFixture */
/** @typedef {{details: string, metrics?: {[name: string]: number}}} BenchRunResult */
/** @typedef {{durationMs: number, activeHeapDelta: number, retainedHeapDelta: number, rssDelta: number, details: string, metrics: {[name: string]: number}}} BenchSample */
/** @typedef {{name: string, prepare?: () => Promise<void>, setup: () => Promise<any>, run: (context: any) => Promise<string | BenchRunResult>, teardown?: (context: any) => Promise<void>, assert?: (samples: BenchSample[]) => void}} Scenario */

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
  if (milliseconds < 1) {
    return `${milliseconds.toFixed(3)} ms`;
  }
  if (milliseconds < 10) {
    return `${milliseconds.toFixed(2)} ms`;
  }
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

/**
 * @param {number[]} values
 * @param {number} fraction
 * @returns {number}
 */
function percentile(values, fraction) {
  if (values.length === 0) {
    throw new Error("percentile requires at least one value");
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  const value = sorted[index];
  if (value === undefined) {
    throw new Error("percentile could not resolve a value");
  }
  return value;
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
 * @returns {string}
 */
function boardSvgFile(name) {
  return path.join(historyDir, `board-${encodeURIComponent(name)}.svg`);
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
 * @param {string} name
 * @param {BenchBoard} board
 * @returns {Promise<BenchFixture>}
 */
async function writeMigratedSvgFixture(name, board) {
  await writeBoardState(
    name,
    Object.fromEntries(
      Object.entries(board).map(([id, item]) => [id, { id, ...item }]),
    ),
    { readonly: false },
    0,
    { historyDir },
  );
  const file = boardSvgFile(name);
  const stat = await fsp.stat(file);
  return { file, bytes: stat.size };
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
 * @param {number} index
 * @returns {any}
 */
function cursorMessage(index) {
  return {
    tool: "Cursor",
    type: "update",
    color: DEFAULT_COLOR,
    size: 3,
    x: (index * 17) % 8192,
    y: (index * 19) % 8192,
  };
}

/**
 * @param {string} parentId
 * @param {number} index
 * @returns {any}
 */
function pencilChildMessage(parentId, index) {
  const point = pencilPoints(1, 32_000 + index * 2)[0];
  if (!point) throw new Error("missing pencil child point");
  return {
    tool: "Pencil",
    type: "child",
    parent: parentId,
    x: point.x,
    y: point.y,
  };
}

/**
 * @param {string} id
 * @param {number} index
 * @returns {any}
 */
function textNewMessage(id, index) {
  const { time, ...message } = textItem(index);
  void time;
  return {
    ...message,
    id,
  };
}

/**
 * @param {string} id
 * @param {number} index
 * @returns {any}
 */
function textUpdateMessage(id, index) {
  return {
    tool: "Text",
    type: "update",
    id,
    txt: textItem(index).txt,
  };
}

/**
 * @param {string} id
 * @param {number} index
 * @returns {any}
 */
function rectangleMessage(id, index) {
  const { time, ...message } = rectangleItem(index);
  void time;
  return {
    ...message,
    id,
  };
}

/**
 * @param {string} id
 * @param {number} index
 * @returns {any}
 */
function straightLineMessage(id, index) {
  const { time, ...message } = lineItem(index);
  void time;
  return {
    ...message,
    id,
  };
}

/**
 * @param {string} id
 * @param {string} newId
 * @returns {any}
 */
function handCopyMessage(id, newId) {
  return {
    tool: "Hand",
    _children: [{ type: "copy", id, newid: newId }],
  };
}

/**
 * @param {string} id
 * @param {number} index
 * @returns {any}
 */
function handTranslateMessage(id, index) {
  return {
    tool: "Hand",
    _children: [
      {
        type: "update",
        id,
        transform: {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: index + 1,
          f: (index + 1) * 2,
        },
      },
    ],
  };
}

/**
 * @param {string} id
 * @returns {any}
 */
function handDeleteMessage(id) {
  return {
    tool: "Hand",
    _children: [{ type: "delete", id }],
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
 * @returns {BenchBoard}
 */
function buildBroadcastBenchBoard() {
  const board = buildMixedBoard(
    DENSE_BOARD_ITEMS,
    DENSE_BOARD_PENCIL_EVERY,
    DENSE_PENCIL_POINTS,
  );

  for (let index = 0; index < BROADCAST_CHILD_PARENT_COUNT; index++) {
    board[`bench-pencil-parent-${index}`] = pencilItem(
      200_000 + index,
      BROADCAST_CHILDREN_PER_PARENT,
    );
  }
  for (let index = 0; index < BROADCAST_HAND_COPY_MESSAGES; index++) {
    board[`bench-copy-source-${index}`] = pencilItem(
      300_000 + index,
      DENSE_PENCIL_POINTS,
    );
  }
  for (let index = 0; index < BROADCAST_TEXT_UPDATE_MESSAGES; index++) {
    board[`bench-text-${index}`] = {
      ...textItem(400_000 + index),
      txt: `bench-text-${index}`,
    };
  }
  for (let index = 0; index < BROADCAST_HAND_DELETE_MESSAGES; index++) {
    board[`bench-shape-${index}`] = rectangleItem(500_000 + index);
  }

  return board;
}

/**
 * @param {any[][]} groups
 * @returns {any[]}
 */
function interleaveMessageGroups(groups) {
  const messages = [];
  for (
    let index = 0;
    messages.length < BROADCAST_BENCH_MESSAGE_COUNT;
    index++
  ) {
    let added = false;
    for (const group of groups) {
      const message = group[index];
      if (message === undefined) continue;
      messages.push(message);
      added = true;
    }
    if (!added) break;
  }
  return messages;
}

/**
 * @param {number} limit
 * @param {number} periodMs
 * @returns {{limit: number, periodMs: number, overrides: {}}}
 */
function makeRateLimitDefinition(limit, periodMs) {
  return { limit, periodMs, overrides: {} };
}

/**
 * @param {AsyncIterable<string>} input
 * @param {string} file
 * @returns {Promise<void>}
 */
async function writeAsyncTextToFile(input, file) {
  const stream = fs.createWriteStream(file, { encoding: "utf8" });
  try {
    for await (const chunk of input) {
      if (!stream.write(chunk)) {
        await once(stream, "drain");
      }
    }
    stream.end();
    await once(stream, "finish");
  } finally {
    if (!stream.closed) {
      stream.destroy();
    }
  }
}

/**
 * @returns {any[]}
 */
function buildBroadcastBenchMessages() {
  const cursorMessages = Array.from(
    { length: BROADCAST_CURSOR_MESSAGES },
    (_, index) => cursorMessage(index),
  );
  const pencilChildMessages = Array.from(
    { length: BROADCAST_PENCIL_CHILD_MESSAGES },
    (_, index) =>
      pencilChildMessage(
        `bench-pencil-parent-${index % BROADCAST_CHILD_PARENT_COUNT}`,
        index,
      ),
  );
  const invalidMessages = [
    ...Array.from({ length: 20 }, (_, index) => {
      const { color, size, ...message } = cursorMessage(index);
      void color;
      void size;
      return message;
    }),
    ...Array.from(
      { length: 20 },
      (_, index) =>
        /** @type {any} */ ({
          ...handCopyMessage(
            `bench-copy-source-${index}`,
            `invalid-copy-${index}`,
          ),
          _children: [{ type: "copy", id: `bench-copy-source-${index}` }],
        }),
    ),
    ...Array.from({ length: 20 }, (_, index) =>
      pencilChildMessage(`missing-parent-${index}`, index),
    ),
    ...Array.from({ length: 20 }, (_, index) =>
      textUpdateMessage(`missing-text-${index}`, index),
    ),
  ];
  const handCopyMessages = Array.from(
    { length: BROADCAST_HAND_COPY_MESSAGES },
    (_, index) =>
      handCopyMessage(
        `bench-copy-source-${index}`,
        `bench-copy-target-${index}`,
      ),
  );
  const handUpdateMessages = Array.from(
    { length: BROADCAST_HAND_UPDATE_MESSAGES },
    (_, index) => handTranslateMessage(`bench-copy-source-${index}`, index),
  );
  const handDeleteMessages = Array.from(
    { length: BROADCAST_HAND_DELETE_MESSAGES },
    (_, index) => handDeleteMessage(`bench-shape-${index}`),
  );
  const textUpdateMessages = Array.from(
    { length: BROADCAST_TEXT_UPDATE_MESSAGES },
    (_, index) => textUpdateMessage(`bench-text-${index}`, 600_000 + index),
  );
  const textNewMessages = Array.from(
    { length: BROADCAST_TEXT_NEW_MESSAGES },
    (_, index) => textNewMessage(`bench-text-new-${index}`, 700_000 + index),
  );
  const shapeMessages = Array.from(
    { length: BROADCAST_SHAPE_MESSAGES },
    (_, index) =>
      index % 2 === 0
        ? rectangleMessage(`bench-rect-${index}`, 800_000 + index)
        : straightLineMessage(`bench-line-${index}`, 900_000 + index),
  );

  const messages = interleaveMessageGroups([
    cursorMessages,
    pencilChildMessages,
    invalidMessages,
    handCopyMessages,
    handUpdateMessages,
    handDeleteMessages,
    textUpdateMessages,
    textNewMessages,
    shapeMessages,
  ]);
  if (messages.length !== BROADCAST_BENCH_MESSAGE_COUNT) {
    throw new Error(
      `expected ${BROADCAST_BENCH_MESSAGE_COUNT} benchmark messages, got ${messages.length}`,
    );
  }
  return messages;
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
 * @param {(context: any) => Promise<string | BenchRunResult>} run
 * @param {any} context
 * @returns {Promise<BenchSample>}
 */
async function runMeasuredSample(run, context) {
  forceGc();
  const before = snapshotMemory();
  const startedAt = performance.now();
  const result = await run(context);
  const active = snapshotMemory();
  const durationMs = performance.now() - startedAt;
  forceGc();
  const retained = snapshotMemory();
  const normalizedResult =
    typeof result === "string" ? { details: result, metrics: {} } : result;
  return {
    durationMs,
    activeHeapDelta: active.heapUsed - before.heapUsed,
    retainedHeapDelta: retained.heapUsed - before.heapUsed,
    rssDelta: active.rss - before.rss,
    details: normalizedResult.details,
    metrics: normalizedResult.metrics || {},
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
  scenario.assert?.(samples);
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
    /** @type {{loadDense?: BenchFixture, snapshot?: BenchFixture, saveDense?: BenchFixture, streamUpdate?: BenchFixture, exportDense?: BenchFixture, broadcastDense?: BenchFixture}} */
    const fixtures = {};
    const broadcastBenchMessages = buildBroadcastBenchMessages();
    const broadcastBenchConfig = {
      ...config,
      GENERAL_RATE_LIMITS: makeRateLimitDefinition(
        2 * BROADCAST_BENCH_MESSAGE_COUNT,
        10_000,
      ),
      CONSTRUCTIVE_ACTION_RATE_LIMITS: makeRateLimitDefinition(
        2 * BROADCAST_BENCH_MESSAGE_COUNT,
        10_000,
      ),
      DESTRUCTIVE_ACTION_RATE_LIMITS: makeRateLimitDefinition(
        2 * BROADCAST_BENCH_MESSAGE_COUNT,
        10_000,
      ),
      TEXT_CREATION_RATE_LIMITS: makeRateLimitDefinition(
        2 * BROADCAST_BENCH_MESSAGE_COUNT,
        10_000,
      ),
    };
    const broadcastBenchSocket =
      /** @type {import("../types/server-runtime.d.ts").AppSocket} */ ({
        id: "bench-broadcast-socket",
        handshake: { query: {} },
      });

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
            boardData.authoritativeItemCount() +
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
            context.boardData.authoritativeItemCount() +
            " items stringified and written as " +
            bytesToMiB(stat.size) +
            " from " +
            bytesToMiB(context.fixture.bytes)
          );
        },
      },
      {
        name: "stream persisted board updates through svg rewrite",
        prepare: async () => {
          fixtures.streamUpdate = await writeMigratedSvgFixture(
            "bench-stream-update-board",
            buildMixedBoard(
              DENSE_BOARD_ITEMS,
              DENSE_BOARD_PENCIL_EVERY,
              STREAM_UPDATE_PENCIL_POINTS,
            ),
          );
        },
        setup: async () => {
          const nextPencilPoint = pencilPoints(
            STREAM_UPDATE_PENCIL_POINTS + 1,
            0,
          )[STREAM_UPDATE_PENCIL_POINTS];
          if (!nextPencilPoint) {
            throw new Error("missing streaming benchmark pencil point");
          }
          return {
            fixture: fixtures.streamUpdate,
            outputFile: boardSvgFile("bench-stream-update-output"),
            mutations: [
              {
                tool: "Rectangle",
                type: "update",
                id: "item-3",
                x2: 64,
                y2: 72,
              },
              {
                tool: "Text",
                type: "update",
                id: "item-2",
                txt: "bench-streaming-update",
              },
              {
                tool: "Pencil",
                type: "child",
                parent: "item-0",
                x: nextPencilPoint.x,
                y: nextPencilPoint.y,
              },
              {
                tool: "Hand",
                type: "copy",
                id: "item-3",
                newid: "stream-copy-rect",
              },
              {
                tool: "Rectangle",
                type: "rect",
                id: "stream-new-rect",
                color: DEFAULT_COLOR,
                size: 2,
                x: 700,
                y: 710,
                x2: 740,
                y2: 760,
              },
            ],
          };
        },
        run: async (context) => {
          /** @type {{parsedExistingItems?: number}} */
          const stats = {};
          await writeAsyncTextToFile(
            streamingUpdate(
              fs.createReadStream(context.fixture.file, { encoding: "utf8" }),
              context.mutations,
              {
                metadata: { readonly: false },
                toSeqInclusive: context.mutations.length,
                stats,
              },
            ),
            context.outputFile,
          );
          const stat = await fsp.stat(context.outputFile);
          const parsedExistingItems = stats.parsedExistingItems || 0;
          return {
            details:
              context.mutations.length +
              " queued mutations streamed " +
              bytesToMiB(stat.size) +
              " from " +
              bytesToMiB(context.fixture.bytes) +
              " with " +
              parsedExistingItems +
              " parsed existing items",
            metrics: {
              parsedExistingItems,
            },
          };
        },
        assert: (samples) => {
          for (const sample of samples) {
            const parsedExistingItems = sample.metrics.parsedExistingItems;
            if (typeof parsedExistingItems !== "number") {
              throw new Error("streaming update benchmark metrics missing");
            }
            if (!(parsedExistingItems > 0 && parsedExistingItems <= 3)) {
              throw new Error(
                `streaming update benchmark parsed ${parsedExistingItems} existing items; expected <= 3`,
              );
            }
          }
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
      {
        name: "process heterogeneous socket broadcasts",
        prepare: async () => {
          fixtures.broadcastDense = await writeBoardFile(
            "bench-broadcast-processing",
            buildBroadcastBenchBoard(),
          );
        },
        setup: async () => {
          const boardData = await BoardData.load("bench-broadcast-processing");
          clearPendingSave(boardData);
          return {
            boardData,
            messages: broadcastBenchMessages,
            rateLimits: createBroadcastRateLimits(Date.now()),
          };
        },
        run: async (context) => {
          const sampleNow = Date.now();
          let successCount = 0;
          let invalidCount = 0;
          let normalizeRejects = 0;
          let rateLimitRejects = 0;
          let policyRejects = 0;
          let processRejects = 0;
          let overLimitCount = 0;
          /** @type {number[]} */
          const perMessageDurations = [];

          for (const [index, message] of context.messages.entries()) {
            const messageStartedAt = performance.now();
            const result = processBoardBroadcastMessage(
              broadcastBenchConfig,
              context.boardData.name,
              context.boardData,
              message,
              broadcastBenchSocket,
              {
                rateLimits: context.rateLimits,
                now: sampleNow + index,
              },
            );
            const durationMs = performance.now() - messageStartedAt;
            perMessageDurations.push(durationMs);
            if (durationMs > BROADCAST_PER_MESSAGE_LIMIT_MS) {
              overLimitCount += 1;
            }
            if (result.ok) {
              successCount += 1;
            } else {
              invalidCount += 1;
              switch (result.stage) {
                case "normalize":
                  normalizeRejects += 1;
                  break;
                case "rate_limit":
                  rateLimitRejects += 1;
                  break;
                case "policy":
                  policyRejects += 1;
                  break;
                case "process":
                  processRejects += 1;
                  break;
              }
            }
          }

          clearPendingSave(context.boardData);
          const maxMessageMs = Math.max.apply(null, perMessageDurations);
          const p95MessageMs = percentile(perMessageDurations, 0.95);
          const meanMessageMs =
            perMessageDurations.reduce((sum, value) => sum + value, 0) /
            perMessageDurations.length;
          return {
            details:
              `${successCount} accepted, ${invalidCount} rejected ` +
              `(normalize ${normalizeRejects}, rate-limit ${rateLimitRejects}, policy ${policyRejects}, process ${processRejects}); ` +
              `mean ${formatMs(meanMessageMs)}, p95 ${formatMs(p95MessageMs)}, max ${formatMs(maxMessageMs)}`,
            metrics: {
              meanMessageMs,
              p95MessageMs,
              maxMessageMs,
              overLimitCount,
            },
          };
        },
        teardown: async (context) => {
          clearPendingSave(context.boardData);
        },
        assert: (samples) => {
          const overLimitCounts = samples.map(
            (sample) => sample.metrics.overLimitCount || 0,
          );
          const maxMessageDurations = samples.map(
            (sample) => sample.metrics.maxMessageMs || 0,
          );
          const medianOverLimitCount = median(overLimitCounts);
          const medianMaxMessageMs = median(maxMessageDurations);
          if (
            medianOverLimitCount > 0 ||
            medianMaxMessageMs > BROADCAST_PER_MESSAGE_LIMIT_MS
          ) {
            throw new Error(
              "heterogeneous socket broadcast benchmark exceeded limit: " +
                `${medianOverLimitCount} median over-limit messages, ` +
                `median max ${formatMs(medianMaxMessageMs)} ` +
                `> ${formatMs(BROADCAST_PER_MESSAGE_LIMIT_MS)}`,
            );
          }
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
