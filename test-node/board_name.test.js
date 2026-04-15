const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BOARD_NAME_PATH = path.join(
  __dirname,
  "..",
  "client-data",
  "js",
  "board_name.js",
);
const BOARD_PAGE_STATE_PATH = path.join(
  __dirname,
  "..",
  "client-data",
  "js",
  "board_page_state.js",
);

test("board name helpers sanitize and validate names consistently", async () => {
  const boardNames = await import(pathToFileURL(BOARD_NAME_PATH).href);

  assert.equal(boardNames.isValidBoardName("demo_board-1~(v2)%"), true);
  assert.equal(boardNames.isValidBoardName("demo:board"), false);
  assert.equal(boardNames.sanitizeBoardName("demo:board/?#"), "demoboard");
  assert.equal(boardNames.decodeAndValidateBoardName("demo%3Aboard"), null);
  assert.equal(
    boardNames.decodeAndValidateBoardName("demo_board-1~(v2)%25"),
    "demo_board-1~(v2)%",
  );
});

test("recent board normalization drops invalid stored names", async () => {
  const boardPageState = await import(
    pathToFileURL(BOARD_PAGE_STATE_PATH).href
  );

  assert.deepEqual(
    boardPageState.normalizeRecentBoards([
      "valid-board",
      "test:board",
      "another_valid",
    ]),
    ["valid-board", "another_valid"],
  );
});
