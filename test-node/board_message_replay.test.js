const test = require("node:test");
const assert = require("node:assert/strict");

const BoardMessageReplay = require("../client-data/js/board_message_replay.js");
const BoardMessages = require("../client-data/js/board_transport.js").messages;
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Hand, Pencil, Rectangle } = require("../client-data/tools/index.js");

test("tool-owned Hand batches are applied at the batch level only", () => {
  assert.equal(
    BoardMessageReplay.isToolOwnedBatchMessage({
      tool: Hand.id,
      _children: [{ type: MutationType.UPDATE, id: "rect-1" }],
    }),
    true,
  );
  assert.equal(
    BoardMessageReplay.shouldReplayChildrenIndividually({
      tool: Hand.id,
      _children: [{ type: MutationType.UPDATE, id: "rect-1" }],
    }),
    false,
  );
});

test("stored item children keep parent metadata during replay", () => {
  const replayChild = BoardMessageReplay.prepareReplayChild(
    { id: "line-1", tool: Pencil.id },
    { x: 10, y: 20 },
    BoardMessages.normalizeChildMessage,
  );

  assert.deepEqual(replayChild, {
    parent: "line-1",
    tool: Pencil.id,
    type: MutationType.APPEND,
    x: 10,
    y: 20,
  });
});

test("non-parent replay children are replayed unchanged", () => {
  const child = {
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-1",
  };

  assert.equal(
    BoardMessageReplay.prepareReplayChild(
      /** @type {any} */ ({}),
      child,
      BoardMessages.normalizeChildMessage,
    ),
    child,
  );
});
