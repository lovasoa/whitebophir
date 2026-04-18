const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStoredSvgItem,
  scanPathSummary,
  serializeStoredSvgItem,
} = require("../server/stored_svg_item_codec.mjs");

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

  assert.deepEqual(
    parseStoredSvgItem({
      tagName: "text",
      attributes: {
        id: "text-1",
        x: "9",
        y: "10",
        fill: "#654321",
        "font-size": "18",
      },
      content: "hello &amp; bye",
    }),
    {
      id: "text-1",
      tool: "Text",
      x: 9,
      y: 10,
      color: "#654321",
      size: 18,
      txt: "hello & bye",
    },
  );
});

test("stored svg item codec derives pencil points from the canonical d attribute", () => {
  assert.deepEqual(
    parseStoredSvgItem({
      tagName: "path",
      attributes: {
        id: "line-1",
        d: "M 1 2 L 1 2 C 1 2 10 12 10 12 C 11 13 18 9 18 9",
        stroke: "#000000",
        "stroke-width": "3",
      },
      content: "",
    }),
    {
      id: "line-1",
      tool: "Pencil",
      color: "#000000",
      size: 3,
      _children: [
        { x: 1, y: 2 },
        { x: 10, y: 12 },
        { x: 18, y: 9 },
      ],
    },
  );
});

test("stored svg item codec scans path summaries without hydrating points", () => {
  assert.deepEqual(
    scanPathSummary("M 1 2 L 1 2 C 1 2 10 12 10 12 C 11 13 18 9 18 9"),
    {
      childCount: 3,
      localBounds: {
        minX: 1,
        minY: 2,
        maxX: 18,
        maxY: 12,
      },
    },
  );
  assert.deepEqual(scanPathSummary(""), {
    childCount: 0,
    localBounds: null,
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
    /^<path id="line-1" d="M 1 2 L 1 2 C [^"]+" stroke="#000000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><\/path>$/,
  );
  assert.doesNotMatch(pencil, /data-wbo-item|data-wbo-tool|_children/);
});
