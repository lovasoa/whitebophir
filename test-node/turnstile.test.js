const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  CONFIG_PATH,
  withEnv,
  createSocket,
  loadSockets,
  withMockedNow,
} = require("./test_helpers.js");
const WBOMessageCommon = require("../client-data/js/message_common.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Cursor, Pencil } = require("../client-data/tools/index.js");

/**
 * @returns {Promise<string>}
 */
function createHistoryDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "wbo-turnstile-"));
}

/**
 * @param {any} board
 * @returns {void}
 */
function disableSaves(board) {
  board.delaySave = () => {};
}

test("requiresTurnstile shared utility logic", () => {
  assert.equal(WBOMessageCommon.requiresTurnstile("anonymous", "pencil"), true);
  assert.equal(WBOMessageCommon.requiresTurnstile("anonymous", "clear"), true);
  assert.equal(
    WBOMessageCommon.requiresTurnstile("anonymous", "cursor"),
    false,
  );
  assert.equal(
    WBOMessageCommon.requiresTurnstile("named-board", "pencil"),
    false,
  );
  assert.equal(
    WBOMessageCommon.requiresTurnstile("anonymous", undefined),
    false,
  );
});

test("server-side Turnstile enforcement in broadcast", async () => {
  const historyDir = await createHistoryDir();
  await withEnv(
    {
      TURNSTILE_SECRET_KEY: "test-secret",
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_VALIDATION_WINDOW_MS: "1000",
      WBO_HISTORY_DIR: historyDir,
    },
    async () => {
      const sockets = await loadSockets();
      const { socket, handlers } = createSocket({
        query: { board: "anonymous" },
      });

      // Initialize socket state by calling handleSocketConnection
      await sockets.__test.handleSocketConnection(socket, sockets.__config);
      disableSaves(await sockets.__test.getLoadedBoard("anonymous"));

      const broadcastHandler = handlers.broadcast;
      assert.ok(broadcastHandler, "broadcast handler should be registered");

      // 1. Blocked: Anonymous board, Pencil tool, not validated
      let broadcastCalled = false;
      socket.broadcast.to = () => ({
        emit: () => {
          broadcastCalled = true;
        },
      });

      await broadcastHandler({
        tool: Pencil.id,
        type: MutationType.CREATE,
        id: "l1",
        color: "#123456",
        size: 4,
      });
      assert.strictEqual(
        broadcastCalled,
        false,
        "Should block unvalidated broadcast on anonymous board",
      );

      // 2. Allowed: Cursor tool, not validated
      // (This verifies the shared logic integration in the socket handler)
      await broadcastHandler({
        tool: Cursor.id,
        type: MutationType.UPDATE,
        x: 10,
        y: 20,
      });

      // 3. Allowed: Pencil tool, AFTER validation
      socket.turnstileValidatedUntil = 1000;
      await withMockedNow(500, async () => {
        await broadcastHandler({
          tool: Pencil.id,
          type: MutationType.CREATE,
          id: "l2",
          color: "#123456",
          size: 4,
        });
      });
      assert.equal(
        socket.rooms.has("anonymous"),
        true,
        "Should advance to board handling before validation expiry",
      );

      socket.rooms.delete("anonymous");
      socket.turnstileValidatedUntil = 1000;
      await withMockedNow(1001, async () => {
        await broadcastHandler({
          tool: Pencil.id,
          type: MutationType.CREATE,
          id: "l3",
          color: "#123456",
          size: 4,
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

test("server-side Turnstile token validation binds Siteverify to request context", async () => {
  const historyDir = await createHistoryDir();
  await withEnv(
    {
      TURNSTILE_SECRET_KEY: "test-secret",
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_VALIDATION_WINDOW_MS: "120000",
      WBO_HISTORY_DIR: historyDir,
    },
    async () => {
      const config = await import(
        `${pathToFileURL(CONFIG_PATH).href}?cache-bust=${Date.now()}`
      );
      const sockets = await loadSockets();
      const { socket, handlers } = createSocket({
        headers: { host: "board.example" },
        remoteAddress: "203.0.113.10",
        query: { board: "anonymous" },
      });

      // Mock global fetch
      const originalFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = /** @type {any} */ (
        async function mockFetch(
          /** @type {string} */ url,
          /** @type {{body: URLSearchParams}} */ options,
        ) {
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
        }
      );

      try {
        await sockets.__test.handleSocketConnection(socket, sockets.__config);
        const tokenHandler = handlers.turnstile_token;
        assert.ok(tokenHandler, "turnstile_token handler should be registered");

        let ackCalledWith = null;
        await tokenHandler("valid-token", (/** @type {any} */ result) => {
          ackCalledWith = result;
        });
        assert.strictEqual(fetchCalled, true, "fetch should have been called");
        const expectedTime = Date.now() + config.TURNSTILE_VALIDATION_WINDOW_MS;
        assert.notEqual(socket.turnstileValidatedUntil, undefined);
        const validatedUntil = socket.turnstileValidatedUntil;
        assert.ok(
          validatedUntil !== undefined &&
            Math.abs(validatedUntil - expectedTime) <= 10,
          "socket validation should expire after the configured window",
        );
        assert.deepEqual(ackCalledWith, {
          success: true,
          validationWindowMs: config.TURNSTILE_VALIDATION_WINDOW_MS,
          validatedUntil: socket.turnstileValidatedUntil,
        });

        // Test failed validation
        globalThis.fetch = /** @type {any} */ (
          async function failedFetch(
            /** @type {string} */ _url,
            /** @type {{body: URLSearchParams}} */ _options,
          ) {
            return {
              json: async () => ({
                success: false,
                "error-codes": ["invalid-input-response"],
              }),
            };
          }
        );
        let failedAck = null;
        await tokenHandler("invalid-token", (/** @type {any} */ result) => {
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

test("server-side Turnstile token validation rejects hostname mismatches", async () => {
  const historyDir = await createHistoryDir();
  await withEnv(
    {
      TURNSTILE_SECRET_KEY: "test-secret",
      TURNSTILE_SITE_KEY: "test-site-key",
      WBO_HISTORY_DIR: historyDir,
    },
    async () => {
      const _config = require("../server/configuration.mjs");
      const sockets = await loadSockets();
      const { socket, handlers } = createSocket({
        headers: { host: "board.example:8080" },
        query: { board: "anonymous" },
      });

      const originalFetch = globalThis.fetch;
      try {
        await sockets.__test.handleSocketConnection(socket, sockets.__config);
        const tokenHandler = handlers.turnstile_token;
        assert.ok(tokenHandler);

        globalThis.fetch = /** @type {any} */ (
          async function hostnameMismatch() {
            return {
              json: async () => ({
                success: true,
                hostname: "other.example",
              }),
            };
          }
        );
        let hostnameMismatchAck = null;
        await tokenHandler("valid-token", (/** @type {any} */ result) => {
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
