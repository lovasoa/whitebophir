const test = require("node:test");
const assert = require("node:assert/strict");
const {
  installBrowserHarnessForTest,
} = require("./helpers/browser_harness.js");

const getBrowserHarness = installBrowserHarnessForTest(test);

async function loadViewportModule() {
  return import("../client-data/js/board_viewport.js");
}

async function loadOverlayModule() {
  return import("../client-data/js/board_html_overlay.js");
}

/**
 * @param {string} [initialHash]
 */
function createViewportHashTestEnvironment(initialHash = "#0,0,1.000") {
  const browser = getBrowserHarness();
  browser.setWindowProperties({
    innerWidth: 100,
    innerHeight: 100,
  });
  /** @type {Array<{type: string, url: unknown}>} */
  const historyCalls = [];

  const fakeDocument = {
    documentElement: {
      scrollLeft: 0,
      scrollTop: 0,
    },
  };

  /** @param {unknown} url */
  function writeHash(url) {
    if (typeof url === "string" && url.startsWith("#")) {
      browser.window.location.hash = url;
    }
  }

  browser.setDocument(fakeDocument);
  browser.setWindowProperties({
    innerWidth: 100,
    innerHeight: 100,
    location: {
      hash: initialHash,
    },
    history: {
      /**
       * @param {unknown} _state
       * @param {string} _title
       * @param {unknown} url
       */
      pushState(_state, _title, url) {
        historyCalls.push({ type: "pushState", url });
        writeHash(url);
      },
      /**
       * @param {unknown} _state
       * @param {string} _title
       * @param {unknown} url
       */
      replaceState(_state, _title, url) {
        historyCalls.push({ type: "replaceState", url });
        writeHash(url);
      },
    },
  });

  return {
    window: browser.window,
    document: fakeDocument,
    historyCalls,
    settleHashSync() {
      browser.flushTimersByDelay(200);
      browser.flushUntilIdle();
    },
    restore() {
      browser.restore();
    },
  };
}

/**
 * @param {number} [scale]
 * @returns {any}
 */
function createViewportHashTestTools(scale = 1) {
  return {
    viewportState: {
      scale,
    },
    config: {
      serverConfig: {
        MAX_BOARD_SIZE: 1000,
      },
    },
    coordinates: {
      /** @param {unknown} value */
      toBoardCoordinate: (value) => Number(value) || 0,
    },
    preferences: {},
    toolRegistry: {
      syncDrawToolAvailability: () => {},
    },
    dom: null,
  };
}

function createBoardTouchTarget() {
  /** @type {Map<string, Array<{listener: (event: any) => void, options: AddEventListenerOptions | boolean | undefined}>>} */
  const listeners = new Map();
  return {
    style: {},
    dataset: {},
    listeners,
    /**
     * @param {string} type
     * @param {(event: any) => void} listener
     * @param {AddEventListenerOptions | boolean | undefined} options
     */
    addEventListener(type, listener, options) {
      const typeListeners = listeners.get(type) || [];
      typeListeners.push({ listener, options });
      listeners.set(type, typeListeners);
    },
    /**
     * @param {string} type
     * @param {(event: any) => void} listener
     */
    removeEventListener(type, listener) {
      const typeListeners = listeners.get(type) || [];
      listeners.set(
        type,
        typeListeners.filter((entry) => entry.listener !== listener),
      );
    },
    /**
     * @param {string} type
     * @param {any} event
     */
    dispatch(type, event) {
      for (const entry of listeners.get(type) || []) entry.listener(event);
    },
    /** @param {{type: string}} event */
    dispatchEvent(event) {
      this.dispatch(event.type, event);
      return true;
    },
  };
}

/**
 * @param {{left?: number, top?: number}} [rect]
 * @returns {any}
 */
function createOverlayBoardElement(rect = {}) {
  const board = createBoardTouchTarget();
  return {
    ...board,
    children: /** @type {any[]} */ ([]),
    /** @param {any} child */
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    /** @param {any} child */
    removeChild(child) {
      this.children = this.children.filter(
        /** @param {any} candidate */
        (candidate) => candidate !== child,
      );
      child.parentNode = null;
      return child;
    },
    getBoundingClientRect() {
      return {
        left: rect.left || 0,
        top: rect.top || 0,
      };
    },
  };
}

