const test = require("node:test");
const assert = require("node:assert/strict");

const { WriteModule } = require("../client-data/js/board_write_module.js");

/** @typedef {import("../types/app-runtime").RateLimitKind} RateLimitKind */
/** @typedef {{now: number}} NowRef */
/** @typedef {{callback: () => void, delayMs: number, timerId: number}} ScheduledTimer */

/** @param {NowRef} nowRef */
function installTimerHarness(nowRef) {
  const originalDateNow = Date.now;
  const globalAny = /** @type {any} */ (global);
  const originalWindow = globalAny.window;
  const originalClearTimeout = globalAny.clearTimeout;
  /** @type {ScheduledTimer[]} */
  const scheduledTimers = [];

  Date.now = () => nowRef.now;
  globalAny.window = {
    /**
     * @param {() => void} callback
     * @param {number} delayMs
     */
    setTimeout(callback, delayMs) {
      const timerId = scheduledTimers.length + 1;
      scheduledTimers.push({ callback, delayMs, timerId });
      return timerId;
    },
  };
  globalAny.clearTimeout = () => {};

  return {
    scheduledTimers,
    restore() {
      Date.now = originalDateNow;
      if (originalWindow === undefined) {
        delete globalAny.window;
      } else {
        globalAny.window = originalWindow;
      }
      globalAny.clearTimeout = originalClearTimeout;
    },
  };
}

function createWriteRuntime() {
  /** @type {Array<{id?: string}>} */
  const emittedMessages = [];
  /** @type {Array<{id?: string}>} */
  const redrawnMessages = [];
  /** @type {any} */
  const tools = {
    connection: {
      socket: {
        connected: true,
        /**
         * @param {string} _eventName
         * @param {{id?: string}} message
         */
        emit(_eventName, message) {
          emittedMessages.push(message);
        },
      },
    },
    replay: {
      awaitingSnapshot: false,
    },
    rateLimits: {
      getBufferedWriteCosts() {
        return {
          general: 0,
          constructive: 1,
          destructive: 0,
          text: 0,
        };
      },
      /** @param {RateLimitKind} kind */
      getEffectiveRateLimit(kind) {
        if (kind === "constructive") {
          return { limit: 1, periodMs: 1_000 };
        }
        return { limit: 0, periodMs: 0 };
      },
    },
    presence: {
      updateCurrentConnectedUserFromActivity() {},
    },
    status: {
      syncWriteStatusIndicator() {},
    },
    optimistic: {
      captureRollback() {
        return { kind: "items", snapshots: [] };
      },
      trackMutation() {},
    },
    toolRegistry: {
      mounted: {
        rectangle: {
          /** @param {{id?: string}} message */
          draw(message) {
            redrawnMessages.push(message);
          },
        },
      },
    },
  };
  const writes = new WriteModule(() => tools);
  tools.writes = writes;
  return { emittedMessages, redrawnMessages, writes };
}

/** @param {{scheduledTimers: ScheduledTimer[]}} timerHarness */
function runLatestTimerCallback(timerHarness) {
  const latestTimer =
    timerHarness.scheduledTimers[timerHarness.scheduledTimers.length - 1];
  assert.ok(latestTimer);
  latestTimer.callback();
}

/**
 * @param {{scheduledTimers: ScheduledTimer[]}} timerHarness
 * @param {number} index
 * @returns {ScheduledTimer}
 */
function getScheduledTimer(timerHarness, index) {
  const timer = timerHarness.scheduledTimers[index];
  assert.ok(timer);
  return timer;
}

test("WriteModule keeps direct pumps inside the buffered-write safety window", () => {
  const nowRef = { now: 1_000 };
  const timerHarness = installTimerHarness(nowRef);
  try {
    const runtime = createWriteRuntime();

    assert.equal(
      runtime.writes.sendBufferedWrite({ tool: 3, id: "first" }),
      true,
    );
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["first"],
    );

    assert.equal(
      runtime.writes.sendBufferedWrite({ tool: 3, id: "second" }),
      true,
    );
    assert.equal(runtime.writes.bufferedWrites.length, 1);
    assert.equal(timerHarness.scheduledTimers.length, 1);
    assert.equal(getScheduledTimer(timerHarness, 0).delayMs, 2_000);

    nowRef.now = 1_500;
    runtime.writes.pumpBufferedWrites();
    assert.equal(runtime.writes.bufferedWrites.length, 1);
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["first"],
    );
    assert.equal(timerHarness.scheduledTimers.length, 2);
    assert.equal(getScheduledTimer(timerHarness, 1).delayMs, 1_500);

    nowRef.now = 2_500;
    runLatestTimerCallback(timerHarness);
    assert.equal(runtime.writes.bufferedWrites.length, 1);
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["first"],
    );
    assert.equal(timerHarness.scheduledTimers.length, 3);
    assert.equal(getScheduledTimer(timerHarness, 2).delayMs, 500);

    nowRef.now = 3_000;
    runLatestTimerCallback(timerHarness);
    assert.equal(runtime.writes.bufferedWrites.length, 0);
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["first", "second"],
    );
    assert.equal(runtime.writes.bufferedWriteTimer, null);
    assert.equal(runtime.writes.localRateLimitedUntil, 0);
  } finally {
    timerHarness.restore();
  }
});

test("WriteModule keeps persistent writes buffered until authoritative ack", () => {
  const nowRef = { now: 1_000 };
  const timerHarness = installTimerHarness(nowRef);
  try {
    const runtime = createWriteRuntime();

    assert.equal(
      runtime.writes.sendBufferedWrite({
        tool: 3,
        id: "persistent",
        clientMutationId: "cm-persistent",
      }),
      true,
    );

    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["persistent"],
    );
    assert.equal(runtime.writes.bufferedWrites.length, 1);
    assert.equal(runtime.writes.bufferedWrites[0]?.state, "inflight");

    runtime.writes.resolveBufferedWrite("cm-persistent");
    assert.equal(runtime.writes.bufferedWrites.length, 0);
  } finally {
    timerHarness.restore();
  }
});

test("WriteModule preserves rate-limited writes through authoritative resync", () => {
  const nowRef = { now: 1_000 };
  const timerHarness = installTimerHarness(nowRef);
  try {
    const runtime = createWriteRuntime();

    assert.equal(
      runtime.writes.sendBufferedWrite({
        tool: 3,
        id: "retry-after-rate-limit",
        clientMutationId: "cm-rate-limited",
      }),
      true,
    );
    assert.equal(runtime.writes.bufferedWrites[0]?.state, "inflight");

    runtime.writes.deferBufferedWritesUntil(4_000, true);
    assert.equal(runtime.writes.bufferedWrites.length, 1);
    assert.equal(runtime.writes.bufferedWrites[0]?.state, "queued");
    assert.equal(runtime.writes.bufferedWrites[0]?.redrawOnSend, true);

    nowRef.now = 3_000;
    runtime.writes.pumpBufferedWrites();
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["retry-after-rate-limit"],
    );

    nowRef.now = 4_000;
    runtime.writes.pumpBufferedWrites();
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["retry-after-rate-limit", "retry-after-rate-limit"],
    );
    assert.deepEqual(
      runtime.redrawnMessages.map((message) => message.id),
      ["retry-after-rate-limit"],
    );
    assert.equal(runtime.writes.bufferedWrites[0]?.state, "inflight");

    runtime.writes.resolveBufferedWrite("cm-rate-limited");
    assert.equal(runtime.writes.bufferedWrites.length, 0);
  } finally {
    timerHarness.restore();
  }
});
