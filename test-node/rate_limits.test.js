const test = require("node:test");
const assert = require("node:assert/strict");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Eraser, Pencil, Text } = require("../client-data/tools/index.js");

const {
  createConfig,
  createSocket,
  loadSockets,
  withBoardHistoryDir,
} = require("./test_helpers.js");

/**
 * @param {{[key: string]: any}} overrides
 * @param {(sockets: Awaited<ReturnType<typeof loadSockets>>) => any | Promise<any>} run
 * @returns {Promise<any>}
 */
async function withSocketConfig(overrides, run) {
  return withBoardHistoryDir("wbo-rate-limits-", async ({ historyDir }) => {
    const sockets = await loadSockets(
      createConfig({
        HISTORY_DIR: historyDir,
        ...overrides,
      }),
    );
    sockets.__test.resetRateLimitMaps();
    return run(sockets);
  });
}

test("configuration provides sane default rate-limit ordering", () => {
  const config = createConfig();
  assert.equal(config.IP_SOURCE, "remoteAddress");
  assert.equal(config.TRUST_PROXY_HOPS, 0);
  assert.ok(config.DESTRUCTIVE_ACTION_RATE_LIMITS.limit > 0);
  assert.ok(config.DESTRUCTIVE_ACTION_RATE_LIMITS.periodMs > 0);
  assert.ok(config.CONSTRUCTIVE_ACTION_RATE_LIMITS.limit > 0);
  assert.ok(config.CONSTRUCTIVE_ACTION_RATE_LIMITS.periodMs > 0);
  assert.equal(config.TEXT_CREATION_RATE_LIMITS.limit, 2);
  assert.equal(config.TEXT_CREATION_RATE_LIMITS.periodMs, 1_000);
  assert.equal(
    config.CONSTRUCTIVE_ACTION_RATE_LIMITS.overrides.anonymous?.limit,
    Math.floor(config.CONSTRUCTIVE_ACTION_RATE_LIMITS.limit / 2),
  );
  assert.equal(
    config.DESTRUCTIVE_ACTION_RATE_LIMITS.overrides.anonymous?.limit,
    Math.floor(config.DESTRUCTIVE_ACTION_RATE_LIMITS.limit / 2),
  );
  assert.ok(config.GENERAL_RATE_LIMITS.limit > 0);
  assert.ok(config.GENERAL_RATE_LIMITS.periodMs > 0);
  assert.deepEqual(config.TEXT_CREATION_RATE_LIMITS, {
    limit: 2,
    periodMs: 1_000,
    overrides: {
      anonymous: {
        limit: 30,
        periodMs: 60_000,
      },
    },
  });
  assert.ok(
    config.GENERAL_RATE_LIMITS.limit >
      config.CONSTRUCTIVE_ACTION_RATE_LIMITS.limit,
    "Emit limit should be higher than constructive limit",
  );
  assert.ok(
    config.CONSTRUCTIVE_ACTION_RATE_LIMITS.limit >
      config.TEXT_CREATION_RATE_LIMITS.limit,
    "Constructive limit should be higher than text creation limit",
  );
});

test("general rate limit closes the socket when exceeded", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 0, periodMs: 4096, overrides: {} },
    },
    async (sockets) => {
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.10",
        query: { board: "anonymous" },
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({});

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
      const rateLimitedEvent = emitted.find(
        (event) => event.event === "rate-limited",
      );
      assert.ok(rateLimitedEvent);
      assert.equal(rateLimitedEvent.event, "rate-limited");
    },
  );
});

test("destructive per-IP rate limit closes the socket when exceeded", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 4096, overrides: {} },
      DESTRUCTIVE_ACTION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 0, periodMs: 10_000 } },
      },
    },
    async (sockets) => {
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.11",
        query: { board: "anonymous" },
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({
        tool: Eraser.id,
        type: MutationType.DELETE,
        id: "shape-1",
      });

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
      assert.deepEqual(
        emitted.find((event) => event.event === "rate-limited"),
        {
          event: "rate-limited",
          payload: {
            event: "DESTRUCTIVE_RATE_LIMIT_EXCEEDED",
            kind: "destructive",
            limit: 0,
            periodMs: 10_000,
            retryAfterMs: 10_000,
          },
        },
      );
    },
  );
});

test("constructive per-IP rate limit closes the socket when exceeded", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 4096, overrides: {} },
      CONSTRUCTIVE_ACTION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 0, periodMs: 10_000 } },
      },
    },
    async (sockets) => {
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.13",
        query: { board: "anonymous" },
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({
        tool: Pencil.id,
        type: MutationType.CREATE,
        id: "line-1",
        color: "#123456",
        size: 10,
      });

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
      assert.deepEqual(
        emitted.find((event) => event.event === "rate-limited"),
        {
          event: "rate-limited",
          payload: {
            event: "CONSTRUCTIVE_RATE_LIMIT_EXCEEDED",
            kind: "constructive",
            limit: 0,
            periodMs: 10_000,
            retryAfterMs: 10_000,
          },
        },
      );
    },
  );
});

test("text per-IP rate limit closes the socket when text creation is exceeded", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 4096, overrides: {} },
      CONSTRUCTIVE_ACTION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 10, periodMs: 10_000 } },
      },
      TEXT_CREATION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 0, periodMs: 10_000 } },
      },
    },
    async (sockets) => {
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.16",
        query: { board: "anonymous" },
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({
        tool: Text.id,
        type: MutationType.CREATE,
        id: "text-1",
        color: "#123456",
        size: 24,
        x: 10,
        y: 20,
      });

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
      assert.deepEqual(
        emitted.find((event) => event.event === "rate-limited"),
        {
          event: "rate-limited",
          payload: {
            event: "TEXT_RATE_LIMIT_EXCEEDED",
            kind: "text",
            limit: 0,
            periodMs: 10_000,
            retryAfterMs: 10_000,
          },
        },
      );
    },
  );
});