/** @returns {any} */
function createOverlayElement() {
  return {
    style: /** @type {Record<string, string>} */ ({}),
    parentNode: null,
  };
}

/**
 * @param {() => number} getScale
 * @param {{left?: number, top?: number}} [origin]
 */
function createOverlayViewport(getScale, origin = {}) {
  /** @param {{left?: unknown, top?: unknown, right?: unknown, bottom?: unknown, width?: unknown, height?: unknown}} rect */
  function clientRectToLayoutRect(rect) {
    const left = Number(rect.left) || 0;
    const top = Number(rect.top) || 0;
    const width = Number.isFinite(Number(rect.width))
      ? Number(rect.width)
      : (Number(rect.right) || left) - left;
    const height = Number.isFinite(Number(rect.height))
      ? Number(rect.height)
      : (Number(rect.bottom) || top) - top;
    return {
      left: left - (origin.left || 0),
      top: top - (origin.top || 0),
      width,
      height,
    };
  }

  return {
    /** @param {{x: number, y: number, width: number, height: number}} rect */
    boardRectToLayoutRect: (rect) => {
      const scale = getScale();
      return {
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      };
    },
    clientRectToLayoutRect,
    /** @param {{left?: unknown, top?: unknown, right?: unknown, bottom?: unknown, width?: unknown, height?: unknown}} rect */
    clientRectToBoardRect: (rect) => {
      const layoutRect = clientRectToLayoutRect(rect);
      const scale = getScale();
      return {
        x: layoutRect.left / scale,
        y: layoutRect.top / scale,
        width: layoutRect.width / scale,
        height: layoutRect.height / scale,
      };
    },
  };
}

/**
 * @param {any} tools
 * @param {ReturnType<typeof createBoardTouchTarget>} [board]
 */
function attachViewportDom(tools, board = createBoardTouchTarget()) {
  const svg = {
    style: {},
    width: { baseVal: { value: 1000 } },
    height: { baseVal: { value: 1000 } },
  };
  tools.dom = {
    status: "attached",
    board,
    svg,
    drawingArea: {},
  };
  return { board, svg };
}

/**
 * @param {string} type
 * @param {unknown[]} touches
 * @param {unknown[]} changedTouches
 * @param {boolean} [cancelable]
 */
function createTouchEvent(type, touches, changedTouches, cancelable = true) {
  return {
    type,
    touches,
    changedTouches,
    cancelable,
    defaultPrevented: false,
    preventDefaultCalls: 0,
    preventDefault() {
      this.defaultPrevented = true;
      this.preventDefaultCalls += 1;
    },
  };
}

/**
 * @param {number} identifier
 * @param {number} pageX
 * @param {number} pageY
 */
function createTouch(identifier, pageX, pageY) {
  return {
    identifier,
    pageX,
    pageY,
    clientX: pageX,
    clientY: pageY,
  };
}

/**
 * @param {ReturnType<typeof createBoardTouchTarget>} board
 * @param {string} eventName
 * @returns {AddEventListenerOptions | boolean | undefined}
 */
function firstBoardListenerOptions(board, eventName) {
  return board.listeners.get(eventName)?.[0]?.options;
}

test("viewport scale clamping uses explicit dimensions without browser globals", async () => {
  const { clampScale } = await loadViewportModule();

  assert.equal(
    clampScale(Number.NaN, {
      maxBoardSize: 1000,
      viewportWidth: 200,
      viewportHeight: 100,
      defaultScale: 0.25,
    }),
    0.25,
  );
  assert.equal(
    clampScale(0.01, {
      maxBoardSize: 1000,
      viewportWidth: 200,
      viewportHeight: 100,
    }),
    0.2,
  );
  assert.equal(
    clampScale(5, {
      maxBoardSize: 1000,
      viewportWidth: 200,
      viewportHeight: 100,
      maxScale: 1,
    }),
    1,
  );
});

