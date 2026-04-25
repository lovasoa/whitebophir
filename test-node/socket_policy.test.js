const test = require("node:test");
const assert = require("node:assert/strict");
const jsonwebtoken = require("jsonwebtoken");

const {
  SOCKET_POLICY_PATH,
  createConfig,
  createSocket,
} = require("./test_helpers.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Clear, Cursor, Text } = require("../client-data/tools/index.js");

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

test("readonly board policy allows cursor updates but reserves clear for moderators", async () => {
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
});
