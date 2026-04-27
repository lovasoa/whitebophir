const test = require("node:test");
const assert = require("node:assert/strict");

async function loadViewportModule() {
  return import("../client-data/js/board_viewport.js");
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
      scale: 0.5,
      server_config: {
        MAX_BOARD_SIZE: 1000,
      },
      svg: {
        width: { baseVal: { value: 100 } },
        height: { baseVal: { value: 200 } },
      },
      board: {
        style: {},
        dataset: {},
      },
    });
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
