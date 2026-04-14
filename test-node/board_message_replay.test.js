const test = require("node:test");
const assert = require("node:assert/strict");

const BoardMessageReplay = require("../client-data/js/board_message_replay.js");
const BoardMessages = require("../client-data/js/board_transport.js").messages;

test("tool-owned Hand batches are applied at the batch level only", function () {
  assert.equal(
    BoardMessageReplay.isToolOwnedBatchMessage({
      tool: "Hand",
      _children: [{ type: "update", id: "rect-1" }],
    }),
    true,
  );
  assert.equal(
    BoardMessageReplay.shouldReplayChildrenIndividually({
      tool: "Hand",
      _children: [{ type: "update", id: "rect-1" }],
    }),
    false,
  );
});

test("stored item children keep parent metadata during replay", function () {
  const replayChild = BoardMessageReplay.prepareReplayChild(
    { id: "line-1", tool: "Pencil" },
    { x: 10, y: 20 },
    BoardMessages.normalizeChildMessage,
  );

  assert.deepEqual(replayChild, {
    parent: "line-1",
    tool: "Pencil",
    type: "child",
    x: 10,
    y: 20,
  });
});

test("snapshot-root children are replayed unchanged", function () {
  const child = { tool: "Rectangle", type: "rect", id: "rect-1" };

  assert.equal(
    BoardMessageReplay.prepareReplayChild(
      { _children: [child] },
      child,
      BoardMessages.normalizeChildMessage,
    ),
    child,
  );
});

test("buffered live messages already covered by the snapshot revision are dropped", function () {
  const buffered = [
    { tool: "Eraser", type: "delete", id: "rect-1", revision: 4 },
    { tool: "Hand", type: "update", id: "rect-2", revision: 5 },
    {
      tool: "Pencil",
      type: "child",
      parent: "line-1",
      x: 10,
      y: 20,
      revision: 6,
    },
  ];

  assert.deepEqual(
    BoardMessageReplay.filterBufferedMessagesAfterSnapshot(buffered, 5),
    [buffered[2]],
  );
});

test("buffered live messages without revisions are replayed for compatibility", function () {
  const buffered = [
    { tool: "Eraser", type: "delete", id: "rect-1" },
    { tool: "Hand", type: "update", id: "rect-2", revision: 3 },
  ];

  assert.deepEqual(
    BoardMessageReplay.filterBufferedMessagesAfterSnapshot(buffered, 3),
    [buffered[0]],
  );
});
