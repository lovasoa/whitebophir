const test = require("node:test");
const assert = require("node:assert/strict");
const jsonwebtoken = require("jsonwebtoken");

const {
  SOCKET_POLICY_PATH,
  configFromEnv,
  createSocket,
  withEnv,
} = require("./test_helpers.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");

test("getClientIp resolves the first proxy hop from forwarding headers", () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);

  assert.equal(
    socketPolicy.getClientIp(
      configFromEnv({ WBO_IP_SOURCE: "X-Forwarded-For" }),
      createSocket({
        headers: {
          "x-forwarded-for": "198.51.100.4, 203.0.113.7",
        },
      }).socket,
    ),
    "198.51.100.4",
  );

  assert.equal(
    socketPolicy.getClientIp(
      configFromEnv({ WBO_IP_SOURCE: "Forwarded" }),
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
      configFromEnv({ WBO_IP_SOURCE: "X-Forwarded-For" }),
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
      configFromEnv({ WBO_IP_SOURCE: "Forwarded" }),
      createSocket({
        headers: {
          forwarded: ['for="198.51.100.12";proto=https, for=203.0.113.7'],
        },
      }).socket,
    ),
    "198.51.100.12",
  );
});

test("getClientIp supports exact trusted proxy depth for forwarded chains", () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);

  assert.equal(
    socketPolicy.getClientIp(
      configFromEnv({
        WBO_IP_SOURCE: "X-Forwarded-For",
        WBO_TRUST_PROXY_HOPS: "2",
      }),
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
      configFromEnv({
        WBO_IP_SOURCE: "Forwarded",
        WBO_TRUST_PROXY_HOPS: "2",
      }),
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

test("getClientIp supports custom single-value headers such as CF-Connecting-IP", () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  assert.equal(
    socketPolicy.getClientIp(
      configFromEnv({ WBO_IP_SOURCE: "CF-Connecting-IP" }),
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

test("parseForwardedHeader rejects malformed forwarded headers", () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  assert.throws(() => {
    socketPolicy.parseForwardedHeader("proto=https;host=example.com");
  }, /Missing for=/);
});

test("socket policy counts only mutations that should consume rate-limit budget", () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);

  assert.equal(
    socketPolicy.countDestructiveActions({
      _children: [
        { type: MutationType.DELETE },
        { type: MutationType.UPDATE },
        { type: MutationType.DELETE },
      ],
    }),
    2,
  );
  assert.equal(
    socketPolicy.countDestructiveActions({ type: MutationType.CLEAR }),
    1,
  );
  assert.equal(
    socketPolicy.countDestructiveActions({ type: MutationType.UPDATE }),
    0,
  );

  assert.equal(
    socketPolicy.countConstructiveActions({
      _children: [
        { type: MutationType.CREATE, id: "l1" },
        { type: MutationType.UPDATE, id: "l1" },
        { type: MutationType.CREATE, id: "r1" },
      ],
    }),
    2,
  );
  assert.equal(
    socketPolicy.countConstructiveActions({
      type: MutationType.COPY,
      id: "l2",
    }),
    1,
  );
  assert.equal(
    socketPolicy.countConstructiveActions({
      type: MutationType.APPEND,
      id: "c1",
    }),
    0,
  );

  assert.equal(
    socketPolicy.countTextCreationActions({
      tool: "text",
      type: MutationType.CREATE,
      id: "text-1",
    }),
    1,
  );
  assert.equal(
    socketPolicy.countTextCreationActions({
      tool: "text",
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "plain text",
    }),
    0,
  );
  assert.equal(
    socketPolicy.countTextCreationActions({
      _children: [
        { tool: "text", type: MutationType.CREATE, id: "text-2" },
        {
          tool: "text",
          type: MutationType.UPDATE,
          id: "text-2",
          txt: "https://example.com",
        },
      ],
    }),
    2,
  );
});

test("normalizeBroadcastData rejects blocked tools before persistence", () => {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const rejected = socketPolicy.normalizeBroadcastData(
    configFromEnv({ WBO_BLOCKED_TOOLS: "text" }),
    "anonymous",
    {
      tool: "text",
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "blocked",
    },
  );

  assert.deepEqual(rejected, { ok: false, reason: "blocked tool" });
});

test("readonly board policy allows cursor updates but reserves clear for moderators", async () => {
  const readonlyBoard = {
    name: "readonly-test",
    isReadOnly: () => true,
  };

  await withEnv({ AUTH_SECRET_KEY: undefined }, async () => {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const { socket } = createSocket();

    assert.equal(
      socketPolicy.canApplyBoardMessage(
        configFromEnv({ AUTH_SECRET_KEY: undefined }),
        readonlyBoard,
        {
          tool: "cursor",
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
  });

  await withEnv({ AUTH_SECRET_KEY: "test-secret" }, async () => {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const editorToken = jsonwebtoken.sign(
      { roles: ["editor"] },
      process.env.AUTH_SECRET_KEY,
    );
    const moderatorToken = jsonwebtoken.sign(
      { roles: ["moderator"] },
      process.env.AUTH_SECRET_KEY,
    );

    assert.equal(
      socketPolicy.canApplyBoardMessage(
        configFromEnv({ AUTH_SECRET_KEY: "test-secret" }),
        readonlyBoard,
        { tool: "clear", type: MutationType.CLEAR },
        createSocket({ token: editorToken }).socket,
      ),
      false,
    );
    assert.equal(
      socketPolicy.canApplyBoardMessage(
        configFromEnv({ AUTH_SECRET_KEY: "test-secret" }),
        readonlyBoard,
        { tool: "clear", type: MutationType.CLEAR },
        createSocket({ token: moderatorToken }).socket,
      ),
      true,
    );
  });
});
