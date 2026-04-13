const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbo-server-bench-"));
process.env.WBO_HISTORY_DIR = historyDir;
process.env.WBO_SILENT = process.env.WBO_SILENT || "true";

const { BoardData } = require("../server/boardData.js");
const config = require("../server/configuration.js");
const { renderBoardToSVG } = require("../server/createSVG.js");

const DEFAULT_COLOR = "#1f2937";
const DENSE_BOARD_ITEMS = 18000;
const DENSE_BOARD_PENCIL_EVERY = 6;
const DENSE_PENCIL_POINTS = config.MAX_CHILDREN;
const SNAPSHOT_BOARD_ITEMS = 24000;
const OVERFULL_BOARD_ITEMS = config.MAX_ITEM_COUNT + 2048;
const HAND_BATCH_ITEMS = config.MAX_CHILDREN;
const HAND_BATCH_PASSES = 24;
const EXPORT_PENCIL_SHAPES = 768;

function bytesToMiB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
}

function formatDelta(bytes) {
  const sign = bytes >= 0 ? "+" : "-";
  return sign + bytesToMiB(Math.abs(bytes));
}

function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
    global.gc();
  }
}

function snapshotMemory() {
  const memory = process.memoryUsage();
  return {
    heapUsed: memory.heapUsed,
    rss: memory.rss,
  };
}

async function measure(name, run) {
  forceGc();
  const before = snapshotMemory();
  const startedAt = performance.now();
  const details = await run();
  const active = snapshotMemory();
  const durationMs = performance.now() - startedAt;
  forceGc();
  const retained = snapshotMemory();

  console.log(name);
  console.log("  time:          " + durationMs.toFixed(1) + " ms");
  console.log(
    "  heap active:   " + formatDelta(active.heapUsed - before.heapUsed),
  );
  console.log(
    "  heap retained: " + formatDelta(retained.heapUsed - before.heapUsed),
  );
  console.log("  rss delta:     " + formatDelta(active.rss - before.rss));
  if (details) console.log("  details:       " + details);
}

function boardFile(name) {
  return path.join(historyDir, "board-" + encodeURIComponent(name) + ".json");
}

async function writeBoardFile(name, board) {
  const file = boardFile(name);
  const text = JSON.stringify(board);
  await fsp.writeFile(file, text);
  return { file, bytes: Buffer.byteLength(text) };
}

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

function textItem(index) {
  return {
    tool: "Text",
    type: "new",
    color: DEFAULT_COLOR,
    size: 18,
    x: (index * 7) % 7000,
    y: (index * 11) % 7000,
    txt: "bench-" + index + "-payload",
    time: index,
  };
}

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

