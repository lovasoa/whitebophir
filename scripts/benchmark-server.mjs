import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbo-bench-"));

process.env.WBO_HISTORY_DIR = historyDir;
process.env.WBO_SILENT = process.env.WBO_SILENT || "true";

const { BoardData } = await import("../server/boardData.mjs");
const { processBoardBroadcastMessage } = await import(
  "../server/broadcast_processing.mjs"
);
const { MutationType } = await import("../client-data/js/mutation_type.js");
const { Hand, Pencil, Rectangle, Text } = await import(
  "../client-data/tools/index.js"
);
const { readConfiguration } = await import("../server/configuration.mjs");
const { writeBoardState } = await import("../server/svg_board_store.mjs");

const config = readConfiguration();

const DEFAULT_COLOR = "#1f2937";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SAMPLE_COUNT = 3;
const END_TO_END_SAMPLE_COUNT = 1;
const LARGE_BOARD_ITEMS = 18_000;
const LARGE_BOARD_PENCIL_EVERY = 6;
const LARGE_BOARD_PENCIL_POINTS = config.MAX_CHILDREN;
const PERSIST_BOARD_PENCIL_POINTS = Math.max(8, config.MAX_CHILDREN - 4);
const BROWSER_BOARD_ITEMS = 6_000;
const BROWSER_PENCIL_POINTS = Math.min(120, config.MAX_CHILDREN);
const BROADCAST_MESSAGE_COUNT = 20_000;
const PERSIST_PENCIL_UPDATES = 128;
const PERSIST_SHAPE_UPDATES = 128;

/**
 * @typedef {{heapUsed: number, rss: number}} MemorySnapshot
 * @typedef {{name: string, durationMs: number, activeHeapDelta: number, retainedHeapDelta: number, rssDelta: number, metrics: {[name: string]: number}, details: string}} BenchSample
 */

function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
    global.gc();
  }
}

/** @returns {MemorySnapshot} */
function snapshotMemory() {
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, rss: usage.rss };
}

/** @param {number} bytes */
function bytesToMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** @param {number} bytes */
function formatDelta(bytes) {
  const sign = bytes >= 0 ? "+" : "-";
  return sign + bytesToMiB(Math.abs(bytes));
}

/** @param {number} milliseconds */
function formatMs(milliseconds) {
  if (milliseconds < 1) return `${milliseconds.toFixed(3)} ms`;
  if (milliseconds < 10) return `${milliseconds.toFixed(2)} ms`;
  return `${milliseconds.toFixed(1)} ms`;
}

/**
 * @param {string} metricName
 * @param {number} value
 * @returns {string}
 */
function formatMetricValue(metricName, value) {
  if (metricName.endsWith("PerSecond")) {
    return value.toFixed(1);
  }
  if (metricName.endsWith("MiB")) {
    return `${value.toFixed(1)} MiB`;
  }
  return formatMs(value);
}

/** @param {number[]} values */
function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) {
    throw new Error("median requires at least one value");
  }
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? current) + current) / 2
    : current;
}

/** @param {number[]} values */
function rangeText(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined) return "";
  if (sorted.length === 1) return formatMs(min);
  return `${formatMs(median(sorted))} (${formatMs(min)}..${formatMs(max)})`;
}

/**
 * @param {number} itemCount
 * @param {number} pencilEvery
 * @param {number} pencilPoints
 * @returns {{board: {[id: string]: any}, pencilIds: string[], shapeIds: string[], lastPencilId: string}}
 */
