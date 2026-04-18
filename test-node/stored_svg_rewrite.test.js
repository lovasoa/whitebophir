const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStoredSvgState,
  rewriteStoredSvg,
} = require("../server/stored_svg_rewrite.mjs");
const { parseStoredSvg } = require("../server/svg_board_store.mjs");

test("stored svg rewrite preserves shell and paint order across create update copy and delete", () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="keep"></marker></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";

  const rewritten = rewriteStoredSvg(svg, { readonly: true }, 5, [
    {
      mutation: {
        tool: "Ellipse",
        type: "ellipse",
        id: "ellipse-1",
        x: 7,
        y: 8,
        x2: 11,
        y2: 12,
        color: "#abcdef",
        size: 3,
      },
    },
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
  const ellipse1Index = rewritten.indexOf('id="ellipse-1"');
  const rect2Index = rewritten.indexOf('id="rect-2"');
  assert.ok(rect1Index !== -1);
  assert.ok(ellipse1Index !== -1);
  assert.ok(rect2Index !== -1);
  assert.ok(rect1Index < rect2Index);
  assert.ok(rect1Index < ellipse1Index);
  assert.ok(ellipse1Index < rect2Index);
  assert.equal(rewritten.includes('id="text-1"'), false);

  const parsed = parseStoredSvg(rewritten);
  assert.equal(parsed.board["rect-1"].x2, 30);
  assert.equal(parsed.board["ellipse-1"].tool, "Ellipse");
  assert.equal(parsed.board["rect-2"].tool, "Rectangle");
  assert.deepEqual(Object.keys(parsed.board), [
    "rect-1",
    "ellipse-1",
    "rect-2",
  ]);
});

test("stored svg rewrite applies hand batches pencil growth and clear", () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<path id="line-1" d="M 1 2" stroke="#123456" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
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

test("stored svg rewrite preserves untouched item bytes verbatim", () => {
  const untouchedPath =
    '<path id="line-1" d="M 1 2 L 1 2 C 1 2 3 4 3 4" stroke="#123456" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>';
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    untouchedPath +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";

  const rewritten = rewriteStoredSvg(svg, { readonly: false }, 2, [
    {
      mutation: {
        tool: "Rectangle",
        type: "update",
        id: "rect-1",
        x2: 30,
        y2: 40,
      },
    },
  ]);

  assert.match(
    rewritten,
    /<rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"><\/rect>/,
  );
  assert.equal(rewritten.includes(untouchedPath), true);
});

test("stored svg rewrite preserves the opaque prefix of touched pencil paths", () => {
  const originalPathData = "M 1 2 L 1 2 C 1 2 3 4 3 4";
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    `<path id="line-1" d="${originalPathData}" stroke="#123456" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>` +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";

  const rewritten = rewriteStoredSvg(svg, { readonly: false }, 2, [
    {
      mutation: {
        tool: "Pencil",
        type: "child",
        parent: "line-1",
        x: 9,
        y: 10,
      },
    },
  ]);

  assert.match(rewritten, /d="M 1 2 L 1 2 /);
  const parsed = parseStoredSvg(rewritten);
  assert.equal(parsed.board["line-1"]._children.length, 3);
});
