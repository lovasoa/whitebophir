const test = require("node:test");
const assert = require("node:assert/strict");

const {
  streamStoredSvgStructure,
} = require("../server/persistence/streaming_stored_svg_scan.mjs");

/**
 * @param {string} value
 * @param {number} chunkSize
 * @returns {AsyncIterable<string>}
 */
async function* chunkString(value, chunkSize) {
  for (let index = 0; index < value.length; index += chunkSize) {
    yield value.slice(index, index + chunkSize);
  }
}

test("streamStoredSvgStructure tolerates chunked closing tags around the drawing area suffix", async () => {
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
  assert.equal(events[1]?.entry?.id, "rect-1");

  const rebuilt = events
    .map((event) => {
      switch (event.type) {
        case "prefix":
          return event.prefix;
        case "item":
          return event.leadingText + event.entry.raw;
        case "suffix":
          return event.leadingText + event.suffix;
        case "tail":
          return event.chunk;
        default:
          return "";
      }
    })
    .join("");

  assert.equal(rebuilt, svg);
});

test("streamStoredSvgStructure can skip rewrite-only raw text", async () => {
  const svg =
    '<svg id="canvas" data-wbo-seq="1">' +
    '<g id="drawingArea">\n' +
    '<text id="text-1" x="1" y="2" font-size="3" fill="#000000">hello</text>' +
    "</g></svg>";

  /** @type {Array<any>} */
  const events = [];
  for await (const event of streamStoredSvgStructure(chunkString(svg, 11), {
    includeLeadingText: false,
    includeRaw: false,
  })) {
    events.push(event);
  }

  const item = events.find((event) => event.type === "item");
  const suffix = events.find((event) => event.type === "suffix");

  assert.equal(item?.leadingText, "");
  assert.equal(item?.entry.raw, "");
  assert.equal(item?.entry.content, "hello");
  assert.equal(item?.entry.id, "text-1");
  assert.equal(suffix?.suffix, "");
});
