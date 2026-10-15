const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const snippet = fs.readFileSync(
  path.join(__dirname, "../examples/datadog-head.html"),
  "utf8",
);
const script = snippet.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);

/**
 * @param {{hardwareConcurrency?: number, deviceMemory?: number}} hardware
 * @param {string} [phase]
 */
function runSnippet(hardware, phase = "connecting") {
  const state = {
    configuration: /** @type {Record<string, unknown>} */ ({}),
    starts: 0,
    stops: 0,
    timers: /** @type {{callback: () => void, delay: number}[]} */ ([]),
  };
  const listeners = new Set(/** @type {(() => void)[]} */ ([]));
  const root = { dataset: { boardPhase: phase } };
  const context = {
    navigator: hardware,
    window: {
      DD_RUM: {
        /** @param {() => void} callback */
        onReady(callback) {
          callback();
        },
        /** @param {Record<string, unknown>} configuration */
        init(configuration) {
          state.configuration = configuration;
        },
        /** @param {unknown[]} args */
        startSessionReplayRecording(...args) {
          // A forced start would bypass the SDK's low replay sample rate.
          assert.deepEqual(args, []);
          state.starts += 1;
        },
        stopSessionReplayRecording() {
          state.stops += 1;
        },
      },
      /** @param {() => void} callback @param {number} delay */
      setTimeout(callback, delay) {
        state.timers.push({ callback, delay });
      },
    },
    document: {
      documentElement: root,
      createElement() {
        return {};
      },
      getElementsByTagName() {
        return [{ parentNode: { insertBefore() {} } }];
      },
      /** @param {string} _type @param {() => void} callback */
      addEventListener(_type, callback) {
        listeners.add(callback);
      },
      /** @param {string} _type @param {() => void} callback */
      removeEventListener(_type, callback) {
        listeners.delete(callback);
      },
    },
  };
  vm.runInNewContext(/** @type {string} */ (script), context);
  return {
    state,
    /** @param {string} nextPhase */
    setPhase(nextPhase) {
      root.dataset.boardPhase = nextPhase;
      for (const callback of listeners) callback();
    },
  };
}

test("Datadog keeps ordinary RUM but never starts recording on weaker or unknown devices", () => {
  for (const hardware of [
    { hardwareConcurrency: 4, deviceMemory: 16 },
    { hardwareConcurrency: 16, deviceMemory: 4 },
    { hardwareConcurrency: 16 },
    { deviceMemory: 16 },
    {},
  ]) {
    const { state, setPhase } = runSnippet(hardware);
    setPhase("ready");
    assert.equal(state.configuration.sessionSampleRate, 20);
    assert.equal(state.configuration.sessionReplaySampleRate, 0);
    assert.equal(state.configuration.startSessionReplayRecordingManually, true);
    assert.equal(state.starts, 0);
    assert.equal(state.timers.length, 0);
  }
});

test("Datadog waits for a ready board and stops a sampled recording after one minute", () => {
  const { state, setPhase } = runSnippet({
    hardwareConcurrency: 8,
    deviceMemory: 8,
  });
  assert.equal(state.configuration.sessionReplaySampleRate, 0.1);
  assert.equal(state.configuration.startSessionReplayRecordingManually, true);
  setPhase("viewport-restored");
  setPhase("connecting");
  assert.equal(state.starts, 0);
  setPhase("ready");
  setPhase("ready");
  assert.equal(state.starts, 1);
  assert.equal(state.timers.length, 1);
  assert.equal(state.timers[0]?.delay, 60_000);
  state.timers[0]?.callback();
  assert.equal(state.stops, 1);
});

test("Datadog also handles an SDK loaded after the board is already ready", () => {
  const { state, setPhase } = runSnippet(
    { hardwareConcurrency: 16, deviceMemory: 16 },
    "ready",
  );
  assert.equal(state.starts, 1);
  setPhase("ready");
  assert.equal(state.starts, 1);
});
