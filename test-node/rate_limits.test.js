const test = require("node:test");
const assert = require("node:assert/strict");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Eraser, Pencil, Text } = require("../client-data/tools/index.js");

const {
  createConfig,
  createSocket,
  loadSockets,
  withEnv,
} = require("./test_helpers.js");

test("configuration provides sane default rate-limit ordering", async () =>
  withEnv({ WBO_IP_SOURCE: undefined }, () => {
    return Promise.resolve(createConfig()).then((config) => {
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
  }));

test("configuration rejects trust proxy hops with incompatible ip sources", () =>
  assert.rejects(
    withEnv(
      {
        WBO_IP_SOURCE: "CF-Connecting-IP",
        WBO_TRUST_PROXY_HOPS: "1",
      },
      () => createConfig(),
    ),
    /WBO_TRUST_PROXY_HOPS requires WBO_IP_SOURCE to be X-Forwarded-For or Forwarded/,
  ));

test("configuration parses compact rate-limit profiles", async () =>
  withEnv(
    {
      WBO_MAX_EMIT_COUNT: "*:300/6s anonymous:150/6s",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:240/60s anonymous:120/60s",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:180/2m anonymous:90/45s",
      WBO_MAX_TEXT_CREATIONS_PER_IP: "*:3/1500ms anonymous:9/90s",
    },
    async () => {
      const config = createConfig();

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
      assert.deepEqual(config.TEXT_CREATION_RATE_LIMITS, {
        limit: 3,
        periodMs: 1_500,
        overrides: {
          anonymous: {
            limit: 9,
            periodMs: 90_000,
          },
        },
      });
    },
  ));

test("compact rate-limit profiles do not invent board overrides", async () =>
  withEnv(
    {
      WBO_MAX_EMIT_COUNT: "*:300/6s",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:240/60s",
      WBO_MAX_TEXT_CREATIONS_PER_IP: "*:3/1500ms",
    },
    async () => {
      const config = createConfig();
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
      assert.deepEqual(config.TEXT_CREATION_RATE_LIMITS, {
        limit: 3,
        periodMs: 1_500,
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
      const sockets = await loadSockets();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:0/10s",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:0/10s",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();
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
        size: 4,
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:10/10s",
      WBO_MAX_TEXT_CREATIONS_PER_IP: "*:10/10s anonymous:0/10s",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:10/10s",
      WBO_MAX_TEXT_CREATIONS_PER_IP: "*:10/10s anonymous:1/10s",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:10/10s",
      WBO_MAX_TEXT_CREATIONS_PER_IP: "*:10/10s anonymous:1/10s",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/4096ms",
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:10/10s anonymous:10/10s",
      WBO_MAX_TEXT_CREATIONS_PER_IP: "*:10/10s anonymous:1/10s",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "X-Forwarded-For",
      WBO_MAX_EMIT_COUNT: "*:10/5s",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:10/60s anonymous:5/60s",
    },
    async () => {
      const sockets = await loadSockets();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_MAX_EMIT_COUNT: "*:10/5s",
    },
    async () => {
      const sockets = await loadSockets();
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
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();
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
    },
  );
});
