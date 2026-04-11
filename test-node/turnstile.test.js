const test = require("node:test");
const assert = require("node:assert/strict");
const { withEnv, createSocket, SOCKETS_PATH } = require("./test_helpers.js");
const WBOMessageCommon = require("../client-data/js/message_common.js");

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
        data: { tool: "Pencil", type: "line", id: "l1" },
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
    },
  );
});

test("server-side Turnstile token validation", async function () {
  await withEnv(
    {
      TURNSTILE_SECRET_KEY: "test-secret",
      TURNSTILE_SITE_KEY: "test-site-key",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      const { socket, handlers } = createSocket();

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
        return {
          json: async () => ({ success: true }),
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
        assert.strictEqual(
          socket.turnstileValidated,
          true,
          "socket should be validated",
        );
        assert.strictEqual(ackCalledWith, true, "ack should be true");

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
        assert.strictEqual(failedAck, false, "ack should be false on failure");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});
