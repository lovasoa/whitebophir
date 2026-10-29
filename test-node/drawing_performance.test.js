const assert = require("node:assert/strict");
const test = require("node:test");
const {
  beginDrawingPerformance,
  observeDrawingPerformance,
} = require("../client-data/js/drawing_performance.js");

// Drive native timing boundaries deterministically, without a production clock
// abstraction or reset API. Every test unsubscribes and restores the globals.
/** @typedef {NonNullable<ReturnType<typeof beginDrawingPerformance>>} Stroke */
/** @typedef {{summaries: import("../types/app-runtime").DrawingPerformanceSummary[], frames: Map<number, () => void>, handlers: Map<string, Set<Function>>, at(time: number): void, frame(time: number): void, message(time: number): void, stroke(pressedAt?: number): Stroke, unsubscribe(): void}} TestEnvironment */
/** @param {(environment: TestEnvironment) => void} run */
function harness(run) {
  const names = [
    "document",
    "performance",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "MessageChannel",
  ];
  const saved = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  let now = 0,
    nextFrame = 0;
  const frames = new Map(/** @type {[number, () => void][]} */ ([]));
  const handlers = new Map(/** @type {[string, Set<Function>][]} */ ([]));
  const messages = /** @type {(() => void)[]} */ ([]);
  const summaries =
    /** @type {import("../types/app-runtime").DrawingPerformanceSummary[]} */ ([]);
  const globals = {
    document: {
      visibilityState: "visible",
      documentElement: { dataset: /** @type {Record<string, string>} */ ({}) },
      /** @param {string} name @param {Function} fn */
      addEventListener: (name, fn) => {
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name)?.add(fn);
      },
      /** @param {string} name @param {Function} fn */
      removeEventListener: (name, fn) => handlers.get(name)?.delete(fn),
    },
    performance: { now: () => now, timeOrigin: 1700000000000 },
    /** @param {() => void} fn */
    requestAnimationFrame: (fn) => {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    /** @param {number} id */
    cancelAnimationFrame: (id) => frames.delete(id),
    MessageChannel: class {
      port1 = {
        onmessage: /** @type {((event: {data: number}) => void) | null} */ (
          null
        ),
        close() {},
      };
      port2 = {
        /** @param {number} data */
        postMessage: (data) =>
          messages.push(() => this.port1.onmessage?.({ data })),
        close() {},
      };
    },
  };
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: /** @type {Record<string, unknown>} */ (globals)[name],
    });
  const unsubscribe = observeDrawingPerformance((summary) =>
    summaries.push(summary),
  );
  /** @type {TestEnvironment} */
  const env = {
    summaries,
    frames,
    handlers,
    at: (time) => {
      now = time;
    },
    frame: (time) => {
      now = time;
      const batch = [...frames.values()];
      frames.clear();
      for (const fn of batch) fn();
    },
    message: (time) => {
      now = time;
      messages.shift()?.();
    },
    stroke: (pressedAt = now) => {
      const stroke = beginDrawingPerformance(
        "pencil",
        /** @type {MouseEvent} */ ({ timeStamp: pressedAt }),
        0,
        0,
        (x, y, t, received) => stroke?.input(x, y, t, received),
        20,
      );
      assert.ok(stroke);
      return stroke;
    },
    unsubscribe,
  };
  try {
    run(env);
  } finally {
    delete globals.document.documentElement.dataset.wboPerformance;
    unsubscribe();
    names.forEach((name, i) => {
      const descriptor = saved[i];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

test("geometry retains newer throttled movement, including a stale final commit", () =>
  harness((e) => {
    const s = e.stroke();
    s.input(1, 0, 10);
    s.accept();
    s.input(2, 0, 20);
    s.geometry(true);
    e.message(30);
    s.input(3, 0, 40);
    s.geometry(); // Commit of the old accepted geometry cannot clear raw input.
    e.at(45);
    s.finish("release");
    assert.equal(e.summaries.length, 1);
    assert.equal(e.summaries[0]?.meanFeedbackWaitMs, 20);
    assert.equal(e.summaries[0]?.unfinishedWaitMs, 20);
    assert.equal(e.summaries[0]?.maxFeedbackWaitMs, 20);
    assert.equal(e.summaries[0]?.maxFeedbackWaitStartTimeMs, 1700000000010);
    assert.equal(e.summaries[0]?.inputSampleCount, 3);
    assert.equal(e.frames.size, 0);
  }));

test("coalesced histories preserve queued movement and idle/resume boundaries", () =>
  harness((e) => {
    const s = e.stroke();
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 700, 710];
    e.at(720);
    const pointer = [...(e.handlers.get("pointermove") ?? [])][0];
    assert.ok(pointer);
    pointer({
      isPrimary: true,
      buttons: 1,
      pointerId: 1,
      getCoalescedEvents: () =>
        samples.map((t) => ({ pageX: t, pageY: 0, timeStamp: t })),
    });
    s.finish("cancel", true);
    assert.equal(e.summaries[0]?.inputTiming, "coalesced");
    assert.equal(e.summaries[0]?.unfinishedWaitMs, 90);
    assert.equal(e.summaries[0]?.maxFeedbackWaitStartTimeMs, 1700000000010);
    assert.equal(e.summaries[0]?.inputSampleCount, samples.length);
    assert.equal(e.summaries[0]?.maxInputQueueDelayMs, 710);
    assert.equal(e.summaries[0]?.movingDurationMs, 110);
    assert.equal(e.summaries[0]?.feedbackCount, 0);
    assert.equal("meanFeedbackWaitMs" in (e.summaries[0] ?? {}), false);
  }));

test("merged geometry writes use one callback; fallback wins a starved message", () =>
  harness((e) => {
    const s = e.stroke();
    for (let t = 1; t <= 10; t++) {
      e.at(t);
      s.input(t, 0, t);
      s.accept();
      s.geometry();
    }
    assert.equal(e.frames.size, 1);
    e.frame(16);
    e.at(20);
    s.input(11, 0, 20);
    s.accept();
    s.geometry();
    e.frame(32); // First batch falls back, second batch remains separate.
    e.message(33); // Stale task cannot acknowledge the newer batch.
    e.frame(48);
    e.message(50);
    e.at(51);
    s.finish("release");
    assert.equal(e.summaries[0]?.feedbackCount, 2);
    assert.equal(e.summaries[0]?.renderFallbackCount, 1);
    assert.equal(e.summaries[0]?.maxFeedbackWaitMs, 31);
    assert.equal(e.summaries[0]?.maxFeedbackInputQueueMs, 0);
    assert.equal(e.summaries[0]?.maxFeedbackBeforeGeometryMs, 0);
    assert.equal(e.summaries[0]?.maxFeedbackAfterGeometryMs, 31);
  }));

test("unfinished freezes exclude deliberate holds and survive interruptions", () =>
  harness((e) => {
    const s = e.stroke();
    for (let t = 10; t <= 310; t += 10) s.input(t, 0, t);
    e.at(1000);
    s.input(310, 0, 1000); // Stationary input changes nothing.
    s.finish("disconnect", true);
    assert.equal(e.summaries[0]?.maxFeedbackWaitMs, 300);
    assert.equal(e.summaries[0]?.terminationReason, "disconnect");
    assert.ok(Object.isFrozen(e.summaries[0]));
  }));

test("release waits for final render; successive strokes and exceptions stay isolated", () =>
  harness((e) => {
    document.documentElement.dataset.wboPerformance = "true";
    let measureAttempts = 0;
    Object.assign(performance, {
      clearMeasures() {},
      measure() {
        measureAttempts++;
        throw Error("unsupported User Timing options");
      },
    });
    const removeThrower = observeDrawingPerformance(() => {
      throw Error("observer");
    });
    const first = e.stroke();
    first.input(1, 0, 10);
    first.accept();
    first.geometry();
    e.at(11);
    first.finish("release");
    const second = e.stroke();
    second.input(2, 0, 12);
    second.finish("cancel", true);
    e.frame(16);
    e.message(20);
    assert.equal(e.summaries.length, 2);
    assert.equal(measureAttempts, 2);
    assert.equal(e.summaries[1]?.meanFeedbackWaitMs, 10);
    assert.equal(
      e.summaries[1]?.strokeStartTimeMs + e.summaries[1]?.strokeDurationMs,
      1700000000011,
    );
    removeThrower();
  }));

test("unsubscription cancels work, and unsubscribed or stationary strokes do no work", () =>
  harness((e) => {
    const s = e.stroke();
    s.input(0, 0, 10);
    s.finish("release");
    assert.deepEqual(e.summaries, []);
    const moving = e.stroke();
    moving.input(1, 0, 10);
    moving.accept();
    moving.geometry();
    e.unsubscribe();
    assert.equal(e.frames.size, 0);
    const off = beginDrawingPerformance(
      "pencil",
      /** @type {MouseEvent} */ ({ timeStamp: 0 }),
      0,
      0,
      () => assert.fail(),
    );
    assert.equal(off, null);
    assert.equal(
      [...e.handlers.values()].some((set) => set.size),
      false,
    );
    e.frame(20);
    e.message(30);
    assert.deepEqual(e.summaries, []);
  }));

test("visibility interruption drains a stroke awaiting its final render", () =>
  harness((e) => {
    const s = e.stroke();
    s.input(1, 0, 10);
    s.accept();
    s.geometry();
    e.at(15);
    s.finish("release");
    Object.defineProperty(document, "visibilityState", { value: "hidden" });
    for (const callback of e.handlers.get("visibilitychange") ?? []) callback();
    assert.equal(e.frames.size, 0);
    assert.equal(e.summaries.length, 1);
    assert.equal(e.summaries[0]?.terminationReason, "hidden");
    e.frame(20);
    e.message(30);
    assert.equal(e.summaries.length, 1);
  }));

test("queued pointer-down preserves the original timestamps of subsequent movement", () =>
  harness((e) => {
    e.at(300);
    const s = e.stroke(0);
    for (let t = 10; t <= 290; t += 10) s.input(t, 0, t);
    s.accept();
    s.geometry(true);
    e.message(310);
    e.at(320);
    s.finish("release");
    assert.equal(e.summaries[0]?.maxFeedbackWaitMs, 300);
    assert.equal(e.summaries[0]?.movingDurationMs, 290);
    assert.equal(e.summaries[0]?.strokeDurationMs, 320);
    assert.equal(e.summaries[0]?.maxInputQueueDelayMs, 300);
    assert.equal(e.summaries[0]?.strokeStartTimeMs, 1700000000000);
  }));

test("worst feedback breakdown follows the oldest input represented by a queued write", () =>
  harness((e) => {
    const s = e.stroke();
    s.input(1, 0, 10, 40);
    e.at(50);
    s.accept();
    e.at(60);
    s.geometry();
    e.frame(70);
    s.input(2, 0, 71, 80);
    e.at(90);
    s.accept();
    e.at(100);
    s.geometry();
    s.input(3, 0, 101, 105);
    e.at(110);
    s.accept();
    e.at(120);
    s.geometry();
    e.message(130);
    e.frame(140);
    e.message(250);
    e.at(260);
    s.finish("release");
    const summary = e.summaries[0];
    assert.equal(summary?.maxFeedbackWaitMs, 179);
    assert.equal(summary?.maxFeedbackInputQueueMs, 9);
    assert.equal(summary?.maxFeedbackBeforeGeometryMs, 20);
    assert.equal(summary?.maxFeedbackAfterGeometryMs, 150);
    assert.equal(summary?.acceptedUpdateCount, 3);
    assert.equal(summary?.geometryWriteCount, 3);
  }));

test("unfinished feedback does not inherit the breakdown of an earlier painted update", () =>
  harness((e) => {
    const s = e.stroke();
    s.input(1, 0, 10, 20);
    e.at(30);
    s.accept();
    e.at(40);
    s.geometry();
    e.frame(50);
    e.message(60);
    for (let t = 100; t <= 300; t += 10) s.input(t, 0, t);
    e.at(310);
    s.finish("cancel", true);
    const summary = e.summaries[0];
    assert.equal(summary?.maxFeedbackWaitMs, 200);
    assert.equal("maxFeedbackInputQueueMs" in (summary ?? {}), false);
    assert.equal("maxFeedbackBeforeGeometryMs" in (summary ?? {}), false);
    assert.equal("maxFeedbackAfterGeometryMs" in (summary ?? {}), false);
    assert.equal(summary?.acceptedUpdateCount, 1);
    assert.equal(summary?.geometryWriteCount, 1);
  }));
