const test = require("node:test");
const assert = require("node:assert/strict");

const MessageCommon = require("../client-data/js/message_common.js");

test("shared geometry helpers apply transforms to bounds", () => {
  const bounds = MessageCommon.applyTransformToBounds(
    {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 50,
    },
    { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 },
  );

  assert.deepEqual(bounds, {
    minX: 10,
    minY: 20,
    maxX: 210,
    maxY: 170,
  });
});

test("shared geometry helpers grow pencil bounds incrementally", () => {
  let bounds = null;
  bounds = MessageCommon.extendBoundsWithPoint(bounds, 10, 20);
  bounds = MessageCommon.extendBoundsWithPoint(bounds, 100, 5);
  bounds = MessageCommon.extendBoundsWithPoint(bounds, -5, 25);

  assert.deepEqual(bounds, {
    minX: -5,
    minY: 5,
    maxX: 100,
    maxY: 25,
  });
});

test("getLocalGeometryBounds measures bounded text extent", () => {
  const bounds = MessageCommon.getLocalGeometryBounds({
    tool: "text",
    x: 100,
    y: 200,
    txt: "0123456789",
    size: 55,
  });
  assert.deepEqual(bounds, {
    minX: 100,
    minY: 200 - 55,
    maxX: 100 + 10 * 55,
    maxY: 200,
  });
});

test("getLocalGeometryBounds caps text extent at the maximum shape span", () => {
  const bounds = MessageCommon.getLocalGeometryBounds({
    tool: "text",
    x: 0,
    y: 500,
    txt: "x".repeat(280),
    size: 500,
  });
  assert.deepEqual(bounds, {
    minX: 0,
    minY: 0,
    maxX: MessageCommon.getMaxShapeSpan(),
    maxY: 500,
  });
});

test("getLocalGeometryBounds keeps empty text seeds at the anchor", () => {
  const bounds = MessageCommon.getLocalGeometryBounds({
    tool: "text",
    x: 100,
    y: 200,
    size: 55,
  });
  assert.deepEqual(bounds, {
    minX: 100,
    minY: 145,
    maxX: 100,
    maxY: 200,
  });
});