test("viewport wheel delta normalization handles pixel, line, and page modes", async () => {
  const { normalizeWheelDelta } = await loadViewportModule();

  assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 0 }), 2);
  assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 1 }), 60);
  assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 2 }), 2000);
});

test("S/O + wheel style shortcuts use dominant wheel axis (trackpad-friendly)", async () => {
  const { wheelDeltaForStyleWheel } = await loadViewportModule();

  assert.equal(
    wheelDeltaForStyleWheel(
      /** @type {any} */ ({
        deltaY: 10,
        deltaX: 3,
        deltaMode: 0,
      }),
    ),
    10,
  );
  assert.equal(
    wheelDeltaForStyleWheel(
      /** @type {any} */ ({
        deltaY: 0,
        deltaX: -8,
        deltaMode: 0,
      }),
    ),
    -8,
  );
});

test("viewport wheel zoom factor is exponential and capped per frame", async () => {
  const { wheelDeltaToScaleFactor } = await loadViewportModule();

  assert.ok(
    Math.abs(wheelDeltaToScaleFactor(10) * wheelDeltaToScaleFactor(-10) - 1) <
      1e-12,
  );
  assert.equal(wheelDeltaToScaleFactor(10_000), wheelDeltaToScaleFactor(120));
  assert.equal(wheelDeltaToScaleFactor(-10_000), wheelDeltaToScaleFactor(-120));
});

test("viewport anchored zoom preserves the board point under the cursor", async () => {
  const { zoomAt } = await loadViewportModule();

  const next = zoomAt(
    {
      scrollLeft: 100,
      scrollTop: 200,
      scale: 0.5,
      x: 400,
      y: 600,
    },
    0.75,
  );

  assert.deepEqual(next, {
    left: 200,
    top: 350,
    scale: 0.75,
  });
});

test("viewport layout size follows scaled svg while filling the viewport", async () => {
  const { getScaledBoardLayoutSize } = await loadViewportModule();

  assert.deepEqual(getScaledBoardLayoutSize(5000, 4000, 0.5, 1200, 800), {
    width: 2500,
    height: 2000,
  });
  assert.deepEqual(getScaledBoardLayoutSize(5000, 4000, 0.1, 1200, 800), {
    width: 1200,
    height: 800,
  });
});

test("viewport converts board coordinates to layout coordinates", async () => {
  const { createViewportController } = await loadViewportModule();
  const tools = createViewportHashTestTools(0.25);
  const viewport = createViewportController(tools);

  assert.equal(viewport.boardCoordinateToLayout(80), 20);
  assert.equal(viewport.boardCoordinateToLayout("12"), 3);
  assert.equal(viewport.boardCoordinateToLayout(Number.NaN), 0);
  assert.deepEqual(
    viewport.boardRectToLayoutRect({ x: 8, y: 12, width: 16, height: 20 }),
    { left: 2, top: 3, width: 4, height: 5 },
  );
});

test("viewport converts board rects to viewport rects with scroll", async () => {
  const env = createViewportHashTestEnvironment();
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools(0.5);
    attachViewportDom(tools);
    env.document.documentElement.scrollLeft = 30;
    env.document.documentElement.scrollTop = 50;
    const viewport = createViewportController(tools);

    assert.deepEqual(
      viewport.boardRectToViewportRect({
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      }),
      {
        left: -25,
        top: -40,
        right: -10,
        bottom: -20,
        width: 15,
        height: 20,
      },
    );
  } finally {
    env.restore();
  }
});

test("viewport converts client rects to board-relative layout rects", async () => {
  const env = createViewportHashTestEnvironment();
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools(0.5);
    attachViewportDom(tools);
    env.document.documentElement.scrollLeft = 30;
    env.document.documentElement.scrollTop = 50;
    const viewport = createViewportController(tools);

    assert.deepEqual(
      viewport.clientRectToLayoutRect({
        left: -25,
        top: -40,
        right: -10,
        bottom: -20,
      }),
      {
        left: 5,
        top: 10,
        width: 15,
        height: 20,
      },
    );
    assert.deepEqual(
      viewport.clientRectToBoardRect({
        left: -25,
        top: -40,
        right: -10,
        bottom: -20,
      }),
      {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
    );
  } finally {
    env.restore();
  }
});

