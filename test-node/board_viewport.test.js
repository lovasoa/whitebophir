const test = require("node:test");
const assert = require("node:assert/strict");

async function loadViewportModule() {
  return import("../client-data/js/board_viewport.js");
}

/**
 * @param {string} [initialHash]
 */
function createViewportHashTestEnvironment(initialHash = "#0,0,1.000") {
  const globalAny = /** @type {any} */ (global);
  const previousWindow = globalAny.window;
  const previousDocument = globalAny.document;
  /** @type {Map<string, Array<(event: {type: string}) => void>>} */
  const listeners = new Map();
  /** @type {Map<number, {fn: () => void, delay: number}>} */
  const timers = new Map();
  /** @type {Array<{type: string, url: unknown}>} */
  const historyCalls = [];
  let nextTimerId = 1;

  const fakeDocument = {
    documentElement: {
      scrollLeft: 0,
      scrollTop: 0,
    },
  };

  /** @param {string} type */
  function dispatch(type) {
    for (const listener of listeners.get(type) || []) listener({ type });
  }

  /** @param {unknown} url */
  function writeHash(url) {
    if (typeof url === "string" && url.startsWith("#")) {
      fakeWindow.location.hash = url;
    }
  }

  const fakeWindow = {
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
    /**
     * @param {string} type
     * @param {(event: {type: string}) => void} listener
     */
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || [];
      typeListeners.push(listener);
      listeners.set(type, typeListeners);
    },
    /**
     * @param {() => void} fn
     * @param {number} delay
     */
    setTimeout(fn, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { fn, delay });
      return id;
    },
    /** @param {number} id */
    clearTimeout(id) {
      timers.delete(id);
    },
    /**
     * @param {number} left
     * @param {number} top
     */
    scrollTo(left, top) {
      fakeDocument.documentElement.scrollLeft = left;
      fakeDocument.documentElement.scrollTop = top;
      dispatch("scroll");
    },
  };

  globalAny.window = fakeWindow;
  globalAny.document = fakeDocument;

  return {
    window: fakeWindow,
    historyCalls,
    timers,
    /** @param {number} delay */
    flushTimers(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    restore() {
      globalAny.window = previousWindow;
      globalAny.document = previousDocument;
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

test("viewport hash sync waits until hand pan ends", async () => {
  const env = createViewportHashTestEnvironment();
  try {
    const { createViewportController } = await loadViewportModule();
    const viewport = createViewportController(createViewportHashTestTools());
    viewport.installHashObservers();

    viewport.beginPan(0, 0);
    viewport.movePan(-25, -40);
    env.flushTimers(200);

    assert.equal(env.window.location.hash, "#0,0,1.000");
    assert.equal(env.historyCalls.length, 0);
    assert.equal(env.timers.size, 0);

    viewport.endPan();

    assert.equal(env.timers.size, 1);
    env.flushTimers(200);
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
    assert.equal(env.timers.size, 1);

    env.flushTimers(200);

    assert.equal(env.window.location.hash, "#0,0,0.500");
    assert.deepEqual(env.historyCalls, [
      { type: "replaceState", url: "#0,0,0.500" },
    ]);
  } finally {
    env.restore();
  }
});

test("viewport owns svg extent growth and layout sync", async () => {
  const globalAny = /** @type {any} */ (global);
  const previousWindow = globalAny.window;
  globalAny.window = {
    innerWidth: 320,
    innerHeight: 240,
  };
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
    globalAny.window = previousWindow;
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
  const globalAny = /** @type {any} */ (global);
  const previousWindow = globalAny.window;
  globalAny.window = {
    innerWidth: 100,
    innerHeight: 100,
    setTimeout: () => 0,
  };
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
    globalAny.window = previousWindow;
  }
});
