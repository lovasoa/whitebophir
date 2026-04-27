const test = require("node:test");
const assert = require("node:assert/strict");

async function loadExtentModule() {
  return import("../client-data/js/board_extent.js");
}

async function loadToolOrderModule() {
  return import("../client-data/tools/tool-order.js");
}

test("content extents ignore cursor points", async () => {
  const { getContentMessageBounds } = await loadExtentModule();
  const { ToolCodes } = await loadToolOrderModule();

  assert.equal(
    getContentMessageBounds({
      tool: ToolCodes.CURSOR,
      type: 2,
      x: 100000,
      y: 80000,
    }),
    null,
  );
});

test("content extents still support explicit resize points", async () => {
  const { getContentMessageBounds } = await loadExtentModule();

  assert.deepEqual(getContentMessageBounds({ x: 5000, y: 8000 }), {
    minX: 5000,
    minY: 8000,
    maxX: 5000,
    maxY: 8000,
  });
});
