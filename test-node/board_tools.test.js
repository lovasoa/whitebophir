const test = require("node:test");
const assert = require("node:assert/strict");

const BoardTools = require("../client-data/js/board_tools.js");

test("isBlockedToolName rejects invalid tool names and respects the blocked list", function () {
  assert.equal(BoardTools.isBlockedToolName("Pencil", ["Text"]), false);
  assert.equal(BoardTools.isBlockedToolName("Pencil", ["Pencil"]), true);
  assert.throws(function () {
    BoardTools.isBlockedToolName("Bad,Tool", []);
  }, /must not contain a comma/);
});

test("shouldDisplayTool respects readonly and writable board states", function () {
  const readOnlyToolNames = new Set(["Hand", "Download"]);
  assert.equal(
    BoardTools.shouldDisplayTool(
      "Pencil",
      { readonly: true, canWrite: false },
      readOnlyToolNames,
    ),
    false,
  );
  assert.equal(
    BoardTools.shouldDisplayTool(
      "Hand",
      { readonly: true, canWrite: false },
      readOnlyToolNames,
    ),
    true,
  );
});

test("drainPendingMessages returns and clears the queued tool messages", function () {
  const pending = { Pencil: [{ id: "1" }, { id: "2" }] };
  assert.deepEqual(BoardTools.drainPendingMessages(pending, "Pencil"), [
    { id: "1" },
    { id: "2" },
  ]);
  assert.deepEqual(pending, {});
});