test("viewport rect converters work when board DOM is detached", async () => {
  const env = createViewportHashTestEnvironment();
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools(2);
    env.document.documentElement.scrollLeft = 7;
    env.document.documentElement.scrollTop = 9;
    const viewport = createViewportController(tools);

    assert.deepEqual(
      viewport.boardRectToViewportRect({
        x: 10,
        y: 11,
        width: 12,
        height: 13,
      }),
      {
        left: 13,
        top: 13,
        right: 37,
        bottom: 39,
        width: 24,
        height: 26,
      },
    );
    assert.deepEqual(
      viewport.clientRectToLayoutRect({
        left: 13,
        top: 13,
        width: 24,
        height: 26,
      }),
      {
        left: 20,
        top: 22,
        width: 24,
        height: 26,
      },
    );
    assert.deepEqual(
      viewport.clientRectToBoardRect({
        left: 13,
        top: 13,
        width: 24,
        height: 26,
      }),
      {
        x: 10,
        y: 11,
        width: 12,
        height: 13,
      },
    );
  } finally {
    env.restore();
  }
});

test("board html overlay positions board-space bounds at multiple scales", async () => {
  const { VIEWPORT_LAYOUT_EVENT } = await loadViewportModule();
  const { createBoardHtmlOverlay } = await loadOverlayModule();
  let scale = 0.5;
  const board = createOverlayBoardElement();
  const element = createOverlayElement();
  const viewport = createOverlayViewport(() => scale);
  const overlay = createBoardHtmlOverlay({ board, viewport, element });

  overlay.syncBoardRect({ x: 20, y: 30, width: 40, height: 50 });
  assert.equal(element.parentNode, board);
  assert.deepEqual(element.style, {
    position: "absolute",
    left: "10px",
    top: "15px",
    width: "20px",
    height: "25px",
    display: "",
  });

  scale = 0.25;
  board.dispatchEvent({ type: VIEWPORT_LAYOUT_EVENT });
  assert.equal(element.style.left, "5px");
  assert.equal(element.style.top, "7.5px");
  assert.equal(element.style.width, "10px");
  assert.equal(element.style.height, "12.5px");
});

test("board html overlay updates from a rect factory on viewport layout", async () => {
  const { VIEWPORT_LAYOUT_EVENT } = await loadViewportModule();
  const { createBoardHtmlOverlay } = await loadOverlayModule();
  let scale = 1;
  let x = 10;
  let reads = 0;
  const board = createOverlayBoardElement();
  const element = createOverlayElement();
  const viewport = createOverlayViewport(() => scale);
  const overlay = createBoardHtmlOverlay({ board, viewport, element });

  overlay.syncBoardRect(() => {
    reads += 1;
    return { x, y: 5, width: 10, height: 10 };
  });
  assert.equal(reads, 1);
  assert.equal(element.style.left, "10px");

  x = 20;
  scale = 2;
  board.dispatchEvent({ type: VIEWPORT_LAYOUT_EVENT });
  assert.equal(reads, 2);
  assert.equal(element.style.left, "40px");
  assert.equal(element.style.width, "20px");
});

