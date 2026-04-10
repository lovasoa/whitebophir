const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "server", "configuration.js");
const LOG_PATH = path.join(ROOT, "server", "log.js");
const SOCKETS_PATH = path.join(ROOT, "server", "sockets.js");

function clearModuleCache(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

async function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  clearModuleCache(CONFIG_PATH);
  clearModuleCache(LOG_PATH);
  clearModuleCache(SOCKETS_PATH);

  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    clearModuleCache(CONFIG_PATH);
    clearModuleCache(LOG_PATH);
    clearModuleCache(SOCKETS_PATH);
  }
}

function createSocket(headers, remoteAddress) {
  const handlers = {};
  const emitted = [];
  const socket = {
    id: "socket-1",
    handshake: { query: {} },
    rooms: new Set(),
    client: {
      request: {
        headers: headers || {},
        socket: { remoteAddress: remoteAddress || "127.0.0.1" },
      },
    },
    broadcast: {
      to: function () {
        return {
          emit: function () {},
        };
      },
    },
    disconnectCalls: [],
    on: function (event, handler) {
      handlers[event] = handler;
    },
    join: function (room) {
      this.rooms.add(room);
    },
    emit: function (event, payload) {
      emitted.push({ event, payload });
    },
    disconnect: function (close) {
      this.disconnectCalls.push(close);
      this.disconnected = true;
    },
  };
  return { socket, handlers, emitted };
}

test("configuration provides sane defaults when environment is empty", function () {
  return withEnv({ WBO_IP_SOURCE: undefined }, function () {
    const config = require(CONFIG_PATH);
    // The IP source should safely default to the enum fallback
    assert.equal(config.IP_SOURCE, "remoteAddress");

    // Rate limits should be positive integers
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

    // The allowed rate of general events (like drawing points) should be higher than creating objects
    assert.ok(
      emitRate > constructiveRate,
      "Emit rate should be higher than constructive rate",
    );

    // The allowed rate of creating objects should be higher than destroying objects
    assert.ok(
      constructiveRate > destructiveRate,
      "Constructive rate should be higher than destructive rate",
    );
  });
});

test("configuration parses WBO_IP_SOURCE case-insensitively", function () {
  return withEnv({ WBO_IP_SOURCE: "X-Forwarded-For" }, function () {
    const config = require(CONFIG_PATH);
    assert.equal(config.IP_SOURCE, "X-Forwarded-For");
  });
});

test("getClientIp resolves X-Forwarded-For from the first hop", function () {
  return withEnv({ WBO_IP_SOURCE: "X-Forwarded-For" }, function () {
    const sockets = require(SOCKETS_PATH);
    const { socket } = createSocket({
      "x-forwarded-for": "198.51.100.4, 203.0.113.7",
    });
    assert.equal(sockets.__test.getClientIp(socket), "198.51.100.4");
  });
});

test("getClientIp resolves Forwarded from the first for= token", function () {
  return withEnv({ WBO_IP_SOURCE: "Forwarded" }, function () {
    const sockets = require(SOCKETS_PATH);
    const { socket } = createSocket({
      forwarded: 'for="198.51.100.9";proto=https, for=203.0.113.7',
    });
    assert.equal(sockets.__test.getClientIp(socket), "198.51.100.9");
  });
});

test("countDestructiveActions counts delete-like mutations only", function () {
  const sockets = require(SOCKETS_PATH);
  assert.equal(
    sockets.__test.countDestructiveActions({
      _children: [{ type: "delete" }, { type: "update" }, { type: "delete" }],
    }),
    2,
  );
  assert.equal(sockets.__test.countDestructiveActions({ type: "clear" }), 1);
  assert.equal(sockets.__test.countDestructiveActions({ type: "update" }), 0);
});

test("countConstructiveActions counts new object creation only", function () {
  const sockets = require(SOCKETS_PATH);
  assert.equal(
    sockets.__test.countConstructiveActions({
      _children: [
        { type: "line", id: "l1" },
        { type: "update", id: "l1" },
        { type: "rect", id: "r1" },
      ],
    }),
    2,
  );
  assert.equal(
    sockets.__test.countConstructiveActions({ type: "line", id: "l1" }),
    1,
  );
  assert.equal(
    sockets.__test.countConstructiveActions({ type: "copy", id: "l2" }),
    1,
  );
  assert.equal(
    sockets.__test.countConstructiveActions({ type: "update", id: "l1" }),
    0,
  );
  assert.equal(
    sockets.__test.countConstructiveActions({ type: "delete", id: "l1" }),
    0,
  );
  assert.equal(
    sockets.__test.countConstructiveActions({ type: "child", id: "c1" }),
    0,
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
      const { socket, handlers, emitted } = createSocket(
        { "user-agent": "test-agent" },
        "203.0.113.10",
      );
      sockets.__test.handleSocketConnection(socket);

      await handlers.broadcast({});

      assert.equal(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 1);
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
      const { socket, handlers, emitted } = createSocket(
        { "user-agent": "test-agent" },
        "203.0.113.11",
      );
      sockets.__test.handleSocketConnection(socket);

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
      const { socket, handlers, emitted } = createSocket(
        { "user-agent": "test-agent" },
        "203.0.113.13",
      );
      sockets.__test.handleSocketConnection(socket);

      await handlers.broadcast({
        board: "anonymous",
        data: { tool: "Pencil", type: "line", id: "line-1" },
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

test("missing configured IP source does not close the socket and fallbacks", async function () {
  await withEnv(
    {
      WBO_IP_SOURCE: "X-Forwarded-For",
      WBO_MAX_EMIT_COUNT: "10",
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "10",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      const { socket, handlers } = createSocket(
        { "user-agent": "test-agent" },
        "203.0.113.12",
      );
      sockets.__test.handleSocketConnection(socket);

      await handlers.broadcast({});

      assert.notEqual(socket.disconnected, true);
      assert.equal(socket.disconnectCalls.length, 0);
    },
  );
});
