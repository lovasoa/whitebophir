const assert = require("node:assert/strict");
const test = require("node:test");
const {
  readPencilPath,
  writePencilPath,
} = require("../client-data/tools/pencil/pencil_geometry.js");

test("Pencil curves survive serialization and decoding before another append", () => {
  const {
    wboPencilPoint,
  } = require("../client-data/tools/pencil/wbo_pencil_point.js");
  /** @type {import("../client-data/tools/pencil/pencil_geometry.js").PencilPathSegment[]} */
  const points = [];
  wboPencilPoint(points, 10, 20);
  wboPencilPoint(points, 25, 35);
  wboPencilPoint(points, 40, 15);
  let d = "";
  const path = /** @type {SVGPathElement} */ (
    /** @type {unknown} */ ({
      setAttribute: (
        /** @type {string} */ _name,
        /** @type {string} */ value,
      ) => {
        d = value;
      },
      removeAttribute: () => {
        d = "";
      },
    })
  );
  writePencilPath(path, points);
  const decoded = readPencilPath(d);
  assert.deepEqual(decoded, points);
  wboPencilPoint(decoded, 55, 30);
  wboPencilPoint(points, 55, 30);
  assert.deepEqual(decoded, points);
  writePencilPath(path, []);
  assert.equal(d, "");
});

test("Pencil path decoding preserves SVG coordinate syntax and implicit lines", () => {
  assert.deepEqual(readPencilPath("M1e1,20 25-3.5 l.5,+2 C1 2 3 4 5 6"), [
    { type: "M", values: [10, 20] },
    { type: "L", values: [25, -3.5] },
    { type: "l", values: [0.5, 2] },
    { type: "C", values: [1, 2, 3, 4, 5, 6] },
  ]);
});

test("Pencil path decoding rejects incomplete or unsupported geometry", () => {
  for (const d of [
    "L 1 2",
    "M 1",
    "M 1 2 L",
    "M 1 2 C 3 4",
    "M 1 2 Q 3 4 5 6",
    "M 1 2 bad",
    "M 1e999 2",
  ]) {
    assert.deepEqual(readPencilPath(d), [], d);
  }
});