test("board html overlay projects client rects and cleans up listeners", async () => {
  const { VIEWPORT_LAYOUT_EVENT } = await loadViewportModule();
  const { createBoardHtmlOverlay } = await loadOverlayModule();
  const origin = { left: -10, top: -20 };
  const board = createOverlayBoardElement(origin);
  const element = createOverlayElement();
  const viewport = createOverlayViewport(() => 0.5, origin);
  const overlay = createBoardHtmlOverlay({ board, viewport, element });

  overlay.syncClientRect({ left: 5, top: 10, right: 25, bottom: 30 });
  assert.equal(board.listeners.get(VIEWPORT_LAYOUT_EVENT)?.length, 1);
  assert.deepEqual(element.style, {
    position: "absolute",
    left: "15px",
    top: "30px",
    width: "20px",
    height: "20px",
    display: "",
  });

  overlay.hide();
  assert.equal(board.listeners.get(VIEWPORT_LAYOUT_EVENT)?.length, 0);
  assert.equal(element.style.display, "none");

  overlay.syncBoardRect({ x: 1, y: 2, width: 3, height: 4 });
  assert.equal(board.listeners.get(VIEWPORT_LAYOUT_EVENT)?.length, 1);
  overlay.destroy();
  assert.equal(board.listeners.get(VIEWPORT_LAYOUT_EVENT)?.length, 0);
  assert.equal(element.parentNode, null);

  board.dispatchEvent({ type: VIEWPORT_LAYOUT_EVENT });
  assert.equal(element.style.display, "none");
});

test("viewport hash sync waits until hand pan ends", async () => {
  const env = createViewportHashTestEnvironment();
  try {
    const { createViewportController } = await loadViewportModule();
    const viewport = createViewportController(createViewportHashTestTools());
    viewport.installHashObservers();

    viewport.beginPan(0, 0);
    viewport.movePan(-25, -40);
    env.settleHashSync();

    assert.equal(env.window.location.hash, "#0,0,1.000");
    assert.equal(env.historyCalls.length, 0);

    viewport.endPan();

    env.settleHashSync();
    assert.equal(env.window.location.hash, "#25,40,1.000");
    assert.deepEqual(env.historyCalls, [
      { type: "replaceState", url: "#25,40,1.000" },
    ]);
  } finally {
    env.restore();
  }
});

test("viewport hash sync waits for zoom debounce", async () => {
  const env = createViewportHashTestEnvironment();
  try {
    const { createViewportController } = await loadViewportModule();
    const viewport = createViewportController(createViewportHashTestTools());
    viewport.installHashObservers();

    viewport.zoomBy(0.5, 0, 0);

    assert.equal(env.window.location.hash, "#0,0,1.000");
    assert.equal(env.historyCalls.length, 0);

    env.settleHashSync();

    assert.equal(env.window.location.hash, "#0,0,0.500");
    assert.deepEqual(env.historyCalls, [
      { type: "replaceState", url: "#0,0,0.500" },
    ]);
  } finally {
    env.restore();
  }
});

test("viewport pinch prevents default until all touches end", async () => {
  const env = createViewportHashTestEnvironment("#0,0,0.100");
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools(0.1);
    const board = createBoardTouchTarget();
    const svg = {
      style: {},
      width: { baseVal: { value: 1000 } },
      height: { baseVal: { value: 1000 } },
    };
    tools.dom = {
      status: "attached",
      board,
      svg,
      drawingArea: {},
    };
    const viewport = createViewportController(tools);
    viewport.installHashObservers();
    viewport.install();

    assert.deepEqual(firstBoardListenerOptions(board, "touchmove"), {
      passive: false,
      capture: true,
    });

    const first = createTouch(1, 100, 100);
    const second = createTouch(2, 140, 100);
    const movedFirst = createTouch(1, 80, 100);
    const movedSecond = createTouch(2, 180, 100);

    const start = createTouchEvent("touchstart", [first, second], [second]);
    board.dispatch("touchstart", start);
    assert.equal(start.defaultPrevented, true);

    const move = createTouchEvent(
      "touchmove",
      [movedFirst, movedSecond],
      [movedFirst, movedSecond],
    );
    board.dispatch("touchmove", move);
    assert.equal(move.defaultPrevented, true);

    const endOne = createTouchEvent("touchend", [movedFirst], [movedSecond]);
    board.dispatch("touchend", endOne);
    assert.equal(endOne.defaultPrevented, true);
    env.settleHashSync();
    assert.equal(env.historyCalls.length, 0);

    const endAll = createTouchEvent("touchend", [], [movedFirst]);
    board.dispatch("touchend", endAll);
    assert.equal(endAll.defaultPrevented, true);
    env.settleHashSync();
    assert.equal(env.historyCalls.length, 1);
  } finally {
    env.restore();
  }
});

