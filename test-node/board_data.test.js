const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  BOARD_DATA_PATH,
  boardFile,
  withEnv,
  writeBoard,
} = require("./test_helpers.js");

function disableSaves(board) {
  board.delaySave = function () {};
  return board;
}

test("BoardData replays batch updates, copies, and deletes consistently", function () {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("replay-board"));

  board.processMessage({
    _children: [
      {
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        color: "#112233",
        size: 4,
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
      },
      {
        tool: "Hand",
        type: "update",
        id: "rect-1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
      },
      {
        tool: "Hand",
        type: "copy",
        id: "rect-1",
        newid: "rect-2",
      },
      {
        tool: "Eraser",
        type: "delete",
        id: "rect-1",
      },
    ],
  });

  assert.equal(board.get("rect-1"), undefined);
  assert.deepEqual(board.get("rect-2"), {
    tool: "Rectangle",
    type: "rect",
    id: "rect-2",
    color: "#112233",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
    transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
    time: board.get("rect-2").time,
  });
});

test("BoardData applies parent tool metadata to batched Hand updates", function () {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("hand-batch-board"));

  board.processMessage({
    tool: "Rectangle",
    type: "rect",
    id: "rect-1",
    color: "#112233",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
  });

  board.processMessage({
    tool: "Hand",
    _children: [
      {
        type: "update",
        id: "rect-1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
      },
    ],
  });

  assert.deepEqual(board.get("rect-1").transform, {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 25,
    f: 30,
  });
});

test("BoardData.addChild enforces MAX_CHILDREN on stored strokes", async function () {
  await withEnv({ WBO_MAX_CHILDREN: "1" }, async function () {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = disableSaves(new BoardData("child-cap-board"));

    board.set("line-1", {
      tool: "Pencil",
      type: "line",
      id: "line-1",
      color: "#123456",
      size: 4,
    });

    assert.equal(board.addChild("line-1", { x: 1, y: 2 }), true);
    assert.equal(board.addChild("line-1", { x: 3, y: 4 }), false);
    assert.deepEqual(board.get("line-1")._children, [{ x: 1, y: 2 }]);
  });
});

test("BoardData.clean keeps the newest items when trimming history", async function () {
  await withEnv({ WBO_MAX_ITEM_COUNT: "2" }, async function () {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = disableSaves(new BoardData("cleanup-board"));

    board.board = {
      oldest: { id: "oldest", tool: "Text", type: "new", time: 1 },
      middle: { id: "middle", tool: "Text", type: "new", time: 2 },
      newest: { id: "newest", tool: "Text", type: "new", time: 3 },
    };

    board.clean();

    assert.deepEqual(Object.keys(board.board).sort(), ["middle", "newest"]);
  });
});

test("BoardData.load normalizes stored board items from disk", async function () {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-data-load-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async function () {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    await writeBoard(historyDir, "normalized-load", {
      bad1: {
        tool: "Rectangle",
        type: "rect",
        id: "wrong-id",
        color: "#abcdef",
        size: 200,
        opacity: 3,
        x: -100,
        y: "20.333",
        x2: "70000",
        y2: 40,
        ignored: true,
      },
      bad2: {
        tool: "Unknown",
        id: "bad2",
      },
    });

    const board = await BoardData.load("normalized-load");

    assert.deepEqual(board.get("bad1"), {
      tool: "Rectangle",
      type: "rect",
      id: "bad1",
      color: "#abcdef",
      size: 50,
      x: 0,
      y: 20.3,
      x2: 65536,
      y2: 40,
    });
    assert.equal(board.get("bad2"), undefined);
  });
});

test("BoardData.loadMetadataSync preserves readonly metadata and falls back safely", async function () {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-metadata-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async function () {
    const boardDataModule = require(BOARD_DATA_PATH);
    const BoardData = boardDataModule.BoardData;

    await writeBoard(historyDir, "readonly-board", {
      [boardDataModule.BOARD_METADATA_KEY]: { readonly: true },
      rect: {
        tool: "Rectangle",
        type: "rect",
        color: "#123456",
        size: 4,
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
      },
    });

    assert.deepEqual(BoardData.loadMetadataSync("readonly-board"), {
      readonly: true,
    });

    await fs.writeFile(boardFile(historyDir, "broken-board"), "{not-json");
    assert.deepEqual(BoardData.loadMetadataSync("broken-board"), {
      readonly: false,
    });
  });
});
