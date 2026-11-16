const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

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

test("streamStoredSvgStructure can leave untouched item details opaque", async () => {
  const svg =
    '<svg data-wbo-seq="1"><g id="drawingArea">' +
    '<text id="text-1" x="1" y="2" font-size="3" fill="#000">hello</text>' +
    "</g></svg>";

  const events = [];
  for await (const event of streamStoredSvgStructure(chunkString(svg, 11), {
    materializeEntryDetails: false,
  })) {
    events.push(event);
  }

  const item = events.find((event) => event.type === "item")?.entry;
  assert.equal(item?.id, "text-1");
  assert.equal(item?.raw.includes(">hello<"), true);
  assert.equal(item?.rawAttributes, undefined);
  assert.equal(item?.content, undefined);
});

test("summary and rewrite scans reject the same broken drawing structure", async () => {
  for (const materializeEntryDetails of [true, false]) {
    for (const drawing of [
      '<g><rect id="nested"></rect></g></g>',
      '<polygon id="unsupported"></polygon></g>',
      '<constructor id="prototype"></constructor></g>',
      '<toString id="prototype"></toString></g>',
      '<__proto__ id="prototype"></__proto__></g>',
      '<rect id="unclosed">',
      '<rect id="wrong-close"></ellipse></g>',
    ]) {
      await assert.rejects(async () => {
        for await (const _ of streamStoredSvgStructure(
          chunkString(`<svg><g id="drawingArea">${drawing}</svg>`, 3),
          { materializeEntryDetails },
        )) {
          // Consume the whole document so a truncated final item cannot pass.
        }
      });
    }
  }
});

test("structural scans close their source after a metadata read or parse failure", async () => {
  for (const metadataOnly of [true, false]) {
    const source = Readable.from([
      '<svg><g id="drawingArea">',
      '<unsupported id="broken"></unsupported></g></svg>',
    ]);
    const consume = async () => {
      for await (const event of streamStoredSvgStructure(source)) {
        if (metadataOnly && event.type === "prefix") break;
      }
    };
    if (metadataOnly) await consume();
    else await assert.rejects(consume(), /Unexpected direct child/);
    assert.equal(source.destroyed, true);
  }
});