test("viewport two-finger gesture pans when midpoint moves", async () => {
  const env = createViewportHashTestEnvironment("#0,0,0.500");
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools(0.5);
    const { board } = attachViewportDom(tools);
    env.document.documentElement.scrollLeft = 100;
    env.document.documentElement.scrollTop = 200;
    const viewport = createViewportController(tools);
    viewport.install();

    const first = createTouch(1, 100, 100);
    const second = createTouch(2, 140, 100);
    const movedFirst = createTouch(1, 150, 130);
    const movedSecond = createTouch(2, 190, 130);

    const start = createTouchEvent("touchstart", [first, second], [second]);
    board.dispatch("touchstart", start);

    const move = createTouchEvent(
      "touchmove",
      [movedFirst, movedSecond],
      [movedFirst, movedSecond],
    );
    board.dispatch("touchmove", move);

    assert.equal(move.defaultPrevented, true);
    assert.equal(viewport.getScale(), 0.5);
    assert.equal(env.document.documentElement.scrollLeft, 50);
    assert.equal(env.document.documentElement.scrollTop, 170);
  } finally {
    env.restore();
  }
});

test("viewport two-finger gesture pans and zooms together", async () => {
  const env = createViewportHashTestEnvironment("#0,0,0.500");
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools(0.5);
    const { board } = attachViewportDom(tools);
    env.document.documentElement.scrollLeft = 100;
    env.document.documentElement.scrollTop = 200;
    const viewport = createViewportController(tools);
    viewport.install();

    const first = createTouch(1, 100, 100);
    const second = createTouch(2, 140, 100);
    const movedFirst = createTouch(1, 140, 120);
    const movedSecond = createTouch(2, 220, 120);

    const start = createTouchEvent("touchstart", [first, second], [second]);
    board.dispatch("touchstart", start);

    const move = createTouchEvent(
      "touchmove",
      [movedFirst, movedSecond],
      [movedFirst, movedSecond],
    );
    board.dispatch("touchmove", move);

    assert.equal(move.defaultPrevented, true);
    assert.equal(viewport.getScale(), 1);
    assert.equal(env.document.documentElement.scrollLeft, 260);
    assert.equal(env.document.documentElement.scrollTop, 480);
  } finally {
    env.restore();
  }
});

test("viewport touchcancel aborts pinch without committing hash sync", async () => {
  const env = createViewportHashTestEnvironment("#0,0,0.100");
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools(0.1);
    const board = createBoardTouchTarget();
    tools.dom = {
      status: "attached",
      board,
      svg: {
        style: {},
        width: { baseVal: { value: 1000 } },
        height: { baseVal: { value: 1000 } },
      },
      drawingArea: {},
    };
    const viewport = createViewportController(tools);
    viewport.installHashObservers();
    viewport.install();

    const first = createTouch(1, 100, 100);
    const second = createTouch(2, 140, 100);

    const start = createTouchEvent("touchstart", [first, second], [second]);
    board.dispatch("touchstart", start);
    assert.equal(start.defaultPrevented, true);

    const cancel = createTouchEvent("touchcancel", [], [first, second]);
    board.dispatch("touchcancel", cancel);
    assert.equal(cancel.defaultPrevented, true);

    env.settleHashSync();
    assert.equal(env.historyCalls.length, 0);
  } finally {
    env.restore();
  }
});

test("viewport ignores browser-owned non-cancelable pinch events", async () => {
  const env = createViewportHashTestEnvironment();
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = createViewportHashTestTools();
    const board = createBoardTouchTarget();
    tools.dom = {
      status: "attached",
      board,
      svg: {
        style: {},
        width: { baseVal: { value: 1000 } },
        height: { baseVal: { value: 1000 } },
      },
      drawingArea: {},
    };
    const viewport = createViewportController(tools);
    viewport.install();

    const first = createTouch(1, 100, 100);
    const second = createTouch(2, 140, 100);
    const start = createTouchEvent(
      "touchstart",
      [first, second],
      [second],
      false,
    );
    board.dispatch("touchstart", start);

    assert.equal(start.defaultPrevented, false);
    assert.equal(viewport.getScale(), 1);
  } finally {
    env.restore();
  }
});

