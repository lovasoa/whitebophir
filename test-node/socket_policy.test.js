const test = require("node:test");
const assert = require("node:assert/strict");
const jsonwebtoken = require("jsonwebtoken");

const {
  SOCKET_POLICY_PATH,
  createConfig,
  createSocket,
} = require("./test_helpers.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const {
  Clear,
  Cursor,
  Hand,
  Rectangle,
  Text,
} = require("../client-data/tools/index.js");

require(SOCKET_POLICY_PATH);

test("getClientIp resolves the first proxy hop from forwarding headers", async () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const forwardedForConfig = createConfig({ IP_SOURCE: "X-Forwarded-For" });
  const forwardedConfig = createConfig({ IP_SOURCE: "Forwarded" });

  assert.equal(
    socketPolicy.getRequestClientIp(
      forwardedForConfig,
      createSocket({
        headers: {
          "x-forwarded-for": "198.51.100.4, 203.0.113.7",
        },
      }).socket.client.request,
    ),
    "198.51.100.4",
  );

  assert.equal(
    socketPolicy.getClientIp(
      forwardedConfig,
      createSocket({
        headers: {
          forwarded: 'for="198.51.100.9";proto=https, for=203.0.113.7',
        },
      }).socket,
    ),
    "198.51.100.9",
  );

  assert.equal(
    socketPolicy.getClientIp(
      forwardedForConfig,
      createSocket({
        headers: {
          "x-forwarded-for": ["198.51.100.11, 203.0.113.7"],
        },
      }).socket,
    ),
    "198.51.100.11",
  );

  assert.equal(
    socketPolicy.getClientIp(
      forwardedConfig,
      createSocket({
        headers: {
          forwarded: ['for="198.51.100.12";proto=https, for=203.0.113.7'],
        },
      }).socket,
    ),
    "198.51.100.12",
  );
});

test("getClientIp supports exact trusted proxy depth for forwarded chains", async () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const forwardedForConfig = createConfig({
    IP_SOURCE: "X-Forwarded-For",
    TRUST_PROXY_HOPS: 2,
  });
  const forwardedConfig = createConfig({
    IP_SOURCE: "Forwarded",
    TRUST_PROXY_HOPS: 2,
  });

  assert.equal(
    socketPolicy.getClientIp(
      forwardedForConfig,
      createSocket({
        remoteAddress: "203.0.113.7",
        headers: {
          "x-forwarded-for": "198.51.100.4, 198.51.100.5",
        },
      }).socket,
    ),
    "198.51.100.4",
  );

  assert.equal(
    socketPolicy.getClientIp(
      forwardedConfig,
      createSocket({
        remoteAddress: "203.0.113.7",
        headers: {
          forwarded: 'for=198.51.100.9;proto=https, for="198.51.100.10"',
        },
      }).socket,
    ),
    "198.51.100.9",
  );
});

test("getClientIp supports custom single-value headers such as CF-Connecting-IP", async () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const config = createConfig({ IP_SOURCE: "CF-Connecting-IP" });
  assert.equal(
    socketPolicy.getClientIp(
      config,
      createSocket({
        remoteAddress: "203.0.113.7",
        headers: {
          "cf-connecting-ip": "198.51.100.25",
        },
      }).socket,
    ),
    "198.51.100.25",
  );
});

test("parseForwardedChain rejects malformed forwarded headers", () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  assert.throws(() => {
    socketPolicy.parseForwardedChain("proto=https;host=example.com");
  }, /Missing for=/);
});

test("normalizeBroadcastData rejects blocked tools before persistence", async () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const config = createConfig({ BLOCKED_TOOLS: ["text"] });
  const rejected = socketPolicy.normalizeBroadcastData(config, "anonymous", {
    tool: Text.id,
    type: MutationType.UPDATE,
    id: "text-1",
    txt: "blocked",
  });

  assert.deepEqual(rejected, { ok: false, reason: "blocked tool" });
});

test("normalizeBroadcastData uses supplied runtime limits for socket validation", async () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const rectangleMessage = {
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-1",
    color: "#123456",
    size: 10,
    opacity: 1,
    x: 0,
    y: 0,
    x2: 120,
    y2: 20,
  };

  assert.equal(
    socketPolicy.normalizeBroadcastData(
      createConfig({ MAX_BOARD_SIZE: 120 }),
      "anonymous",
      rectangleMessage,
    ).ok,
    true,
  );
  assert.deepEqual(
    socketPolicy.normalizeBroadcastData(
      createConfig({ MAX_BOARD_SIZE: 100 }),
      "anonymous",
      rectangleMessage,
    ),
    { ok: false, reason: "x2: invalid coord" },
  );

  const handBatch = {
    tool: Hand.id,
    _children: [
      {
        type: MutationType.UPDATE,
        id: "rect-1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 6 },
      },
      {
        type: MutationType.UPDATE,
        id: "rect-2",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 },
      },
    ],
  };

  assert.equal(
    socketPolicy.normalizeBroadcastData(
      createConfig({ MAX_CHILDREN: 2 }),
      "anonymous",
      handBatch,
    ).ok,
    true,
  );
  assert.deepEqual(
    socketPolicy.normalizeBroadcastData(
      createConfig({ MAX_CHILDREN: 1 }),
      "anonymous",
      handBatch,
      { canOpen: true, canEdit: true, canClear: false },
    ),
    { ok: false, reason: "too many children" },
  );
  assert.equal(
    socketPolicy.normalizeBroadcastData(
      createConfig({ MAX_CHILDREN: 1 }),
      "anonymous",
      handBatch,
      { canOpen: true, canEdit: true, canClear: true },
    ).ok,
    true,
  );
});