function buildBoard(itemCount, pencilEvery, pencilPoints) {
  /** @type {{[id: string]: any}} */
  const board = {};
  /** @type {string[]} */
  const pencilIds = [];
  /** @type {string[]} */
  const shapeIds = [];
  let lastPencilId = "";

  for (let index = 0; index < itemCount; index += 1) {
    const baseX = (index * 13) % 8000;
    const baseY = Math.floor((index * 17) / 3) % 8000;
    if (index % pencilEvery === 0) {
      const id = `pencil-${index}`;
      board[id] = {
        id,
        tool: "pencil",
        type: "path",
        color: DEFAULT_COLOR,
        size: 4,
        _children: Array.from({ length: pencilPoints }, (_, pointIndex) => ({
          x: baseX + pointIndex,
          y: baseY + ((pointIndex * 3) % 120),
        })),
        time: index,
      };
      pencilIds.push(id);
      lastPencilId = id;
      continue;
    }

    if (index % 3 === 0) {
      const id = `rect-${index}`;
      board[id] = {
        id,
        tool: "rectangle",
        type: "rect",
        color: DEFAULT_COLOR,
        size: 2,
        x: baseX,
        y: baseY,
        x2: baseX + 48,
        y2: baseY + 28,
        time: index,
      };
      shapeIds.push(id);
      continue;
    }

    if (index % 3 === 1) {
      const id = `line-${index}`;
      board[id] = {
        id,
        tool: "straight-line",
        type: "line",
        color: DEFAULT_COLOR,
        size: 2,
        x: baseX,
        y: baseY,
        x2: baseX + 36,
        y2: baseY + 22,
        time: index,
      };
      shapeIds.push(id);
      continue;
    }

    const id = `text-${index}`;
    board[id] = {
      id,
      tool: "text",
      type: "text",
      color: DEFAULT_COLOR,
      size: 18,
      x: baseX,
      y: baseY,
      txt: `note-${index}`,
      time: index,
    };
    shapeIds.push(id);
  }

  if (!lastPencilId) {
    throw new Error("board fixture did not contain a pencil stroke");
  }

  return { board, pencilIds, shapeIds, lastPencilId };
}

/**
 * @param {string} name
 * @param {{[id: string]: any}} board
 * @param {string} dir
 * @returns {Promise<{boardName: string, svgFile: string, bytes: number}>}
 */
async function writeSvgFixture(name, board, dir = historyDir) {
  await writeBoardState(name, board, { readonly: false }, 0, {
    historyDir: dir,
  });
  const svgFile = path.join(dir, `board-${encodeURIComponent(name)}.svg`);
  const stats = await fsp.stat(svgFile);
  return { boardName: name, svgFile, bytes: stats.size };
}

/**
 * @param {() => Promise<{details?: string, metrics?: {[name: string]: number}, cleanup?: () => Promise<void> | void}>} run
 * @returns {Promise<Omit<BenchSample, "name">>}
 */
async function measureSample(run) {
  forceGc();
  const before = snapshotMemory();
  const startedAt = performance.now();
  const { details = "", metrics = {}, cleanup } = await run();
  const active = snapshotMemory();
  const durationMs = performance.now() - startedAt;
  if (cleanup) {
    await cleanup();
  }
  forceGc();
  const retained = snapshotMemory();
  return {
    durationMs,
    activeHeapDelta: active.heapUsed - before.heapUsed,
    retainedHeapDelta: retained.heapUsed - before.heapUsed,
    rssDelta: retained.rss - before.rss,
    metrics,
    details,
  };
}

/**
 * @param {string} name
 * @param {number} sampleCount
 * @param {() => Promise<{details?: string, metrics?: {[name: string]: number}, cleanup?: () => Promise<void> | void}>} run
 * @returns {Promise<void>}
 */
async function runBenchmark(name, sampleCount, run) {
  /** @type {BenchSample[]} */
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push({
      name,
      ...(await measureSample(run)),
    });
  }

  const durationValues = samples.map((sample) => sample.durationMs);
  const activeHeapValues = samples.map((sample) => sample.activeHeapDelta);
  const retainedHeapValues = samples.map((sample) => sample.retainedHeapDelta);
  const rssValues = samples.map((sample) => sample.rssDelta);
  const metricNames = [
    ...new Set(samples.flatMap((sample) => Object.keys(sample.metrics))),
  ];

  console.log(name);
  console.log(`  time median:   ${rangeText(durationValues)}`);
  console.log(`  heap active:   ${formatDelta(median(activeHeapValues))}`);
  console.log(`  heap retained: ${formatDelta(median(retainedHeapValues))}`);
  console.log(`  rss delta:     ${formatDelta(median(rssValues))}`);
  console.log(`  samples:       ${sampleCount}`);
  for (const metricName of metricNames) {
    console.log(
      `  ${metricName}: ${formatMetricValue(
        metricName,
        median(samples.map((sample) => sample.metrics[metricName] || 0)),
      )}`,
    );
  }
  const detail = samples[samples.length - 1]?.details;
  if (detail) {
    console.log(`  details:       ${detail}`);
  }
  console.log("");
}

