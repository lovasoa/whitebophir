const test = require("node:test");
const assert = require("node:assert/strict");
const { withEnv, createSocket, SOCKETS_PATH } = require("./test_helpers.js");
const WBOMessageCommon = require("../client-data/js/message_common.js");

function withMockedNow(value, fn) {
  const originalNow = Date.now;
  Date.now = () => value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Date.now = originalNow;
    });
}

test("requiresTurnstile shared utility logic", function () {
  assert.equal(WBOMessageCommon.requiresTurnstile("anonymous", "Pencil"), true);
  assert.equal(WBOMessageCommon.requiresTurnstile("anonymous", "Clear"), true);
  assert.equal(
    WBOMessageCommon.requiresTurnstile("anonymous", "Cursor"),
    false,
  );
  assert.equal(
    WBOMessageCommon.requiresTurnstile("named-board", "Pencil"),
    false,
  );
  assert.equal(
    WBOMessageCommon.requiresTurnstile("anonymous", undefined),
    false,
  );
});

test("server-side Turnstile enforcement in broadcast", async function () {
  await withEnv(
    {
      TURNSTILE_SECRET_KEY: "test-secret",
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_VALIDATION_WINDOW_MS: "1000",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      const { socket, handlers } = createSocket();

      // Initialize socket state by calling handleSocketConnection
      sockets.__test.handleSocketConnection(socket);

      const broadcastHandler = handlers["broadcast"];
      assert.ok(broadcastHandler, "broadcast handler should be registered");

      // 1. Blocked: Anonymous board, Pencil tool, not validated
      let broadcastCalled = false;
      socket.broadcast.to = function () {
        return {
          emit: () => {
            broadcastCalled = true;
          },
        };
      };

      await broadcastHandler({
        board: "anonymous",
        data: {
          tool: "Pencil",
          type: "line",
          id: "l1",
          color: "#123456",
          size: 4,
        },
      });
      assert.strictEqual(
        broadcastCalled,
        false,
        "Should block unvalidated broadcast on anonymous board",
      );

      // 2. Allowed: Cursor tool, not validated
      // (This verifies the shared logic integration in the socket handler)
      await broadcastHandler({
        board: "anonymous",
        data: { tool: "Cursor", type: "update", x: 10, y: 20 },
      });

      // 3. Allowed: Pencil tool, AFTER validation
      socket.turnstileValidatedUntil = 1000;
      await withMockedNow(500, async function () {
        await broadcastHandler({
          board: "anonymous",
          data: {
            tool: "Pencil",
            type: "line",
            id: "l2",
            color: "#123456",
            size: 4,
          },
        });
      });
      assert.equal(
        socket.rooms.has("anonymous"),
        true,
        "Should advance to board handling before validation expiry",
      );

      socket.rooms.delete("anonymous");
      socket.turnstileValidatedUntil = 1000;
      await withMockedNow(1001, async function () {
        await broadcastHandler({
          board: "anonymous",
          data: {
            tool: "Pencil",
            type: "line",
            id: "l3",
            color: "#123456",
            size: 4,
          },
        });
      });
      assert.equal(
        socket.rooms.has("anonymous"),
        false,
        "Should block protected broadcasts after validation expiry",
      );
    },
  );
});

test("server-side Turnstile token validation binds Siteverify to request context", async function () {
  await withEnv(
    {
      TURNSTILE_SECRET_KEY: "test-secret",
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_VALIDATION_WINDOW_MS: "120000",
    },
    async function () {
      const config = require("../server/configuration.js");
      const sockets = require(SOCKETS_PATH);
      const { socket, handlers } = createSocket({
        headers: { host: "board.example" },
        remoteAddress: "203.0.113.10",
      });

      // Mock global fetch
      const originalFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = async (url, options) => {
        fetchCalled = true;
        assert.strictEqual(
          url,
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        );
        const body = new URLSearchParams(options.body);
        assert.strictEqual(body.get("secret"), "test-secret");
        assert.strictEqual(body.get("response"), "valid-token");
        assert.strictEqual(body.get("remoteip"), "203.0.113.10");
        return {
          json: async () => ({
            success: true,
            hostname: "board.example",
          }),
        };
      };

      try {
        sockets.__test.handleSocketConnection(socket);
        const tokenHandler = handlers["turnstile_token"];
        assert.ok(tokenHandler, "turnstile_token handler should be registered");

        let ackCalledWith = null;
        await tokenHandler("valid-token", (result) => {
          ackCalledWith = result;
        });
        assert.strictEqual(fetchCalled, true, "fetch should have been called");
        assert.equal(
          socket.turnstileValidatedUntil,
          Date.now() + config.TURNSTILE_VALIDATION_WINDOW_MS,
          "socket validation should expire after the configured window",
        );
        assert.deepEqual(ackCalledWith, {
          success: true,
          validationWindowMs: config.TURNSTILE_VALIDATION_WINDOW_MS,
          validatedUntil: socket.turnstileValidatedUntil,
        });

        // Test failed validation
        globalThis.fetch = async (url, options) => {
          return {
            json: async () => ({
              success: false,
              "error-codes": ["invalid-input-response"],
            }),
          };
        };
        let failedAck = null;
        await tokenHandler("invalid-token", (result) => {
          failedAck = result;
        });
        assert.deepEqual(
          failedAck,
          { success: false },
          "ack should be false on failure",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("server-side Turnstile token validation rejects hostname mismatches", async function () {
  await withEnv(
    {
      TURNSTILE_SECRET_KEY: "test-secret",
      TURNSTILE_SITE_KEY: "test-site-key",
    },
    async function () {
      const config = require("../server/configuration.js");
      const sockets = require(SOCKETS_PATH);
      const { socket, handlers } = createSocket({
        headers: { host: "board.example:8080" },
      });

      const originalFetch = globalThis.fetch;
      try {
        sockets.__test.handleSocketConnection(socket);
        const tokenHandler = handlers["turnstile_token"];

        globalThis.fetch = async function hostnameMismatch() {
          return {
            json: async () => ({
              success: true,
              hostname: "other.example",
            }),
          };
        };
        let hostnameMismatchAck = null;
        await tokenHandler("valid-token", (result) => {
          hostnameMismatchAck = result;
        });
        assert.deepEqual(hostnameMismatchAck, { success: false });
        assert.equal(
          socket.turnstileValidatedUntil,
          undefined,
          "hostname mismatch should not validate the socket",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});