test("url-like text updates consume text rate-limit budget", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 4096, overrides: {} },
      CONSTRUCTIVE_ACTION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 10, periodMs: 10_000 } },
      },
      TEXT_CREATION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 1, periodMs: 10_000 } },
      },
    },
    async (sockets) => {
      const { socket, handlers, emitted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.17",
        query: { board: "anonymous" },
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({
        tool: Text.id,
        type: MutationType.CREATE,
        id: "text-2",
        color: "#123456",
        size: 24,
        x: 10,
        y: 20,
      });
      assert.notEqual(socket.disconnected, true);

      await handlers.broadcast({
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-2",
        txt: "https://example.com/demo",
      });

      assert.equal(socket.disconnected, true);
      const rateLimited = emitted.find(
        (event) => event.event === "rate-limited",
      );
      assert.deepEqual(rateLimited, {
        event: "rate-limited",
        payload: {
          event: "TEXT_RATE_LIMIT_EXCEEDED",
          kind: "text",
          limit: 1,
          periodMs: 10_000,
          retryAfterMs: rateLimited?.payload?.retryAfterMs,
        },
      });
      assert.ok(rateLimited?.payload?.retryAfterMs <= 10_000);
      assert.ok(rateLimited?.payload?.retryAfterMs > 0);
    },
  );
});

test("plain text updates do not consume text rate-limit budget", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 4096, overrides: {} },
      CONSTRUCTIVE_ACTION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 10, periodMs: 10_000 } },
      },
      TEXT_CREATION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 1, periodMs: 10_000 } },
      },
    },
    async (sockets) => {
      const { socket, handlers } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.18",
        query: { board: "anonymous" },
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({
        tool: Text.id,
        type: MutationType.CREATE,
        id: "text-3",
        color: "#123456",
        size: 24,
        x: 10,
        y: 20,
      });
      await handlers.broadcast({
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-3",
        txt: "plain text only",
      });

      assert.notEqual(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 0);
    },
  );
});

test("resetRateLimitMaps clears text rate-limit state", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 4096, overrides: {} },
      CONSTRUCTIVE_ACTION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 10, periodMs: 10_000 } },
      },
      TEXT_CREATION_RATE_LIMITS: {
        limit: 10,
        periodMs: 10_000,
        overrides: { anonymous: { limit: 1, periodMs: 10_000 } },
      },
    },
    async (sockets) => {
      const first = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.19",
        query: { board: "anonymous" },
        id: "socket-text-1",
      });
      await sockets.__test.handleSocketConnection(
        first.socket,
        sockets.__config,
      );
      assert.ok(first.handlers.broadcast);
      await first.handlers.broadcast({
        tool: Text.id,
        type: MutationType.CREATE,
        id: "text-4",
        color: "#123456",
        size: 24,
        x: 10,
        y: 20,
      });
      assert.notEqual(first.socket.disconnected, true);

      sockets.__test.resetRateLimitMaps();

      const second = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.19",
        query: { board: "anonymous" },
        id: "socket-text-2",
      });
      await sockets.__test.handleSocketConnection(
        second.socket,
        sockets.__config,
      );
      assert.ok(second.handlers.broadcast);
      await second.handlers.broadcast({
        tool: Text.id,
        type: MutationType.CREATE,
        id: "text-5",
        color: "#123456",
        size: 24,
        x: 10,
        y: 20,
      });

      assert.notEqual(second.socket.disconnected, true);
      assert.equal(second.socket.disconnectCalls.length, 0);
    },
  );
});

test("missing configured IP source falls back without disconnecting", async () => {
  await withSocketConfig(
    {
      IP_SOURCE: "X-Forwarded-For",
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 5000, overrides: {} },
      DESTRUCTIVE_ACTION_RATE_LIMITS: {
        limit: 10,
        periodMs: 60_000,
        overrides: { anonymous: { limit: 5, periodMs: 60_000 } },
      },
    },
    async (sockets) => {
      const { socket, handlers } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.12",
        query: { board: "anonymous" },
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.ok(handlers.broadcast);
      await handlers.broadcast({});

      assert.notEqual(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 0);
    },
  );
});

test("connection rejects missing handshake board without registering handlers", async () => {
  await withSocketConfig(
    {
      GENERAL_RATE_LIMITS: { limit: 10, periodMs: 5000, overrides: {} },
    },
    async (sockets) => {
      const { socket, handlers, broadcasted } = createSocket({
        headers: { "user-agent": "test-agent" },
        remoteAddress: "203.0.113.14",
      });
      await sockets.__test.handleSocketConnection(socket, sockets.__config);

      assert.equal(socket.disconnected, true);
      assert.deepEqual(broadcasted, []);
      assert.equal(socket.rooms.size, 0);
      assert.equal(handlers.broadcast, undefined);
    },
  );
});

test("connection rejects malformed handshake board names", async () => {
  await withSocketConfig({}, async (sockets) => {
    const created = createSocket({
      headers: { "user-agent": "test-agent" },
      remoteAddress: "203.0.113.15",
      query: { board: /** @type {any} */ ({ bad: true }) },
    });
    await sockets.__test.handleSocketConnection(
      created.socket,
      sockets.__config,
    );

    assert.equal(created.socket.disconnected, true);
    assert.equal(created.socket.rooms.size, 0);
    assert.equal(created.handlers.broadcast, undefined);
  });
});
