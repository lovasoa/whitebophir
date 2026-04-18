const test = require("node:test");
const assert = require("node:assert/strict");
const { installTestConsole } = require("./test_console.js");

installTestConsole();

const {
  normalizeBoardState,
  resolveBoardName,
  updateRecentBoards,
} = require("../client-data/js/board_page_state.js");

/**
 * @param {string | null | undefined} text
 * @returns {{readonly: boolean, canWrite: boolean}}
 */
function parseBoardStateText(text) {
  if (!text) return { readonly: false, canWrite: true };
  try {
    return normalizeBoardState(JSON.parse(text));
  } catch {
    return { readonly: false, canWrite: true };
  }
}

test("parseBoardStateText falls back safely on missing or invalid JSON", () => {
  assert.deepEqual(parseBoardStateText(null), {
    readonly: false,
    canWrite: true,
  });
  assert.deepEqual(parseBoardStateText("{"), {
    readonly: false,
    canWrite: true,
  });
});

test("resolveBoardName decodes the last path segment", () => {
  assert.equal(resolveBoardName("/boards/demo%20board"), "demo board");
  assert.equal(resolveBoardName("/boards/demo/"), "");
});

test("updateRecentBoards filters malformed entries and deduplicates the current board", () => {
  assert.deepEqual(
    updateRecentBoards(["alpha", 42, "", "beta", "alpha"], "beta"),
    ["beta", "alpha"],
  );
  assert.deepEqual(updateRecentBoards(["alpha"], "anonymous"), ["alpha"]);
});
