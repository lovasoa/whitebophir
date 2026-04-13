const test = require("node:test");
const assert = require("node:assert/strict");

const BoardState = require("../client-data/js/board_state.js");

test("parseBoardStateText falls back safely on missing or invalid JSON", function () {
  assert.deepEqual(BoardState.parseBoardStateText(null), {
    readonly: false,
    canWrite: true,
  });
  assert.deepEqual(BoardState.parseBoardStateText("{"), {
    readonly: false,
    canWrite: true,
  });
});

test("resolveBoardName decodes the last path segment", function () {
  assert.equal(BoardState.resolveBoardName("/boards/demo%20board"), "demo board");
  assert.equal(BoardState.resolveBoardName("/boards/demo/"), "");
});

test("updateRecentBoards filters malformed entries and deduplicates the current board", function () {
  assert.deepEqual(
    BoardState.updateRecentBoards(["alpha", 42, "", "beta", "alpha"], "beta"),
    ["beta", "alpha"],
  );
  assert.deepEqual(
    BoardState.updateRecentBoards(["alpha"], "anonymous"),
    ["alpha"],
  );
});