/**
 * @param {string} boardName
 * @param {string} targetId
 * @returns {string}
 */
function benchInitScript(boardName, targetId) {
  return `
    window.__wboBench = {
      boardName: ${JSON.stringify(boardName)},
      targetId: ${JSON.stringify(targetId)},
      navStart: performance.now(),
      renderStartMs: null,
      renderCompleteMs: null,
      eraseDispatchMs: null
    };
    const markRenderStart = () => {
      if (window.__wboBench.renderStartMs !== null) return;
      const drawingArea = document.getElementById("drawingArea");
      if (drawingArea && drawingArea.firstElementChild) {
        window.__wboBench.renderStartMs = performance.now() - window.__wboBench.navStart;
      }
    };
    const observer = new MutationObserver(markRenderStart);
    observer.observe(document, { childList: true, subtree: true });
    const markRenderComplete = () => {
      markRenderStart();
      const tools = window.Tools;
      const target = document.getElementById(window.__wboBench.targetId);
      if (
        window.__wboBench.renderCompleteMs === null &&
        tools &&
        tools.awaitingBoardSnapshot === false &&
        target
      ) {
        window.__wboBench.renderCompleteMs = performance.now() - window.__wboBench.navStart;
        observer.disconnect();
        return;
      }
      requestAnimationFrame(markRenderComplete);
    };
    requestAnimationFrame(markRenderComplete);
  `;
}

/**
 * @param {string} dir
 * @returns {Promise<{baseUrl: string, stop: () => Promise<void>}>}
 */
