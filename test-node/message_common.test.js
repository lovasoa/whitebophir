const test = require("node:test");
const assert = require("node:assert/strict");

const MessageCommon = require("../client-data/js/message_common.js");
const { TOOLS } = require("../client-data/tools/index.js");

test("shared giant-shape policy exposes the draw zoom threshold", () => {
  assert.equal(MessageCommon.getMaxShapeSpan(), 32000);
  assert.equal(MessageCommon.isDrawToolAllowedAtScale(0.04), false);
  assert.equal(MessageCommon.isDrawToolAllowedAtScale(0.041), true);
});

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

test("shape tool bounds use straight-shape geometry consistently", () => {
  const shapeToolNames = TOOLS.filter((tool) => tool.shapeTool === true).map(
    (tool) => tool.toolId,
  );
  for (const toolName of shapeToolNames) {
    const bounds = MessageCommon.getLocalGeometryBounds({
      tool: toolName,
      x: 10,
      y: 40,
      x2: 5,
      y2: 50,
    });
    assert.deepEqual(bounds, {
      minX: 5,
      minY: 40,
      maxX: 10,
      maxY: 50,
    });
  }
});

test("getLocalGeometryBounds measures text", () => {
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