test("socket board policy uses capabilities for cursor, edit, and clear decisions", async () => {
  const readonlyBoard = {
    name: "readonly-test",
    isReadOnly: () => true,
  };

  const socketPolicy = require(SOCKET_POLICY_PATH);
  const { socket } = createSocket();
  const unauthenticatedConfig = createConfig({ AUTH_SECRET_KEY: "" });

  assert.equal(
    socketPolicy.canApplyBoardMessage(
      unauthenticatedConfig,
      readonlyBoard,
      {
        tool: Cursor.id,
        type: MutationType.UPDATE,
        color: "#123456",
        size: 4,
        x: 1,
        y: 2,
      },
      socket,
    ),
    true,
  );
  assert.equal(
    socketPolicy.canApplyBoardMessage(
      unauthenticatedConfig,
      readonlyBoard,
      {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-1",
        txt: "blocked",
      },
      socket,
    ),
    false,
  );

  const authenticatedConfig = createConfig({ AUTH_SECRET_KEY: "test-secret" });
  const editorToken = jsonwebtoken.sign(
    { roles: ["editor"] },
    authenticatedConfig.AUTH_SECRET_KEY,
  );
  const moderatorToken = jsonwebtoken.sign(
    { roles: ["moderator"] },
    authenticatedConfig.AUTH_SECRET_KEY,
  );

  assert.equal(
    socketPolicy.canApplyBoardMessage(
      authenticatedConfig,
      readonlyBoard,
      {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-1",
        txt: "allowed",
      },
      createSocket({ token: editorToken }).socket,
    ),
    true,
  );
  assert.equal(
    socketPolicy.canApplyBoardMessage(
      authenticatedConfig,
      readonlyBoard,
      { tool: Clear.id, type: MutationType.CLEAR },
      createSocket({ token: editorToken }).socket,
    ),
    false,
  );
  assert.equal(
    socketPolicy.canApplyBoardMessage(
      authenticatedConfig,
      readonlyBoard,
      { tool: Clear.id, type: MutationType.CLEAR },
      createSocket({ token: moderatorToken }).socket,
    ),
    true,
  );
  assert.deepEqual(
    socketPolicy.boardStateForSocket(
      authenticatedConfig,
      readonlyBoard,
      createSocket({ token: moderatorToken }).socket,
    ),
    {
      readonly: true,
      canEdit: true,
      canClear: true,
      canWrite: true,
    },
  );
  assert.equal(
    socketPolicy.boardCapabilitiesForSocket(
      authenticatedConfig,
      readonlyBoard.name,
      createSocket({ token: moderatorToken }).socket,
    ).canClear,
    true,
  );
  assert.equal(
    socketPolicy.boardCapabilitiesForSocket(
      authenticatedConfig,
      readonlyBoard.name,
      createSocket({ token: editorToken }).socket,
    ).canClear,
    false,
  );
});

test("configured moderator secret grants edit clear and ban on readonly board", async () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const moderatorSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const readonlyBoard = {
    name: "secret-mod-board",
    isReadOnly: () => true,
  };
  const config = createConfig({
    AUTH_SECRET_KEY: "",
    BOARD_MODERATORS: new Map([
      ["secret-mod-board", new Set([moderatorSecret])],
    ]),
  });

  const moderatorSocket = createSocket({
    headers: { cookie: `wbo-user-secret-v1=${moderatorSecret}` },
  }).socket;
  assert.deepEqual(
    socketPolicy.boardStateForSocket(config, readonlyBoard, moderatorSocket),
    {
      readonly: true,
      canEdit: true,
      canClear: true,
      canWrite: true,
    },
  );
  assert.equal(
    socketPolicy.canBanOnBoard(config, readonlyBoard.name, moderatorSocket),
    true,
  );
  assert.equal(
    socketPolicy.boardCapabilitiesForSocket(
      config,
      readonlyBoard.name,
      moderatorSocket,
    ).canClear,
    true,
  );

  const unlistedSocket = createSocket({
    headers: { cookie: "wbo-user-secret-v1=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  }).socket;
  assert.equal(
    socketPolicy.canBanOnBoard(config, readonlyBoard.name, unlistedSocket),
    false,
  );
  assert.equal(
    socketPolicy.boardCapabilitiesForSocket(
      config,
      readonlyBoard.name,
      unlistedSocket,
    ).canClear,
    false,
  );
});