async function startServer(dir) {
  const child = fork(path.join(repoRoot, "server", "server.mjs"), [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: "0",
      WBO_HISTORY_DIR: dir,
      WBO_SILENT: "true",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(`Timed out waiting for benchmark server start\n${stderr}`),
      );
    }, 10_000);
    child.on("message", (message) => {
      const serverMessage = /** @type {{type?: unknown, port?: unknown}} */ (
        message
      );
      if (
        serverMessage &&
        typeof serverMessage === "object" &&
        serverMessage.type === "server-started"
      ) {
        clearTimeout(timer);
        resolve(serverMessage.port);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Benchmark server exited early (code=${String(code)}, signal=${String(signal)})\n${stderr}`,
        ),
      );
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

function createBroadcastMessages() {
  return Array.from({ length: BROADCAST_MESSAGE_COUNT }, (_, index) => {
    if (index % 4 === 0) {
      return {
        tool: Pencil.id,
        type: MutationType.APPEND,
        parent: `pencil-${index % 100}`,
        x: index % 2000,
        y: (index * 3) % 2000,
      };
    }
    if (index % 4 === 1) {
      return {
        tool: Rectangle.id,
        type: MutationType.UPDATE,
        id: `rect-${index % 500}`,
        x: index % 3000,
        y: (index * 2) % 3000,
        x2: (index % 3000) + 24,
        y2: ((index * 2) % 3000) + 18,
      };
    }
    if (index % 4 === 2) {
      return {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: `text-${index % 500}`,
        txt: `bench-${index}`,
      };
    }
    return {
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: `shape-${index}`,
      color: DEFAULT_COLOR,
      size: 2,
      x: index % 3000,
      y: (index * 2) % 3000,
      x2: (index % 3000) + 20,
      y2: ((index * 2) % 3000) + 16,
    };
  });
}

function createBroadcastContext() {
  const board = new BoardData("bench-broadcasts");
  board.delaySave = () => {};
  for (let index = 0; index < 500; index += 1) {
    board.set(`rect-${index}`, {
      id: `rect-${index}`,
      tool: "rectangle",
      type: "rect",
      color: DEFAULT_COLOR,
      size: 2,
      x: index,
      y: index,
      x2: index + 12,
      y2: index + 12,
    });
    board.set(`text-${index}`, {
      id: `text-${index}`,
      tool: "text",
      type: "text",
      color: DEFAULT_COLOR,
      size: 18,
      x: index,
      y: index,
      txt: `seed-${index}`,
    });
  }
  for (let index = 0; index < 100; index += 1) {
    board.set(`pencil-${index}`, {
      id: `pencil-${index}`,
      tool: "pencil",
      type: "path",
      color: DEFAULT_COLOR,
      size: 4,
      _children: [
        { x: index, y: index },
        { x: index + 4, y: index + 6 },
      ],
    });
  }
  return { board };
}

/**
 * @param {any} board
 * @returns {void}
 */
function clearPendingSave(board) {
  if (board.saveTimeoutId !== undefined) {
    clearTimeout(board.saveTimeoutId);
    board.saveTimeoutId = undefined;
  }
}

async function runEndToEndEraseBenchmark() {
  const e2eDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wbo-e2e-bench-"));
  const fixture = buildBoard(
    BROWSER_BOARD_ITEMS,
    LARGE_BOARD_PENCIL_EVERY,
    BROWSER_PENCIL_POINTS,
  );
  const boardName = "bench-e2e";
  await writeSvgFixture(boardName, fixture.board, e2eDir);
  const server = await startServer(e2eDir);
  const browser = await chromium.launch();
  const peer = await browser.newPage();
  const main = await browser.newPage();
  const boardUrl = `${server.baseUrl}/boards/${boardName}`;

  await peer.goto(boardUrl, { waitUntil: "load" });
  await peer.waitForSelector(`#${fixture.lastPencilId}`);
  await main.addInitScript(benchInitScript(boardName, fixture.lastPencilId));

  const requestStartedAt = performance.now();
  await main.goto(boardUrl, { waitUntil: "load" });
  const initialRequestMs = performance.now() - requestStartedAt;

  await main.waitForFunction(
    () => {
      const bench = /** @type {any} */ (window).__wboBench;
      return bench?.renderCompleteMs !== null;
    },
    undefined,
    { timeout: 30_000 },
  );
  const benchState = await main.evaluate(
    () => /** @type {any} */ (window).__wboBench,
  );
  if (!benchState) {
    throw new Error("missing browser benchmark state");
  }

  const peerApplyStartedAt = performance.now();
  const peerApplied = peer.waitForFunction(
    (targetId) => !document.getElementById(targetId),
    fixture.lastPencilId,
    { timeout: 30_000 },
  );
  const eraseSent = await main.evaluate(
    ({ targetId, deleteType }) => {
      const bench = /** @type {any} */ (window).__wboBench;
      bench.eraseDispatchMs = performance.now() - bench.navStart;
      return window.Tools.send(
        {
          type: deleteType,
          id: targetId,
          clientMutationId: window.Tools.generateUID("cm-"),
        },
        "eraser",
      );
    },
    { targetId: fixture.lastPencilId, deleteType: MutationType.DELETE },
  );
  if (eraseSent !== true) {
    throw new Error("failed to send erase request in end-to-end benchmark");
  }
  await peerApplied;
  const peerApplyMs = performance.now() - peerApplyStartedAt;
  const finalBenchState = await main.evaluate(
    () => /** @type {any} */ (window).__wboBench,
  );

  await browser.close();
  await server.stop();
  await fsp.rm(e2eDir, { recursive: true, force: true });

  return {
    details: `${BROWSER_BOARD_ITEMS} items, delete ${fixture.lastPencilId} on active peer`,
    metrics: {
      initialRequestMs,
      renderStartMs: finalBenchState.renderStartMs ?? 0,
      renderCompleteMs: finalBenchState.renderCompleteMs ?? 0,
      eraseDispatchMs: finalBenchState.eraseDispatchMs ?? 0,
      peerApplyMs,
      totalToPeerApplyMs: (finalBenchState.eraseDispatchMs ?? 0) + peerApplyMs,
    },
  };
}

async function runBroadcastThroughputBenchmark() {
  const messages = createBroadcastMessages();
  const { board } = createBroadcastContext();
  const remoteAddress = "127.0.0.1";
  const socket = /** @type {any} */ ({
    id: "bench-socket",
    handshake: { query: {} },
  });
  const startedAt = performance.now();

  for (const message of messages) {
    const result = processBoardBroadcastMessage(
      config,
      board.name,
      board,
      message,
      /** @type {any} */ ({
        id: socket.id,
        handshake: socket.handshake,
        client: { request: { socket: { remoteAddress } } },
        emit: () => true,
        disconnect: () => socket,
        rooms: new Set(),
        boardName: board.name,
        turnstileValidatedUntil: Date.now() + 60_000,
        user: undefined,
      }),
      {
        now: Date.now(),
      },
    );
    if (!result.ok) {
      throw new Error(`broadcast benchmark rejected message: ${result.reason}`);
    }
  }

  clearPendingSave(board);
  const durationMs = performance.now() - startedAt;
  return {
    details: `${messages.length} mixed socket broadcasts`,
    metrics: {
      broadcastsPerSecond: (messages.length / durationMs) * 1000,
      perBroadcastMs: durationMs / messages.length,
    },
  };
}

async function runLoadBenchmark() {
  const fixture = buildBoard(
    LARGE_BOARD_ITEMS,
    LARGE_BOARD_PENCIL_EVERY,
    LARGE_BOARD_PENCIL_POINTS,
  );
  const boardName = `bench-load-${Date.now().toString(36)}`;
  const written = await writeSvgFixture(boardName, fixture.board);
  const board = await BoardData.load(boardName);
  clearPendingSave(board);
  return {
    details: `${board.authoritativeItemCount()} items from ${bytesToMiB(written.bytes)}`,
    cleanup: async () => {
      clearPendingSave(board);
    },
  };
}

async function runPersistBenchmark() {
  const fixture = buildBoard(
    LARGE_BOARD_ITEMS,
    LARGE_BOARD_PENCIL_EVERY,
    PERSIST_BOARD_PENCIL_POINTS,
  );
  const boardName = `bench-persist-${Date.now().toString(36)}`;
  const written = await writeSvgFixture(boardName, fixture.board);
  const board = await BoardData.load(boardName);
  board.delaySave = () => {};
  clearPendingSave(board);

  for (const id of fixture.pencilIds.slice(0, PERSIST_PENCIL_UPDATES)) {
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

  for (const id of fixture.shapeIds.slice(0, PERSIST_SHAPE_UPDATES)) {
    const result = board.processMessage({
      tool: Hand.id,
      type: MutationType.UPDATE,
      id,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 12, f: 18 },
    });
    if (!result.ok) throw new Error(result.reason);
  }

  clearPendingSave(board);
  await board.save();
  clearPendingSave(board);
  const savedFile = await fsp.stat(board.file);
  return {
    details:
      `${board.authoritativeItemCount()} items, ` +
      `${PERSIST_PENCIL_UPDATES} pencil appends, ` +
      `${PERSIST_SHAPE_UPDATES} transforms, wrote ${bytesToMiB(savedFile.size)}`,
    metrics: {
      inputSvgMiB: written.bytes / (1024 * 1024),
    },
    cleanup: async () => {
      clearPendingSave(board);
    },
  };
}

function readTimeoutMs() {
  const value = process.env.WBO_BENCH_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid WBO_BENCH_TIMEOUT_MS: ${JSON.stringify(value)}`);
  }
  return parsed;
}

async function main() {
  const timeoutMs = readTimeoutMs();
  const timer = setTimeout(() => {
    console.error(`benchmark timed out after ${timeoutMs}ms`);
    process.exit(1);
  }, timeoutMs);

  try {
    await runBenchmark(
      "open large board to peer-visible erase",
      END_TO_END_SAMPLE_COUNT,
      runEndToEndEraseBenchmark,
    );
    await runBenchmark(
      "server broadcast throughput",
      DEFAULT_SAMPLE_COUNT,
      runBroadcastThroughputBenchmark,
    );
    await runBenchmark(
      "load large board",
      DEFAULT_SAMPLE_COUNT,
      runLoadBenchmark,
    );
    await runBenchmark(
      "persist modifications to large board",
      DEFAULT_SAMPLE_COUNT,
      runPersistBenchmark,
    );
  } finally {
    clearTimeout(timer);
    await fsp.rm(historyDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
