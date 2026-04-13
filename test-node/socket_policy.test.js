const test = require("node:test");
const assert = require("node:assert/strict");
const jsonwebtoken = require("jsonwebtoken");

const {
  SOCKET_POLICY_PATH,
  createSocket,
  withEnv,
} = require("./test_helpers.js");

test("getClientIp resolves the first proxy hop from forwarding headers", async function () {
  await withEnv({ WBO_IP_SOURCE: "X-Forwarded-For" }, async function () {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const { socket } = createSocket({
      headers: {
        "x-forwarded-for": "198.51.100.4, 203.0.113.7",
      },
    });
    assert.equal(socketPolicy.getClientIp(socket), "198.51.100.4");
  });

  await withEnv({ WBO_IP_SOURCE: "Forwarded" }, async function () {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const { socket } = createSocket({
      headers: {
        forwarded: 'for="198.51.100.9";proto=https, for=203.0.113.7',
      },
    });
    assert.equal(socketPolicy.getClientIp(socket), "198.51.100.9");
  });

  await withEnv({ WBO_IP_SOURCE: "X-Forwarded-For" }, async function () {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const { socket } = createSocket({
      headers: {
        "x-forwarded-for": ["198.51.100.11, 203.0.113.7"],
      },
    });
    assert.equal(socketPolicy.getClientIp(socket), "198.51.100.11");
  });

  await withEnv({ WBO_IP_SOURCE: "Forwarded" }, async function () {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const { socket } = createSocket({
      headers: {
        forwarded: ['for="198.51.100.12";proto=https, for=203.0.113.7'],
      },
    });
    assert.equal(socketPolicy.getClientIp(socket), "198.51.100.12");
  });
});

test("parseForwardedHeader rejects malformed forwarded headers", function () {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  assert.throws(function () {
    socketPolicy.parseForwardedHeader("proto=https;host=example.com");
  }, /Missing for=/);
});

test("socket policy counts only mutations that should consume rate-limit budget", function () {
  const socketPolicy = require(SOCKET_POLICY_PATH);

  assert.equal(
    socketPolicy.countDestructiveActions({
      _children: [{ type: "delete" }, { type: "update" }, { type: "delete" }],
    }),
    2,
  );
  assert.equal(socketPolicy.countDestructiveActions({ type: "clear" }), 1);
  assert.equal(socketPolicy.countDestructiveActions({ type: "update" }), 0);

  assert.equal(
    socketPolicy.countConstructiveActions({
      _children: [
        { type: "line", id: "l1" },
        { type: "update", id: "l1" },
        { type: "rect", id: "r1" },
      ],
    }),
    2,
  );
  assert.equal(
    socketPolicy.countConstructiveActions({ type: "copy", id: "l2" }),
    1,
  );
  assert.equal(
    socketPolicy.countConstructiveActions({ type: "child", id: "c1" }),
    0,
  );
});

test("normalizeBroadcastData rejects blocked tools before persistence", async function () {
  await withEnv({ WBO_BLOCKED_TOOLS: "Text" }, async function () {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const rejected = socketPolicy.normalizeBroadcastData(
      { board: "anonymous" },
      {
        tool: "Text",
        type: "update",
        id: "text-1",
        txt: "blocked",
      },
    );

    assert.deepEqual(rejected, { ok: false, reason: "blocked tool" });
  });
});

test("readonly board policy allows cursor updates but reserves clear for moderators", async function () {
  const readonlyBoard = {
    name: "readonly-test",
    isReadOnly: function () {
      return true;
    },
  };

  await withEnv({ AUTH_SECRET_KEY: undefined }, async function () {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const { socket } = createSocket();

    assert.equal(
      socketPolicy.canApplyBoardMessage(
        readonlyBoard,
        {
          tool: "Cursor",
          type: "update",
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

  await withEnv({ AUTH_SECRET_KEY: "test-secret" }, async function () {
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
        readonlyBoard,
        { tool: "Clear", type: "clear" },
        createSocket({ token: editorToken }).socket,
      ),
      false,
    );
    assert.equal(
      socketPolicy.canApplyBoardMessage(
        readonlyBoard,
        { tool: "Clear", type: "clear" },
        createSocket({ token: moderatorToken }).socket,
      ),
      true,
    );
  });
});
