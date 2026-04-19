const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStoredSvgItem,
  scanPathSummary,
  serializeStoredSvgItem,
  summarizeStoredSvgItem,
} = require("../server/stored_svg_item_codec.mjs");
const {
  makeStoredPencilEntry,
  makeStoredTextEntry,
} = require("./svg_persistence_fixtures.js");

test("stored svg item codec parses canonical shape and text tags without shadow json", () => {
  assert.deepEqual(
    parseStoredSvgItem({
      tagName: "rect",
      attributes: {
        id: "rect-1",
        x: "5",
        y: "7",
        width: "11",
        height: "13",
        stroke: "#123456",
        "stroke-width": "4",
        opacity: "0.6",
      },
      content: "",
    }),
    {
      id: "rect-1",
      tool: "Rectangle",
      x: 5,
      y: 7,
      x2: 16,
      y2: 20,
      color: "#123456",
      size: 4,
      opacity: 0.6,
    },
  );

  assert.deepEqual(parseStoredSvgItem(makeStoredTextEntry()), {
    id: "text-1",
    tool: "Text",
    x: 9,
    y: 10,
    color: "#654321",
    size: 18,
    txt: "hello & bye",
  });
});

test("stored svg item codec derives pencil points from the canonical d attribute", () => {
  assert.deepEqual(parseStoredSvgItem(makeStoredPencilEntry()), {
    id: "line-1",
    tool: "Pencil",
    color: "#000000",
    size: 3,
    _children: [
      { x: 1, y: 2 },
      { x: 10, y: 12 },
      { x: 18, y: 9 },
    ],
  });
});

test("stored svg item codec scans path summaries without hydrating points", () => {
  assert.deepEqual(scanPathSummary("M 1 2 l 0 0 l 9 10 l 8 -3"), {
    childCount: 3,
    localBounds: {
      minX: 1,
      minY: 2,
      maxX: 18,
      maxY: 12,
    },
  });
  assert.deepEqual(scanPathSummary(""), {
    childCount: 0,
    localBounds: null,
  });
});

test("stored svg item summaries stay payload-light for cold loads", () => {
  assert.deepEqual(
    summarizeStoredSvgItem(
      makeStoredTextEntry({ transform: "matrix(1 0 0 1 7 8)" }),
      2,
    ),
    {
      id: "text-1",
      tool: "Text",
      paintOrder: 2,
      data: {
        x: 9,
        y: 10,
        size: 18,
        color: "#654321",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 },
      },
      textLength: 11,
      localBounds: {
        minX: 9,
        minY: -8,
        maxX: 207,
        maxY: 10,
      },
    },
  );

  assert.deepEqual(summarizeStoredSvgItem(makeStoredPencilEntry(), 3), {
    id: "line-1",
    tool: "Pencil",
    paintOrder: 3,
    data: {
      color: "#000000",
      size: 3,
    },
    childCount: 3,
    localBounds: {
      minX: 1,
      minY: 2,
      maxX: 18,
      maxY: 12,
    },
  });
});

test("stored svg item codec serializes canonical visible svg without duplicated state", () => {
  const rect = serializeStoredSvgItem({
    id: "rect-1",
    tool: "Rectangle",
    x: 5,
    y: 7,
    x2: 16,
    y2: 20,
    color: "#123456",
    size: 4,
    opacity: 0.6,
  });
  assert.match(
    rect,
    /^<rect id="rect-1" x="5" y="7" width="11" height="13" stroke="#123456" stroke-width="4" fill="none" opacity="0.6"><\/rect>$/,
  );
  assert.doesNotMatch(
    rect,
    /data-wbo-item|data-wbo-tool|data-wbo-x|data-wbo-y/,
  );

  const pencil = serializeStoredSvgItem({
    id: "line-1",
    tool: "Pencil",
    color: "#000000",
    size: 2,
    _children: [
      { x: 1, y: 2 },
      { x: 10, y: 12 },
      { x: 18, y: 9 },
    ],
  });
  assert.match(
    pencil,
    /^<path id="line-1" d="M 1 2 l 0 0 l 9 10 l 8 -3" stroke="#000000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><\/path>$/,
  );
  assert.doesNotMatch(pencil, /data-wbo-item|data-wbo-tool|_children/);
});