test("viewport owns svg extent growth and layout sync", async () => {
  const browser = getBrowserHarness();
  browser.setWindowProperties({
    innerWidth: 320,
    innerHeight: 240,
  });
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = /** @type {any} */ ({
      viewportState: {
        scale: 0.5,
      },
      config: {
        serverConfig: {
          MAX_BOARD_SIZE: 1000,
        },
      },
      svg: {
        style: {},
        width: { baseVal: { value: 100 } },
        height: { baseVal: { value: 200 } },
      },
      board: {
        style: {},
        dataset: {},
      },
    });
    tools.dom = {
      status: "attached",
      board: tools.board,
      svg: tools.svg,
      drawingArea: {},
    };
    const viewport = createViewportController(tools);

    assert.equal(
      viewport.ensureBoardExtentForBounds({ maxX: 900.2, maxY: 1200 }),
      true,
    );
    assert.equal(tools.svg.width.baseVal.value, 1000);
    assert.equal(tools.svg.height.baseVal.value, 1000);
    assert.deepEqual(tools.board.style, {
      width: "500px",
      height: "500px",
      touchAction: "none",
    });
    assert.equal(tools.board.dataset.viewportManaged, "true");

    assert.equal(
      viewport.ensureBoardExtentForBounds({ maxX: 10, maxY: 10 }),
      false,
    );
  } finally {
    browser.restore();
  }
});

test("viewport native pan policy permits browser scroll without browser zoom", async () => {
  const { createViewportController } = await loadViewportModule();
  const tools = /** @type {any} */ ({
    viewportState: {
      scale: 1,
    },
    config: {
      serverConfig: {
        MAX_BOARD_SIZE: 1000,
      },
    },
    coordinates: {
      toBoardCoordinate: (/** @type {unknown} */ value) => Number(value) || 0,
    },
    preferences: {},
    toolRegistry: {
      syncDrawToolAvailability: () => {},
    },
    board: {
      style: {},
      dataset: {},
    },
    svg: {
      style: {},
    },
  });
  tools.dom = {
    status: "attached",
    board: tools.board,
    svg: tools.svg,
    drawingArea: {},
  };
  const viewport = createViewportController(tools);

  viewport.setTouchPolicy("native-pan");
  assert.equal(tools.board.style.touchAction, "pan-x pan-y");
  assert.equal(tools.svg.style.touchAction, "pan-x pan-y");

  viewport.setTouchPolicy("app-gesture");
  assert.equal(tools.board.style.touchAction, "none");
  assert.equal(tools.svg.style.touchAction, "none");
});

test("viewport expands to the full board at minimum zoom", async () => {
  const browser = getBrowserHarness();
  browser.setWindowProperties({
    innerWidth: 100,
    innerHeight: 100,
  });
  try {
    const { createViewportController } = await loadViewportModule();
    const tools = /** @type {any} */ ({
      viewportState: {
        scale: 1,
      },
      config: {
        serverConfig: {
          MAX_BOARD_SIZE: 1000,
        },
      },
      svg: {
        style: {},
        width: { baseVal: { value: 100 } },
        height: { baseVal: { value: 100 } },
      },
      board: {
        style: {},
        dataset: {},
      },
      toolRegistry: {
        syncDrawToolAvailability: () => {},
      },
    });
    tools.dom = {
      status: "attached",
      board: tools.board,
      svg: tools.svg,
      drawingArea: {},
    };
    const viewport = createViewportController(tools);

    assert.equal(viewport.setScale(0), 0.1);
    assert.equal(tools.svg.width.baseVal.value, 1000);
    assert.equal(tools.svg.height.baseVal.value, 1000);
    assert.deepEqual(tools.board.style, {
      width: "100px",
      height: "100px",
      touchAction: "none",
    });
  } finally {
    browser.restore();
  }
});
