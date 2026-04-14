const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONFIG_PATH,
  SOCKETS_PATH,
  createSocket,
  withEnv,
} = require("./test_helpers.js");

test("configuration provides sane default rate-limit ordering", function () {
  return withEnv({ WBO_IP_SOURCE: undefined }, function () {
    const config = require(CONFIG_PATH);

    assert.equal(config.IP_SOURCE, "remoteAddress");
    assert.equal(config.TRUST_PROXY_HOPS, 0);
    assert.ok(config.MAX_DESTRUCTIVE_ACTIONS_PER_IP > 0);
    assert.ok(config.MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS > 0);
    assert.ok(config.MAX_CONSTRUCTIVE_ACTIONS_PER_IP > 0);
    assert.ok(config.MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS > 0);
    assert.ok(config.MAX_EMIT_COUNT > 0);
    assert.ok(config.MAX_EMIT_COUNT_PERIOD > 0);

    const emitRate = config.MAX_EMIT_COUNT / config.MAX_EMIT_COUNT_PERIOD;
    const constructiveRate =
      config.MAX_CONSTRUCTIVE_ACTIONS_PER_IP /
      config.MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS;
    const destructiveRate =
      config.MAX_DESTRUCTIVE_ACTIONS_PER_IP /
      config.MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS;

    assert.ok(
      emitRate > constructiveRate,
      "Emit rate should be higher than constructive rate",
    );
    assert.ok(
      constructiveRate > destructiveRate,
      "Constructive rate should be higher than destructive rate",
    );
  });
});

test("configuration rejects trust proxy hops with incompatible ip sources", function () {
  return assert.rejects(
    withEnv(
      {
        WBO_IP_SOURCE: "CF-Connecting-IP",
        WBO_TRUST_PROXY_HOPS: "1",
      },
      function () {
        require(CONFIG_PATH);
      },
    ),
    /WBO_TRUST_PROXY_HOPS requires WBO_IP_SOURCE to be X-Forwarded-For or Forwarded/,
  );
});

test("general rate limit closes the socket when exceeded", async function () {
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "0",
      WBO_MAX_EMIT_COUNT_PERIOD: "4096",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.10",
      });
      sockets.__test.handleSocketConnection(socket);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({});

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
      assert.ok(emitted[0]);
      assert.equal(emitted[0].event, "rate-limited");
    },
  );
});

test("destructive per-IP rate limit closes the socket when exceeded", async function () {
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "10",
      WBO_MAX_EMIT_COUNT_PERIOD: "4096",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "0",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS: "10000",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      sockets.__test.resetRateLimitMaps();
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.11",
      });
      sockets.__test.handleSocketConnection(socket);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({
        board: "anonymous",
        data: { tool: "Eraser", type: "delete", id: "shape-1" },
      });

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
      assert.deepEqual(emitted[0], {
        event: "rate-limited",
        payload: {
          event: "DESTRUCTIVE_RATE_LIMIT_EXCEEDED",
        },
      });
    },
  );
});

test("constructive per-IP rate limit closes the socket when exceeded", async function () {
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "10",
      WBO_MAX_EMIT_COUNT_PERIOD: "4096",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "0",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS: "10000",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      sockets.__test.resetRateLimitMaps();
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.13",
      });
      sockets.__test.handleSocketConnection(socket);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({
        board: "anonymous",
        data: {
          tool: "Pencil",
          type: "line",
          id: "line-1",
          color: "#123456",
          size: 4,
        },
      });

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
      assert.deepEqual(emitted[0], {
        event: "rate-limited",
        payload: {
          event: "CONSTRUCTIVE_RATE_LIMIT_EXCEEDED",
        },
      });
    },
  );
});

test("missing configured IP source falls back without disconnecting", async function () {
  await withEnv(
    {
      WBO_IP_SOURCE: "X-Forwarded-For",
      WBO_MAX_EMIT_COUNT: "10",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "10",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      const { socket, handlers } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.12",
      });
      sockets.__test.handleSocketConnection(socket);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({});

      assert.notEqual(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 0);
    },
  );
});
