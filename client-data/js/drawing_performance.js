/**
 * Opt-in, vendor-neutral ink feedback timing. Times are rendering opportunities,
 * not measurements of physical display latency. No input points are retained.
 */

/** @typedef {import("../../types/app-runtime").DrawingPerformanceSummary} DrawingPerformanceSummary */
/** @typedef {(summary: Readonly<DrawingPerformanceSummary>) => void} DrawingPerformanceListener */
/** @typedef {(x: number, y: number, time: number) => void} DrawingInput */

const listeners = new Set(/** @type {DrawingPerformanceListener[]} */ ([]));
const strokes = new Set(/** @type {DrawingPerformance[]} */ ([]));
const jobs = new Map(/** @type {[number, DrawingPerformance][]} */ ([]));
let nextJob = 0;
let channel = /** @type {MessageChannel | null} */ (null);
let pointerType = "mouse",
  pointerId = -1,
  pointerTime = -Infinity;

/** @param {PointerEvent} event */
function pointerDown(event) {
  pointerType = event.pointerType;
  pointerId = event.pointerId;
  pointerTime = event.timeStamp;
}
function hidden() {
  if (document.visibilityState === "hidden") {
    for (const stroke of strokes) stroke.finish("hidden", true);
  }
}

/** Collection and browser listeners exist only while someone subscribes.
 * @param {DrawingPerformanceListener} listener
 */
export function observeDrawingPerformance(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("pointerdown", pointerDown, {
      passive: true,
      capture: true,
    });
    document.addEventListener("visibilitychange", hidden);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    document.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("visibilitychange", hidden);
    for (const stroke of strokes) stroke.dispose();
    channel?.port1.close();
    channel?.port2.close();
    channel = null;
    pointerTime = -Infinity;
  };
}

/** Tools provide their existing coordinate conversion and constraints. Returning
 * null before allocation keeps unsubscribed deployments off the timing path.
 * @param {string} toolId
 * @param {MouseEvent | TouchEvent} event
 * @param {number} x
 * @param {number} y
 * @param {DrawingInput} sample
 * @param {number} [pointIntervalMs]
 */
export function beginDrawingPerformance(
  toolId,
  event,
  x,
  y,
  sample,
  pointIntervalMs,
) {
  if (!listeners.size) return null;
  return new DrawingPerformance(toolId, event, x, y, sample, pointIntervalMs);
}

class DrawingPerformance {
  /** @param {string} toolId @param {MouseEvent | TouchEvent} event
   * @param {number} x @param {number} y @param {DrawingInput} sample
   * @param {number | undefined} pointIntervalMs */
  constructor(toolId, event, x, y, sample, pointIntervalMs) {
    this.toolId = toolId;
    this.pointIntervalMs = pointIntervalMs;
    this.sample = sample;
    this.start = performance.now();
    this.end = this.start;
    this.inputType =
      Math.abs(event.timeStamp - pointerTime) < 50
        ? pointerType
        : "touches" in event
          ? "touch"
          : "mouse";
    this.pointerId =
      Math.abs(event.timeStamp - pointerTime) < 50 ? pointerId : -1;
    this.inputTiming = "event";
    this.x = x;
    this.y = y;
    this.lastInput = this.start;
    this.sequence = 0;
    this.accepted = 0;
    this.written = 0;
    this.pending = NaN;
    this.afterAccepted = NaN;
    this.queued = NaN;
    this.waiting = NaN;
    this.max = 0;
    this.sum = 0;
    this.count = 0;
    this.unfinished = 0;
    this.moving = 0;
    this.fallbacks = 0;
    this.frame = 0;
    this.job = 0;
    this.reason = "";
    this.disposed = false;
    this.pointerMove = this.pointerMove.bind(this);
    this.pointerCancel = this.pointerCancel.bind(this);
    this.render = this.render.bind(this);
    this.fallback = this.fallback.bind(this);
    document.addEventListener("pointermove", this.pointerMove, {
      passive: true,
      capture: true,
    });
    document.addEventListener("pointercancel", this.pointerCancel, {
      passive: true,
      capture: true,
    });
    strokes.add(this);
  }

  /** @param {PointerEvent} event */
  pointerCancel(event) {
    if (this.pointerId === -1 || event.pointerId === this.pointerId)
      this.finish("cancel", true);
  }

  /** @param {PointerEvent} event */
  pointerMove(event) {
    if (
      this.reason ||
      (this.pointerId !== -1 && event.pointerId !== this.pointerId) ||
      !event.isPrimary ||
      !event.buttons
    )
      return;
    const samples = event.getCoalescedEvents?.();
    if (samples?.length) {
      this.inputTiming = "coalesced";
      for (const sample of samples)
        this.sample(sample.pageX, sample.pageY, sample.timeStamp);
    } else this.sample(event.pageX, event.pageY, event.timeStamp);
  }

