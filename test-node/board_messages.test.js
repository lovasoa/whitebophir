const test = require("node:test");
const assert = require("node:assert/strict");

const BoardMessages = require("../client-data/js/board_transport.js").messages;

test("queuePendingMessage accumulates messages by tool name", () => {
  /** @type {{[toolName: string]: {tool?: string}[]}} */
  const pending = {};
  BoardMessages.queuePendingMessage(pending, "Rectangle", {
    tool: "Rectangle",
  });
  BoardMessages.queuePendingMessage(pending, "Rectangle", {
    tool: "Rectangle",
  });

  assert.ok(pending.Rectangle);
  assert.equal(pending.Rectangle.length, 2);
});

test("hasChildMessages only accepts array children", () => {
  assert.equal(
    BoardMessages.hasChildMessages({ _children: [{ tool: "Pencil" }] }),
    true,
  );
  assert.equal(
    BoardMessages.hasChildMessages(
      /** @type {any} */ ({ _children: { tool: "Pencil" } }),
    ),
    false,
  );
});

test("normalizeChildMessage applies parent tool metadata", () => {
  const child = BoardMessages.normalizeChildMessage(
    { id: "parent-1", tool: "Pencil" },
    { type: "line" },
  );

  assert.deepEqual(child, {
    parent: "parent-1",
    tool: "Pencil",
    type: "child",
  });
});
