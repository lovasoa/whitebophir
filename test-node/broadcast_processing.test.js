const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  BOARD_DATA_PATH,
  createConfig,
  createSocket,
} = require("./test_helpers.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Cursor, Text } = require("../client-data/tools/index.js");

const BROADCAST_PROCESSING_PATH = path.join(
  __dirname,
  "..",
  "server",
  "broadcast_processing.mjs",
);

/**
 * @returns {Promise<any>}
 */
async function loadBroadcastProcessing() {
  return require(BROADCAST_PROCESSING_PATH);
}

/**
 * @template T
 * @param {T} board
 * @returns {T}
 */
function disableSaves(board) {
  /** @type {{delaySave: () => void}} */ (board).delaySave = () => {};
  return board;
}

test("broadcast processing includes general rate-limit bookkeeping in isolation", async () => {
  const { createBroadcastRateLimits, processBoardBroadcastMessage } =
    await loadBroadcastProcessing();
  const config = createConfig({
    GENERAL_RATE_LIMITS: { limit: 1, periodMs: 60_000, overrides: {} },
    CONSTRUCTIVE_ACTION_RATE_LIMITS: {
      limit: 100,
      periodMs: 60_000,
      overrides: {},
    },
    DESTRUCTIVE_ACTION_RATE_LIMITS: {
      limit: 100,
      periodMs: 60_000,
      overrides: {},
    },
    TEXT_CREATION_RATE_LIMITS: {
      limit: 100,
      periodMs: 60_000,
      overrides: {},
    },
  });
  const { socket } = createSocket({ id: "socket-rate-limit" });
  const board = {
    name: "broadcast-rate-limit",
    isReadOnly: () => false,
    processMessage: () => {
      throw new Error("Cursor updates should not hit board storage");
    },
  };
  const rateLimits = createBroadcastRateLimits(0);

  const first = processBoardBroadcastMessage(
    config,
    board.name,
    board,
    {
      tool: Cursor.id,
      type: MutationType.UPDATE,
      color: "#123456",
      size: 4,
      x: 1,
      y: 2,
    },
    socket,
    { rateLimits, now: 0 },
  );
  assert.equal(first.ok, true);
  assert.equal(first.value.socket, "socket-rate-limit");

  const second = processBoardBroadcastMessage(
    config,
    board.name,
    board,
    {
      tool: Cursor.id,
      type: MutationType.UPDATE,
      color: "#123456",
      size: 4,
      x: 3,
      y: 4,
    },
    socket,
    { rateLimits, now: 1 },
  );
  assert.deepEqual(second, {
    ok: false,
    reason: "rate limit",
    stage: "rate_limit",
  });
});

test("broadcast processing applies board writes without the socket event wrapper", async () => {
  const { createBroadcastRateLimits, processBoardBroadcastMessage } =
    await loadBroadcastProcessing();
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const config = createConfig({
    GENERAL_RATE_LIMITS: { limit: 100, periodMs: 60_000, overrides: {} },
    CONSTRUCTIVE_ACTION_RATE_LIMITS: {
      limit: 100,
      periodMs: 60_000,
      overrides: {},
    },
    DESTRUCTIVE_ACTION_RATE_LIMITS: {
      limit: 100,
      periodMs: 60_000,
      overrides: {},
    },
    TEXT_CREATION_RATE_LIMITS: {
      limit: 100,
      periodMs: 60_000,
      overrides: {},
    },
  });
  const board = disableSaves(new BoardData("broadcast-board-write", config));
  board.processMessage({
    tool: Text.id,
    type: MutationType.CREATE,
    id: "text-1",
    color: "#123456",
    size: 18,
    x: 10,
    y: 20,
  });
  const { socket } = createSocket({ id: "socket-board-write" });

  const result = processBoardBroadcastMessage(
    config,
    board.name,
    board,
    {
      tool: Text.id,
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "updated payload",
    },
    socket,
    { rateLimits: createBroadcastRateLimits(0), now: 0 },
  );

  assert.equal(result.ok, true);
  assert.equal(board.get("text-1").txt, "updated payload");
  assert.equal("revision" in result, false);
});