function buildMixedBoard(itemCount, pencilEvery, pencilPointsPerShape) {
  const board = {};
  for (let index = 0; index < itemCount; index++) {
    const id = "item-" + index;
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

async function loadBoardFromFile(
  name,
  itemCount,
  pencilEvery,
  pencilPointsPerShape,
) {
  const persisted = await writeBoardFile(
    name,
    buildMixedBoard(itemCount, pencilEvery, pencilPointsPerShape),
  );
  const boardData = await BoardData.load(name);
  return { boardData, persisted };
}

async function benchmarkLoadDenseBoard() {
  const { boardData, persisted } = await loadBoardFromFile(
    "bench-load-dense-board",
    DENSE_BOARD_ITEMS,
    DENSE_BOARD_PENCIL_EVERY,
    DENSE_PENCIL_POINTS,
  );
  return (
    Object.keys(boardData.board).length +
    " items normalized from " +
    bytesToMiB(persisted.bytes)
  );
}

async function benchmarkInitialBoardSnapshot() {
  const { boardData, persisted } = await loadBoardFromFile(
    "bench-initial-board-snapshot",
    SNAPSHOT_BOARD_ITEMS,
    8,
    64,
  );
  const payload = { _children: boardData.getAll() };
  const snapshot = JSON.stringify(payload);
  return (
    payload._children.length +
    " items materialized and serialized to " +
    bytesToMiB(Buffer.byteLength(snapshot)) +
    " from " +
    bytesToMiB(persisted.bytes)
  );
}

async function benchmarkSaveDenseBoard() {
  const { boardData, persisted } = await loadBoardFromFile(
    "bench-save-dense-board",
    DENSE_BOARD_ITEMS,
    DENSE_BOARD_PENCIL_EVERY,
    DENSE_PENCIL_POINTS,
  );
  await boardData.save();
  if (boardData.saveTimeoutId !== undefined)
    clearTimeout(boardData.saveTimeoutId);
  const stat = await fsp.stat(boardData.file);
  return (
    Object.keys(boardData.board).length +
    " items stringified and written as " +
    bytesToMiB(stat.size) +
    " from " +
    bytesToMiB(persisted.bytes)
  );
}

async function benchmarkCleanOverfullBoard() {
  const boardData = new BoardData("bench-clean-overfull-board");
  for (let index = 0; index < OVERFULL_BOARD_ITEMS; index++) {
    boardData.board["overflow-" + index] = rectangleItem(index);
  }
  const beforeCount = Object.keys(boardData.board).length;
  await boardData.save();
  if (boardData.saveTimeoutId !== undefined)
    clearTimeout(boardData.saveTimeoutId);
  const afterCount = Object.keys(boardData.board).length;
  const removedCount = beforeCount - afterCount;
  const stat = await fsp.stat(boardData.file);
  return (
    "cleaned " +
    removedCount +
    " items, kept " +
    afterCount +
    ", wrote " +
    bytesToMiB(stat.size)
  );
}

async function benchmarkHandBatchMoveDensePencils() {
  const boardData = new BoardData("bench-hand-batch-move");
  for (let index = 0; index < HAND_BATCH_ITEMS; index++) {
    const result = boardData.set(
      "pencil-" + index,
      pencilItem(index, DENSE_PENCIL_POINTS),
    );
    if (!result.ok) throw new Error(result.reason);
  }

  let moved = 0;
  for (let pass = 0; pass < HAND_BATCH_PASSES; pass++) {
    const delta = pass + 1;
    const result = boardData.processMessage({
      tool: "Hand",
      _children: Array.from({ length: HAND_BATCH_ITEMS }, function (_, index) {
        return {
          type: "update",
          id: "pencil-" + index,
          transform: {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            e: delta * 2,
            f: delta * 3,
          },
        };
      }),
    });
    if (!result.ok) throw new Error(result.reason);
    moved += HAND_BATCH_ITEMS;
  }

  if (boardData.saveTimeoutId !== undefined)
    clearTimeout(boardData.saveTimeoutId);
  return (
    moved +
    " batched transform updates across " +
    HAND_BATCH_ITEMS +
    " dense pencils"
  );
}

async function benchmarkExportLargePencils() {
  const persisted = await writeBoardFile(
    "bench-export-large-pencils",
    buildMixedBoard(EXPORT_PENCIL_SHAPES, 1, DENSE_PENCIL_POINTS),
  );
  const svg = await renderBoardToSVG(persisted.file);
  return (
    EXPORT_PENCIL_SHAPES +
    " dense pencils exported to " +
    bytesToMiB(Buffer.byteLength(svg)) +
    " from " +
    bytesToMiB(persisted.bytes)
  );
}

async function main() {
  console.log("history dir: " + historyDir);
  if (typeof global.gc !== "function") {
    console.log("note: run with --expose-gc for steadier memory numbers");
  }
  console.log("");

  await measure("load dense persisted board", benchmarkLoadDenseBoard);
  console.log("");
  await measure(
    "materialize initial board snapshot",
    benchmarkInitialBoardSnapshot,
  );
  console.log("");
  await measure("save dense board to disk", benchmarkSaveDenseBoard);
  console.log("");
  await measure("clean and save overfull board", benchmarkCleanOverfullBoard);
  console.log("");
  await measure(
    "apply hand batch transforms to dense pencils",
    benchmarkHandBatchMoveDensePencils,
  );
  console.log("");
  await measure(
    "export large pencil board to svg",
    benchmarkExportLargePencils,
  );
}

main()
  .catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async function () {
    await fsp.rm(historyDir, { recursive: true, force: true });
  });