  /** Effective tool coordinates, before any point throttle. Duplicate and
   * clamped positions do not create demand. Gaps close movement runs, including
   * gaps inside a coalesced batch; idle time must not inflate a frozen stroke.
   * @param {number} x @param {number} y @param {number} time */
  input(x, y, time) {
    if (this.disposed || this.reason || (x === this.x && y === this.y)) return;
    time = Math.max(this.lastInput, time);
    const gap = time - this.lastInput;
    if (gap > 50) {
      this.recordUnfinished();
      this.pending = this.afterAccepted = NaN;
    } else this.moving += gap;
    this.x = x;
    this.y = y;
    this.lastInput = time;
    this.sequence++;
    if (Number.isNaN(this.pending)) this.pending = time;
    if (Number.isNaN(this.afterAccepted)) this.afterAccepted = time;
  }

  /** Call only when geometry actually changes to represent current input. */
  accept() {
    this.accepted = this.sequence;
    this.afterAccepted = NaN;
  }

  /** A geometry write acknowledges only the accepted sequence, never newer raw
   * movement discarded by throttling. Coalesce writes before the next frame.
   * @param {boolean} [inAnimationFrame] */
  geometry(inAnimationFrame = false) {
    if (this.disposed || this.accepted === this.written) return;
    this.written = this.accepted;
    if (!Number.isNaN(this.pending)) {
      if (Number.isNaN(this.queued)) this.queued = this.pending;
      this.pending = this.afterAccepted;
    }
    if (this.frame || this.job || Number.isNaN(this.queued)) return;
    if (inAnimationFrame) this.render();
    else this.frame = requestAnimationFrame(this.render);
  }

  render() {
    this.frame = 0;
    this.waiting = this.queued;
    this.queued = NaN;
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = (event) =>
        jobs.get(event.data)?.acknowledge(false);
    }
    this.job = ++nextJob;
    jobs.set(this.job, this);
    // A message normally follows paint; a next-frame fallback bounds task
    // starvation under sustained main-thread load. Both reuse bound callbacks.
    channel.port2.postMessage(this.job);
    this.frame = requestAnimationFrame(this.fallback);
  }
  fallback() {
    this.acknowledge(true);
  }

  /** @param {boolean} fallback */
  acknowledge(fallback) {
    if (this.disposed) return;
    jobs.delete(this.job);
    this.job = 0;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const wait = Math.max(0, performance.now() - this.waiting);
    this.max = Math.max(this.max, wait);
    this.sum += wait;
    this.count++;
    if (fallback) this.fallbacks++;
    this.waiting = NaN;
    if (!Number.isNaN(this.queued))
      this.frame = requestAnimationFrame(this.render);
    else if (this.reason) this.publish();
  }

  recordUnfinished() {
    if (!Number.isNaN(this.pending))
      this.unfinished = Math.max(
        this.unfinished,
        this.lastInput - this.pending,
      );
  }

  /** Release waits for its final geometry's rendering opportunity. Interruptions
   * cancel callbacks immediately and retain the portion already observed.
   * @param {string} reason @param {boolean} [interrupt] */
  finish(reason, interrupt = false) {
    if (this.disposed) return;
    if (this.reason && !interrupt) return;
    this.reason = reason;
    this.end = performance.now();
    document.removeEventListener("pointermove", this.pointerMove, true);
    document.removeEventListener("pointercancel", this.pointerCancel, true);
    this.recordUnfinished();
    if (interrupt) {
      for (const since of [this.queued, this.waiting]) {
        if (!Number.isNaN(since))
          this.unfinished = Math.max(this.unfinished, this.lastInput - since);
      }
    }
    if (interrupt || (!this.frame && !this.job)) this.publish();
  }

  publish() {
    /** @type {DrawingPerformanceSummary} */
    const summary = {
      measurementVersion: 1,
      toolId: this.toolId,
      inputType: this.inputType,
      inputTiming: this.inputTiming,
      maxFeedbackWaitMs: Math.max(this.max, this.unfinished),
      ...(this.count ? { meanFeedbackWaitMs: this.sum / this.count } : {}),
      feedbackCount: this.count,
      unfinishedWaitMs: this.unfinished,
      movingDurationMs: this.moving,
      strokeDurationMs: this.end - this.start,
      renderFallbackCount: this.fallbacks,
      terminationReason: this.reason,
      ...(this.pointIntervalMs === undefined
        ? {}
        : { pointIntervalMs: this.pointIntervalMs }),
    };
    this.dispose();
    if (!this.sequence) return;
    Object.freeze(summary);
    for (const listener of listeners) {
      try {
        listener(summary);
      } catch {
        /* Observers cannot interrupt drawing. */
      }
    }
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener("pointermove", this.pointerMove, true);
    document.removeEventListener("pointercancel", this.pointerCancel, true);
    cancelAnimationFrame(this.frame);
    jobs.delete(this.job);
    strokes.delete(this);
  }
}
