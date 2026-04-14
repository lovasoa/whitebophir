const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONFIG_PATH,
  SOCKETS_PATH,
  createSocket,
  withEnv,
} = require("./test_helpers.js");

test("configuration provides sane default rate-limit ordering", () =>
  withEnv({ WBO_IP_SOURCE: undefined }, () => {
    const config = require(CONFIG_PATH);

    assert.equal(config.IP_SOURCE, "remoteAddress");
    assert.equal(config.TRUST_PROXY_HOPS, 0);
    assert.ok(config.MAX_DESTRUCTIVE_ACTIONS_PER_IP > 0);
    assert.ok(config.MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS > 0);
    assert.ok(config.MAX_CONSTRUCTIVE_ACTIONS_PER_IP > 0);
    assert.ok(config.MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS > 0);
    assert.equal(
      config.ANONYMOUS_MAX_CONSTRUCTIVE_ACTIONS_PER_IP,
      Math.floor(config.MAX_CONSTRUCTIVE_ACTIONS_PER_IP / 2),
    );
    assert.equal(
      config.ANONYMOUS_MAX_DESTRUCTIVE_ACTIONS_PER_IP,
      Math.floor(config.MAX_DESTRUCTIVE_ACTIONS_PER_IP / 2),
    );
    assert.ok(config.GENERAL_RATE_LIMITS.limit > 0);
    assert.ok(config.GENERAL_RATE_LIMITS.periodMs > 0);

    const emitRate =
      config.GENERAL_RATE_LIMITS.limit / config.GENERAL_RATE_LIMITS.periodMs;
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
  }));

test("configuration rejects trust proxy hops with incompatible ip sources", () =>
  assert.rejects(
    withEnv(
      {
        WBO_IP_SOURCE: "CF-Connecting-IP",
        WBO_TRUST_PROXY_HOPS: "1",
      },
      () => {
        require(CONFIG_PATH);
      },
    ),
    /WBO_TRUST_PROXY_HOPS requires WBO_IP_SOURCE to be X-Forwarded-For or Forwarded/,
  ));

test("configuration parses compact rate-limit profiles", () =>
  withEnv(
    {
      WBO_MAX_EMIT_COUNT: "*:300/6s anonymous:150/6s",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:240/60s anonymous:120/60s",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:180/2m anonymous:90/45s",
    },
    () => {
      const config = require(CONFIG_PATH);

      assert.deepEqual(config.GENERAL_RATE_LIMITS, {
        limit: 300,
        periodMs: 6_000,
        overrides: {
          anonymous: {
            limit: 150,
            periodMs: 6_000,
          },
        },
      });
      assert.deepEqual(config.CONSTRUCTIVE_ACTION_RATE_LIMITS, {
        limit: 240,
        periodMs: 60_000,
        overrides: {
          anonymous: {
            limit: 120,
            periodMs: 60_000,
          },
        },
      });
      assert.deepEqual(config.DESTRUCTIVE_ACTION_RATE_LIMITS, {
        limit: 180,
        periodMs: 120_000,
        overrides: {
          anonymous: {
            limit: 90,
            periodMs: 45_000,
          },
        },
      });
    },
  ));

test("compact rate-limit profiles do not invent board overrides", () =>
  withEnv(
    {
      WBO_MAX_EMIT_COUNT: "*:300/6s",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:240/60s",
    },
    () => {
      const config = require(CONFIG_PATH);
      assert.deepEqual(config.GENERAL_RATE_LIMITS, {
        limit: 300,
        periodMs: 6_000,
        overrides: {},
      });
      assert.deepEqual(config.CONSTRUCTIVE_ACTION_RATE_LIMITS, {
        limit: 240,
        periodMs: 60_000,
        overrides: {},
      });
    },
  ));

test("general rate limit closes the socket when exceeded", async () => {
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:0/4096ms",
    },
    async () => {
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

test("destructive per-IP rate limit closes the socket when exceeded", async () => {
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:0/10s",
    },
    async () => {
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
          kind: "destructive",
          limit: 0,
          periodMs: 10_000,
          retryAfterMs: 10_000,
        },
      });
    },
  );
});

test("constructive per-IP rate limit closes the socket when exceeded", async () => {
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:0/10s",
    },
    async () => {
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
          kind: "constructive",
          limit: 0,
          periodMs: 10_000,
          retryAfterMs: 10_000,
        },
      });
    },
  );
});

test("missing configured IP source falls back without disconnecting", async () => {
  await withEnv(
    {
      WBO_IP_SOURCE: "X-Forwarded-For",
      WBO_MAX_EMIT_COUNT: "*:10/5s",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:10/60s anonymous:5/60s",
    },
    async () => {
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
