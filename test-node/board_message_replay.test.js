const test = require("node:test");
const assert = require("node:assert/strict");

const BoardMessageReplay = require("../client-data/js/board_message_replay.js");
const BoardMessages = require("../client-data/js/board_transport.js").messages;

test("tool-owned Hand batches are applied at the batch level only", () => {
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

test("stored item children keep parent metadata during replay", () => {
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

test("snapshot-root children are replayed unchanged", () => {
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

test("buffered live messages already covered by the snapshot revision are dropped", () => {
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

test("buffered live messages without revisions are replayed for compatibility", () => {
  const buffered = [
    { tool: "Eraser", type: "delete", id: "rect-1" },
    { tool: "Hand", type: "update", id: "rect-2", revision: 3 },
  ];

  assert.deepEqual(
    BoardMessageReplay.filterBufferedMessagesAfterSnapshot(buffered, 3),
    [buffered[0]],
  );
});

test("seq envelopes are recognized and unwrap to their mutation payload", () => {
  const envelope = {
    board: "demo",
    seq: 7,
    acceptedAtMs: 123,
    clientMutationId: "c1",
    mutation: {
      tool: "Rectangle",
      type: "rect",
      id: "rect-1",
      x: 1,
      y: 2,
      x2: 3,
      y2: 4,
    },
  };

  assert.equal(BoardMessageReplay.isPersistentEnvelope(envelope), true);
  assert.equal(BoardMessageReplay.normalizeSeq(envelope.seq), 7);
  assert.equal(
    BoardMessageReplay.unwrapReplayMessage(envelope),
    envelope.mutation,
  );
});

test("buffered seq envelopes already covered by replay end are dropped", () => {
  const buffered = [
    {
      seq: 4,
      mutation: { tool: "Eraser", type: "delete", id: "rect-1" },
    },
    {
      seq: 5,
      mutation: { tool: "Hand", type: "update", id: "rect-2" },
    },
    {
      seq: 6,
      mutation: { tool: "Pencil", type: "child", parent: "line-1", x: 1, y: 2 },
    },
    { tool: "Text", type: "update", id: "text-1", txt: "legacy" },
  ];

  assert.deepEqual(
    BoardMessageReplay.filterBufferedMessagesAfterSeqReplay(buffered, 5),
    [buffered[2], buffered[3]],
  );
});

test("persistent seq envelopes classify stale next and gap cases", () => {
  assert.equal(
    BoardMessageReplay.classifyPersistentEnvelopeSeq(0, 4),
    "invalid",
  );
  assert.equal(BoardMessageReplay.classifyPersistentEnvelopeSeq(4, 4), "stale");
  assert.equal(BoardMessageReplay.classifyPersistentEnvelopeSeq(5, 4), "next");
  assert.equal(BoardMessageReplay.classifyPersistentEnvelopeSeq(7, 4), "gap");
});

test("sync replay control messages are identified by type", () => {
  assert.equal(
    BoardMessageReplay.isSyncReplayControlMessage({
      type: "sync_replay_start",
      fromExclusiveSeq: 3,
      toInclusiveSeq: 8,
    }),
    true,
  );
  assert.equal(
    BoardMessageReplay.isSyncReplayControlMessage({
      type: "sync_replay_end",
      toInclusiveSeq: 8,
    }),
    true,
  );
  assert.equal(
    BoardMessageReplay.isSyncReplayControlMessage({
      type: "resync_required",
      latestSeq: 10,
      minReplayableSeq: 4,
    }),
    true,
  );
  assert.equal(
    BoardMessageReplay.isSyncReplayControlMessage({
      tool: "Rectangle",
      type: "rect",
      id: "rect-1",
    }),
    false,
  );
});

test("seq envelopes and sync control messages bypass the legacy snapshot buffer", () => {
  assert.equal(
    BoardMessageReplay.shouldBufferLiveMessage(
      {
        seq: 3,
        mutation: { tool: "Rectangle", type: "rect", id: "rect-1" },
      },
      true,
    ),
    false,
  );
  assert.equal(
    BoardMessageReplay.shouldBufferLiveMessage(
      {
        type: "sync_replay_end",
        toInclusiveSeq: 3,
      },
      true,
    ),
    false,
  );
  assert.equal(
    BoardMessageReplay.shouldBufferLiveMessage(
      { tool: "Cursor", type: "update", x: 1, y: 2 },
      true,
    ),
    true,
  );
});
