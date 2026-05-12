const globalAny = /** @type {any} */ (global);

/**
 * @typedef {{
 *   callback: Function,
 *   dueAt: number,
 *   delay: number,
 *   args: any[],
 * }} HarnessTimer
 */

/** @param {unknown} value */
function toDelay(value) {
  const delay = Number(value);
  return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {Record<string, unknown>} slots
 * @returns {any}
 */
function createFrozenWindow(slots) {
  const windowObject = {};
  Object.defineProperties(
    windowObject,
    Object.fromEntries(
      Object.keys(slots).map((name) => [
        name,
        {
          enumerable: true,
          configurable: false,
          get() {
            return slots[name];
          },
          set() {
            throw new Error(
              `Use the browser harness API instead of assigning window.${name}`,
            );
          },
        },
      ]),
    ),
  );
  return Object.freeze(windowObject);
}

/**
 * Installs the browser globals used by client-side Node tests.
 *
 * The harness intentionally hides whether production code used timers or
 * animation frames. Tests should drive it through time/flush operations and
 * assert observable DOM or message behavior.
 *
 * @param {{now?: number, innerWidth?: number, innerHeight?: number, document?: any}} [options]
 */
function installBrowserHarness(options = {}) {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalAny,
    "window",
  );
  const previous = {
    document: globalAny.document,
    performance: globalAny.performance,
    setTimeout: globalAny.setTimeout,
    clearTimeout: globalAny.clearTimeout,
    requestAnimationFrame: globalAny.requestAnimationFrame,
    cancelAnimationFrame: globalAny.cancelAnimationFrame,
    innerWidth: globalAny.innerWidth,
    innerHeight: globalAny.innerHeight,
    Date: globalAny.Date,
    Tools: globalAny.Tools,
    SVGPathElement: globalAny.SVGPathElement,
    SVGGraphicsElement: globalAny.SVGGraphicsElement,
    SVGSVGElement: globalAny.SVGSVGElement,
    SVGGElement: globalAny.SVGGElement,
    SVGTextElement: globalAny.SVGTextElement,
    KeyboardEvent: globalAny.KeyboardEvent,
    SVGTransform: globalAny.SVGTransform,
  };
  let restored = false;
  let now = toFiniteNumber(options.now, 0);
  let nextAsyncId = 1;
  /** @type {Map<number, HarnessTimer>} */
  const timers = new Map();
  /** @type {Map<number, FrameRequestCallback>} */
  const animationFrames = new Map();
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();

  const documentElement = {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: options.innerWidth || 1024,
    clientHeight: options.innerHeight || 768,
  };

  let activeDocument =
    options.document ||
    /** @type {any} */ ({
      documentElement,
      scrollingElement: documentElement,
      createElement() {
        throw new Error("document.createElement is not configured");
      },
      createElementNS() {
        throw new Error("document.createElementNS is not configured");
      },
      getElementById() {
        return null;
      },
    });

  const performance = {
    now() {
      return now;
    },
  };

  /**
   * @param {string} name
   * @param {unknown} value
   */
  function setWindowSlot(name, value) {
    if (!(name in windowSlots)) {
      throw new Error(`Browser harness window property '${name}' is not known`);
    }
    windowSlots[name] = value;
  }

  /**
   * @param {Function} callback
   * @param {unknown} delay
   * @param  {...any} args
   */
  function harnessSetTimeout(callback, delay, ...args) {
    const id = nextAsyncId++;
    const safeDelay = toDelay(delay);
    timers.set(id, {
      callback,
      dueAt: now + safeDelay,
      delay: safeDelay,
      args,
    });
    return id;
  }

  /** @param {number} id */
  function harnessClearTimeout(id) {
    timers.delete(id);
  }

  /** @param {FrameRequestCallback} callback */
  function harnessRequestAnimationFrame(callback) {
    const id = nextAsyncId++;
    animationFrames.set(id, callback);
    return id;
  }

  /** @param {number} id */
  function harnessCancelAnimationFrame(id) {
    animationFrames.delete(id);
  }

  /** @type {Record<string, unknown>} */
  const windowSlots = {
    innerWidth: options.innerWidth || 1024,
    innerHeight: options.innerHeight || 768,
    document: activeDocument,
    performance,
    location: { hash: "" },
    history: {
      pushState() {},
      replaceState() {},
    },
    /**
     * @param {string} eventName
     * @param {Function} listener
     */
    addEventListener(eventName, listener) {
      const eventListeners = listeners.get(eventName) || [];
      eventListeners.push(listener);
      listeners.set(eventName, eventListeners);
    },
    /**
     * @param {string} eventName
     * @param {Function} listener
     */
    removeEventListener(eventName, listener) {
      const eventListeners = listeners.get(eventName);
      if (!eventListeners) return;
      listeners.set(
        eventName,
        eventListeners.filter((candidate) => candidate !== listener),
      );
    },
    /** @param {{type: string}} event */
    dispatchEvent(event) {
      const eventListeners = listeners.get(event.type) || [];
      for (const listener of eventListeners) listener(event);
      return true;
    },
    /**
     * @param {number} left
     * @param {number} top
     */
    scrollTo(left, top) {
      if (activeDocument?.documentElement) {
        activeDocument.documentElement.scrollLeft = left;
        activeDocument.documentElement.scrollTop = top;
      }
      const eventListeners = listeners.get("scroll") || [];
      for (const listener of eventListeners) listener({ type: "scroll" });
    },
    setTimeout: harnessSetTimeout,
    clearTimeout: harnessClearTimeout,
    requestAnimationFrame: harnessRequestAnimationFrame,
    cancelAnimationFrame: harnessCancelAnimationFrame,
  };
  const fakeWindow = createFrozenWindow(windowSlots);

  /**
   * @returns {boolean}
   */
  function runDueTimers() {
    const dueTimers = [...timers]
      .filter(([, timer]) => timer.dueAt <= now)
      .sort(
        (left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0],
      );
    if (dueTimers.length === 0) return false;
    for (const [id, timer] of dueTimers) {
      if (!timers.delete(id)) continue;
      timer.callback(...timer.args);
    }
    return true;
  }

  /**
   * @returns {boolean}
   */
  function runAnimationFrames() {
    const frames = [...animationFrames];
    if (frames.length === 0) return false;
    animationFrames.clear();
    for (const [, callback] of frames) callback(now);
    return true;
  }

  Object.defineProperty(globalAny, "window", {
    configurable: true,
    enumerable: previousWindowDescriptor?.enumerable ?? true,
    get() {
      return fakeWindow;
    },
    set() {
      throw new Error(
        "Use installBrowserHarness() instead of reassigning global.window",
      );
    },
  });
  globalAny.document = activeDocument;
  globalAny.performance = performance;
  globalAny.setTimeout = harnessSetTimeout;
  globalAny.clearTimeout = harnessClearTimeout;
  globalAny.requestAnimationFrame = harnessRequestAnimationFrame;
  globalAny.cancelAnimationFrame = harnessCancelAnimationFrame;
  globalAny.innerWidth = windowSlots.innerWidth;
  globalAny.innerHeight = windowSlots.innerHeight;

  const clock = {};
  Object.defineProperty(clock, "now", {
    get() {
      return now;
    },
    set(value) {
      now = toFiniteNumber(value, now);
    },
    enumerable: true,
  });

  return {
    window: fakeWindow,
    get document() {
      return activeDocument;
    },
    clock,
    /** @param {number} value */
    setTime(value) {
      now = toFiniteNumber(value, now);
    },
    /** @param {number} ms */
    advanceTime(ms) {
      now += Math.max(0, toFiniteNumber(ms, 0));
      this.flushAsync();
    },
    flushAsync() {
      let progressed = false;
      if (runAnimationFrames()) progressed = true;
      if (runDueTimers()) progressed = true;
      return progressed;
    },
    /** @param {{limit?: number}} [options] */
    flushUntilIdle(options = {}) {
      const limit = options.limit || 50;
      for (let i = 0; i < limit; i += 1) {
        if (!this.flushAsync()) return;
      }
      throw new Error("Browser harness did not become idle");
    },
    /** @param {number} delay */
    flushTimersByDelay(delay) {
      const targetDelay = toDelay(delay);
      const matchingTimers = [...timers]
        .filter(([, timer]) => timer.delay === targetDelay)
        .sort((left, right) => left[0] - right[0]);
      for (const [id, timer] of matchingTimers) {
        if (!timers.delete(id)) continue;
        if (timer.dueAt > now) now = timer.dueAt;
        timer.callback(...timer.args);
      }
    },
    /** @param {any} document */
    setDocument(document) {
      activeDocument = document;
      setWindowSlot("document", document);
      globalAny.document = document;
    },
    /**
     * @param {Record<string, unknown>} properties
     */
    setWindowProperties(properties) {
      for (const [name, value] of Object.entries(properties)) {
        setWindowSlot(name, value);
      }
      if ("innerWidth" in properties) {
        globalAny.innerWidth = properties.innerWidth;
      }
      if ("innerHeight" in properties) {
        globalAny.innerHeight = properties.innerHeight;
      }
    },
    /**
     * @param {string} name
     * @param {unknown} value
     */
    setGlobal(name, value) {
      if (!Object.prototype.hasOwnProperty.call(previous, name)) {
        Object.defineProperty(previous, name, {
          value: globalAny[name],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      globalAny[name] = value;
    },
    /** @param {string} eventName */
    dispatchWindowEvent(eventName) {
      const eventListeners = listeners.get(eventName) || [];
      for (const listener of eventListeners) listener({ type: eventName });
    },
    restore() {
      if (restored) return;
      restored = true;
      timers.clear();
      animationFrames.clear();
      if (previousWindowDescriptor) {
        Object.defineProperty(globalAny, "window", previousWindowDescriptor);
      } else {
        delete globalAny.window;
      }
      Object.assign(globalAny, previous);
    },
  };
}

module.exports = {
  installBrowserHarness,
};
