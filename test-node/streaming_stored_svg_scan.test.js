const test = require("node:test");
const assert = require("node:assert/strict");

const {
  StoredSvgElement,
  streamStoredSvgElements,
  streamStoredSvgStructure,
} = require("../server/persistence/streaming_stored_svg_scan.mjs");

/**
 * @param {string} value
 * @param {number} chunkSize
 * @returns {AsyncIterable<Buffer>}
 */
async function* chunkString(value, chunkSize) {
  const buffer = Buffer.from(value);
  for (let index = 0; index < buffer.length; index += chunkSize) {
    yield buffer.subarray(index, index + chunkSize);
  }
}

test("streamStoredSvgStructure preserves chunked drawing-area structure as buffers", async () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";

  /** @type {Array<any>} */
  const events = [];
  for await (const event of streamStoredSvgStructure(chunkString(svg, 7))) {
    events.push(event);
  }

  assert.deepEqual(
    events.slice(0, 3).map((event) => event.type),
    ["prefix", "item", "suffix"],
  );
  assert.ok(events.slice(3).every((event) => event.type === "tail"));
  assert.equal(events[1]?.id, "rect-1");
  assert.equal(events[1]?.readNumberAttr("stroke-width"), 4);

  const rebuilt = Buffer.concat(
    events.map((event) => {
      switch (event.type) {
        case "prefix":
          return event.prefix;
        case "item":
          return event.sourceBuffer;
        case "suffix":
          return event.sourceBuffer;
        case "tail":
          return event.chunk;
        default:
          return Buffer.alloc(0);
      }
    }),
  ).toString("utf8");

  assert.equal(rebuilt, svg);
});

test("streamStoredSvgElements yields buffer-backed element instances with lazy readers", async () => {
  const svg =
    '<svg data-wbo-seq="1"><g id="drawingArea">' +
    '<text id="text-1" x="1" y="2" font-size="3" fill="#000">hello &amp; bye</text>' +
    '<path id="path-1" d="M 1 2 l 0 0 l 3 4" stroke="#123456" stroke-width="5" fill="none"></path>' +
    "</g></svg>";

  const elements = [];
  for await (const element of streamStoredSvgElements(chunkString(svg, 11))) {
    elements.push(element);
  }

  assert.equal(elements.length, 2);
  const text = elements[0];
  const path = elements[1];
  assert.ok(text instanceof StoredSvgElement);
  assert.equal(text.tagName, "text");
  assert.ok(path);
  assert.equal(text.id, "text-1");
  assert.equal(text.readNumberAttr("font-size"), 3);
  assert.equal(text.readStringAttr("fill"), "#000");
  assert.equal(text.readTextContent(), "hello & bye");
  assert.equal(text.readDecodedTextLength(), 11);
  assert.equal("rawAttributes" in text, false);
  assert.ok(Buffer.isBuffer(text.contentBuffer));

  assert.deepEqual(
    [...path.readSvgPathAttr()],
    [
      { x: 1, y: 2 },
      { x: 1, y: 2 },
      { x: 4, y: 6 },
    ],
  );
  assert.deepEqual(path.scanSvgPathAttr(), {
    childCount: 2,
    localBounds: { minX: 1, minY: 2, maxX: 4, maxY: 6 },
    lastPoint: { x: 4, y: 6 },
  });
});
