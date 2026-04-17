const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStoredSvgState,
  rewriteStoredSvg,
} = require("../server/stored_svg_rewrite.mjs");
const { parseStoredSvg } = require("../server/svg_board_store.mjs");

test("stored svg rewrite preserves shell and paint order across update copy and delete", () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="keep"></marker></defs>' +
    '<g id="drawingArea">' +
    '<g id="rect-1" data-wbo-tool="Rectangle" data-wbo-item="%7B%22id%22%3A%22rect-1%22%2C%22tool%22%3A%22Rectangle%22%2C%22type%22%3A%22rect%22%2C%22x%22%3A1%2C%22y%22%3A2%2C%22x2%22%3A3%2C%22y2%22%3A4%2C%22color%22%3A%22%23123456%22%2C%22size%22%3A4%7D"></g>' +
    '<g id="text-1" data-wbo-tool="Text" data-wbo-item="%7B%22id%22%3A%22text-1%22%2C%22tool%22%3A%22Text%22%2C%22type%22%3A%22new%22%2C%22x%22%3A5%2C%22y%22%3A6%2C%22txt%22%3A%22hello%22%2C%22size%22%3A18%2C%22color%22%3A%22%23654321%22%7D"></g>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";

  const rewritten = rewriteStoredSvg(svg, { readonly: true }, 5, [
    {
      mutation: {
        tool: "Rectangle",
        type: "update",
        id: "rect-1",
        x2: 30,
        y2: 40,
      },
    },
    {
      mutation: {
        tool: "Hand",
        type: "copy",
        id: "rect-1",
        newid: "rect-2",
      },
    },
    {
      mutation: {
        tool: "Eraser",
        type: "delete",
        id: "text-1",
      },
    },
  ]);

  assert.match(rewritten, /<marker id="keep"><\/marker><\/defs>/);
  assert.match(
    rewritten,
    /<g id="cursors"><path id="cursor-template"><\/path><\/g>/,
  );
  assert.match(rewritten, /data-wbo-seq="5"/);
  assert.match(rewritten, /data-wbo-readonly="true"/);

  const rect1Index = rewritten.indexOf('id="rect-1"');
  const rect2Index = rewritten.indexOf('id="rect-2"');
  assert.ok(rect1Index !== -1);
  assert.ok(rect2Index !== -1);
  assert.ok(rect1Index < rect2Index);
  assert.equal(rewritten.includes('id="text-1"'), false);

  const parsed = parseStoredSvg(rewritten);
  assert.equal(parsed.board["rect-1"].x2, 30);
  assert.equal(parsed.board["rect-2"].tool, "Rectangle");
  assert.deepEqual(Object.keys(parsed.board), ["rect-1", "rect-2"]);
});

test("stored svg rewrite applies hand batches pencil growth and clear", () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<g id="line-1" data-wbo-tool="Pencil" data-wbo-item="%7B%22id%22%3A%22line-1%22%2C%22tool%22%3A%22Pencil%22%2C%22type%22%3A%22line%22%2C%22color%22%3A%22%23123456%22%2C%22size%22%3A4%2C%22_children%22%3A%5B%7B%22x%22%3A1%2C%22y%22%3A2%7D%5D%7D"></g>' +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";

  const afterBatch = rewriteStoredSvg(svg, { readonly: false }, 2, [
    {
      mutation: {
        tool: "Hand",
        _children: [{ type: "copy", id: "line-1", newid: "line-2" }],
      },
    },
    {
      mutation: {
        tool: "Pencil",
        type: "child",
        parent: "line-2",
        x: 9,
        y: 10,
      },
    },
  ]);
  const parsedAfterBatch = parseStoredSvg(afterBatch);
  assert.equal(parsedAfterBatch.board["line-2"]._children.length, 2);

  const cleared = rewriteStoredSvg(afterBatch, { readonly: false }, 3, [
    {
      mutation: {
        tool: "Clear",
        type: "clear",
      },
    },
  ]);
  const parsedCleared = parseStoredSvgState(cleared);
  assert.deepEqual(parsedCleared.order, []);
  assert.equal(parsedCleared.items.size, 0);
});
