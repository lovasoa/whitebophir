const test = require("node:test");
const assert = require("node:assert/strict");

const { WriteModule } = require("../client-data/js/board_write_module.js");

function installTimerHarness(nowRef) {
  const originalDateNow = Date.now;
  const originalWindow = global.window;
  const originalClearTimeout = global.clearTimeout;
  const scheduledTimers = [];

  Date.now = () => nowRef.now;
  global.window = {
    setTimeout(callback, delayMs) {
      const timerId = scheduledTimers.length + 1;
      scheduledTimers.push({ callback, delayMs, timerId });
      return timerId;
    },
  };
  global.clearTimeout = () => {};

  return {
    scheduledTimers,
    restore() {
      Date.now = originalDateNow;
      if (originalWindow === undefined) {
        delete global.window;
      } else {
        global.window = originalWindow;
      }
      global.clearTimeout = originalClearTimeout;
    },
  };
}

function createWriteRuntime() {
  const emittedMessages = [];
  const tools = {
    connection: {
      socket: {
        connected: true,
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
  };
  const writes = new WriteModule(() => tools);
  tools.writes = writes;
  return { emittedMessages, writes };
}

test("WriteModule reschedules an early buffered-write timer callback", () => {
  const nowRef = { now: 1_000 };
  const timerHarness = installTimerHarness(nowRef);
  try {
    const runtime = createWriteRuntime();

    assert.equal(runtime.writes.sendBufferedWrite({ id: "first" }), true);
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["first"],
    );

    assert.equal(runtime.writes.sendBufferedWrite({ id: "second" }), true);
    assert.equal(runtime.writes.bufferedWrites.length, 1);
    assert.equal(timerHarness.scheduledTimers.length, 1);

    nowRef.now = 1_500;
    timerHarness.scheduledTimers[0].callback();
    assert.equal(runtime.writes.bufferedWrites.length, 1);
    assert.deepEqual(
      runtime.emittedMessages.map((message) => message.id),
      ["first"],
    );
    assert.equal(timerHarness.scheduledTimers.length, 2);

    nowRef.now = 2_500;
    timerHarness.scheduledTimers[1].callback();
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
