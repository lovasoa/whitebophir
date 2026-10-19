/**
 * Opt-in, vendor-neutral ink feedback timing. Times are rendering opportunities,
 * not measurements of physical display latency. No input points are retained.
 */

/** @typedef {import("../../types/app-runtime").DrawingPerformanceSummary} DrawingPerformanceSummary */
/** @typedef {(summary: Readonly<DrawingPerformanceSummary>) => void} DrawingPerformanceListener */
/** @typedef {(x: number, y: number, time: number, received: number) => void} DrawingInput */

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
    // Pointer-down can itself have waited in the browser input queue.
    const now = performance.now();
    this.start = Math.min(event.timeStamp, now);
    this.inputDelay = now - this.start;
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
    this.pendingReceived = NaN;
    this.afterAccepted = NaN;
    this.afterAcceptedReceived = NaN;
    this.queued = NaN;
    this.queuedReceived = NaN;
    this.queuedGeometry = NaN;
    this.waiting = NaN;
    this.waitingReceived = NaN;
    this.waitingGeometry = NaN;
    this.max = 0;
    this.maxSince = this.start;
    this.maxInputQueue = 0;
    this.maxBeforeGeometry = 0;
    this.maxAfterGeometry = 0;
    this.acceptedUpdateCount = 0;
    this.geometryWriteCount = 0;
    this.sum = 0;
    this.count = 0;
    this.unfinished = 0;
    this.unfinishedSince = this.start;
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
    const received = performance.now();
    if (samples?.length) {
      this.inputTiming = "coalesced";
      for (const sample of samples)
        this.sample(sample.pageX, sample.pageY, sample.timeStamp, received);
    } else this.sample(event.pageX, event.pageY, event.timeStamp, received);
  }

  /** Effective tool coordinates, before any point throttle. Duplicate and
   * clamped positions do not create demand. Gaps close movement runs, including
   * gaps inside a coalesced batch; idle time must not inflate a frozen stroke.
   * @param {number} x @param {number} y @param {number} time
   * @param {number} [received] */
  input(x, y, time, received = time) {
    if (this.disposed || this.reason || (x === this.x && y === this.y)) return;
    this.inputDelay = Math.max(this.inputDelay, received - time);
    time = Math.max(this.lastInput, time);
    const gap = time - this.lastInput;
    if (gap > 50) {
      this.recordUnfinished();
      this.pending = this.afterAccepted = NaN;
      this.pendingReceived = this.afterAcceptedReceived = NaN;
    } else this.moving += gap;
    this.x = x;
    this.y = y;
    this.lastInput = time;
    this.sequence++;
    if (Number.isNaN(this.pending)) {
      this.pending = time;
      this.pendingReceived = received;
    }
    if (Number.isNaN(this.afterAccepted)) {
      this.afterAccepted = time;
      this.afterAcceptedReceived = received;
    }
  }

  /** Call only when geometry actually changes to represent current input. */
  accept() {
    this.accepted = this.sequence;
    this.afterAccepted = NaN;
    this.afterAcceptedReceived = NaN;
    this.acceptedUpdateCount++;
  }

  /** A geometry write acknowledges only the accepted sequence, never newer raw
   * movement discarded by throttling. Coalesce writes before the next frame.
   * @param {boolean} [inAnimationFrame] */
  geometry(inAnimationFrame = false) {
    if (this.disposed || this.accepted === this.written) return;
    this.written = this.accepted;
    this.geometryWriteCount++;
    if (!Number.isNaN(this.pending)) {
      if (Number.isNaN(this.queued)) {
        this.queued = this.pending;
        this.queuedReceived = this.pendingReceived;
        this.queuedGeometry = performance.now();
      }
      this.pending = this.afterAccepted;
      this.pendingReceived = this.afterAcceptedReceived;
    }
    if (this.frame || this.job || Number.isNaN(this.queued)) return;
    if (inAnimationFrame) this.render();
    else this.frame = requestAnimationFrame(this.render);
  }

  render() {
    this.frame = 0;
    this.waiting = this.queued;
    this.waitingReceived = this.queuedReceived;
    this.waitingGeometry = this.queuedGeometry;
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
    const now = performance.now();
    const wait = Math.max(0, now - this.waiting);
    if (wait > this.max) {
      this.max = wait;
      this.maxSince = this.waiting;
      // Keep stages from this same interval. Independent maxima cannot explain
      // an individual stall, and replacing queued geometry must not reset age.
      this.maxInputQueue = Math.max(0, this.waitingReceived - this.waiting);
      this.maxBeforeGeometry = Math.max(
        0,
        this.waitingGeometry - this.waitingReceived,
      );
      this.maxAfterGeometry = Math.max(0, now - this.waitingGeometry);
    }
    this.sum += wait;
    this.count++;
    if (fallback) this.fallbacks++;
    this.waiting = NaN;
    if (!Number.isNaN(this.queued))
      this.frame = requestAnimationFrame(this.render);
    else if (this.reason) this.publish();
  }

  /** @param {number} [since] */
  recordUnfinished(since = this.pending) {
    const wait = this.lastInput - since;
    if (wait > this.unfinished) {
      this.unfinished = wait;
      this.unfinishedSince = since;
    }
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
      this.recordUnfinished(this.queued);
      this.recordUnfinished(this.waiting);
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
      strokeStartTimeMs: performance.timeOrigin + this.start,
      maxFeedbackWaitMs: Math.max(this.max, this.unfinished),
      // Epoch milliseconds locate the worst interval beside browser long tasks.
      maxFeedbackWaitStartTimeMs:
        performance.timeOrigin +
        (this.unfinished > this.max ? this.unfinishedSince : this.maxSince),
      ...(this.count ? { meanFeedbackWaitMs: this.sum / this.count } : {}),
      // Unfinished demand has no observed write/render boundary to attribute.
      ...(this.count && this.max >= this.unfinished
        ? {
            maxFeedbackInputQueueMs: this.maxInputQueue,
            maxFeedbackBeforeGeometryMs: this.maxBeforeGeometry,
            maxFeedbackAfterGeometryMs: this.maxAfterGeometry,
          }
        : {}),
      feedbackCount: this.count,
      inputSampleCount: this.sequence,
      acceptedUpdateCount: this.acceptedUpdateCount,
      geometryWriteCount: this.geometryWriteCount,
      maxInputQueueDelayMs: this.inputDelay,
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
