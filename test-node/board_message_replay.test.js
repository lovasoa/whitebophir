const test = require("node:test");
const assert = require("node:assert/strict");

const BoardMessageReplay = require("../client-data/js/board_message_replay.js");
const BoardMessages = require("../client-data/js/board_transport.js").messages;
const {
  getToolCode,
  MutationType,
} = require("../client-data/js/message_tool_metadata.js");

const CURSOR_TOOL_CODE = getToolCode("cursor");
const ERASER_TOOL_CODE = getToolCode("eraser");
const HAND_TOOL_CODE = getToolCode("hand");
const PENCIL_TOOL_CODE = getToolCode("pencil");
const RECTANGLE_TOOL_CODE = getToolCode("rectangle");
const TEXT_TOOL_CODE = getToolCode("text");

test("tool-owned Hand batches are applied at the batch level only", () => {
  assert.equal(
    BoardMessageReplay.isToolOwnedBatchMessage({
      tool: HAND_TOOL_CODE,
      _children: [{ type: MutationType.UPDATE, id: "rect-1" }],
    }),
    true,
  );
  assert.equal(
    BoardMessageReplay.shouldReplayChildrenIndividually({
      tool: HAND_TOOL_CODE,
      _children: [{ type: MutationType.UPDATE, id: "rect-1" }],
    }),
    false,
  );
});

test("stored item children keep parent metadata during replay", () => {
  const replayChild = BoardMessageReplay.prepareReplayChild(
    { id: "line-1", tool: "pencil" },
    { x: 10, y: 20 },
    BoardMessages.normalizeChildMessage,
  );

  assert.deepEqual(replayChild, {
    parent: "line-1",
    tool: "pencil",
    type: MutationType.APPEND,
    x: 10,
    y: 20,
  });
});

test("non-parent replay children are replayed unchanged", () => {
  const child = {
    tool: RECTANGLE_TOOL_CODE,
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

test("seq envelopes are recognized and unwrap to their mutation payload", () => {
  const envelope = {
    board: "demo",
    seq: 7,
    acceptedAtMs: 123,
    clientMutationId: "c1",
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
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
      mutation: {
        tool: ERASER_TOOL_CODE,
        type: MutationType.DELETE,
        id: "rect-1",
      },
    },
    {
      seq: 5,
      mutation: {
        tool: HAND_TOOL_CODE,
        type: MutationType.UPDATE,
        id: "rect-2",
      },
    },
    {
      seq: 6,
      mutation: {
        tool: PENCIL_TOOL_CODE,
        type: MutationType.APPEND,
        parent: "line-1",
        x: 1,
        y: 2,
      },
    },
    {
      tool: TEXT_TOOL_CODE,
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "legacy",
    },
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
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-1",
    }),
    false,
  );
});

test("seq envelopes and sync control messages bypass the seq replay buffer", () => {
  assert.equal(
    BoardMessageReplay.shouldBufferLiveMessage(
      {
        seq: 3,
        mutation: {
          tool: RECTANGLE_TOOL_CODE,
          type: MutationType.CREATE,
          id: "rect-1",
        },
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
      { tool: CURSOR_TOOL_CODE, type: MutationType.UPDATE, x: 1, y: 2 },
      true,
    ),
    true,
  );
  assert.equal(
    BoardMessageReplay.shouldBufferLiveMessage(
      { tool: CURSOR_TOOL_CODE, type: MutationType.UPDATE, x: 1, y: 2 },
      false,
    ),
    false,
  );
});
