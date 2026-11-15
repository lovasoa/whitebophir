const assert = require("node:assert/strict");
const test = require("node:test");
const {
  pointInTransformedBBox,
  transformedBBox,
} = require("../client-data/js/intersect.js");
const {
  installBrowserHarnessForTest,
} = require("./helpers/browser_harness.js");

const getBrowserHarness = installBrowserHarnessForTest(test);
test.beforeEach(() => getBrowserHarness().installDomGlobals());

test("selected SVG bounds apply the matrix without changing its transform list", () => {
  const matrix = { a: 0, b: 2, c: -3, d: 0, e: 100, f: 50 };
  const transforms = {
    0: { type: SVGTransform.SVG_TRANSFORM_MATRIX, matrix },
    numberOfItems: 1,
  };
  const element = Object.assign(Object.create(SVGGraphicsElement.prototype), {
    getBBox: () => ({ x: 10, y: 20, width: 30, height: 40 }),
    transform: { baseVal: transforms },
  });
  const bounds = transformedBBox(element);

  assert.deepEqual(bounds, { r: [40, 70], a: [0, 60], b: [-120, 0] });
  assert.equal(pointInTransformedBBox([-20, 100], bounds), true);
  assert.equal(pointInTransformedBBox([41, 100], bounds), false);
  assert.equal(element.transform.baseVal, transforms);
  assert.deepEqual(matrix, { a: 0, b: 2, c: -3, d: 0, e: 100, f: 50 });
});

test("untransformed selected SVG bounds use identity without installing a matrix", () => {
  const element = Object.assign(Object.create(SVGGraphicsElement.prototype), {
    getBBox: () => ({ x: 10, y: 20, width: 30, height: 40 }),
    transform: { baseVal: { numberOfItems: 0 } },
  });

  assert.deepEqual(transformedBBox(element), {
    r: [10, 20],
    a: [30, 0],
    b: [0, 40],
  });
  assert.equal(element.transform.baseVal.numberOfItems, 0);
});

test("selected nested SVG bounds use its viewport dimensions", () => {
  const element = Object.assign(Object.create(SVGSVGElement.prototype), {
    x: { baseVal: { value: 10 } },
    y: { baseVal: { value: 20 } },
    width: { baseVal: { value: 30 } },
    height: { baseVal: { value: 40 } },
    getBBox: () => {
      throw new Error("Nested SVG uses viewport dimensions");
    },
    transform: { baseVal: { numberOfItems: 0 } },
  });

  assert.deepEqual(transformedBBox(element), {
    r: [10, 20],
    a: [30, 0],
    b: [0, 40],
  });
});
