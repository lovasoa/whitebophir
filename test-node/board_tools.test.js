const test = require("node:test");
const assert = require("node:assert/strict");

const {
  drainPendingMessages,
  isBlockedToolName,
  shouldDisplayTool,
} = require("../client-data/js/board_page_state.js");

test("isBlockedToolName rejects invalid tool names and respects the blocked list", () => {
  assert.equal(isBlockedToolName("Pencil", ["Text"]), false);
  assert.equal(isBlockedToolName("Pencil", ["Pencil"]), true);
  assert.throws(() => {
    isBlockedToolName("Bad,Tool", []);
  }, /must not contain a comma/);
});

test("shouldDisplayTool respects readonly and writable board states", () => {
  const readOnlyToolNames = new Set(["Hand", "Download"]);
  assert.equal(
    shouldDisplayTool(
      "Pencil",
      { readonly: true, canWrite: false },
      readOnlyToolNames,
    ),
    false,
  );
  assert.equal(
    shouldDisplayTool(
      "Hand",
      { readonly: true, canWrite: false },
      readOnlyToolNames,
    ),
    true,
  );
});

test("drainPendingMessages returns and clears the queued tool messages", () => {
  const pending = { Pencil: [{ id: "1" }, { id: "2" }] };
  assert.deepEqual(drainPendingMessages(pending, "Pencil"), [
    { id: "1" },
    { id: "2" },
  ]);
  assert.deepEqual(pending, {});
});
