const test = require("node:test");
const assert = require("node:assert/strict");

const { rewriteStoredSvg } = require("../server/stored_svg_rewrite.mjs");
const { parseStoredSvg } = require("../server/svg_board_store.mjs");
const {
  streamingUpdate,
} = require("../server/streaming_stored_svg_update.mjs");

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

/**
 * @param {AsyncIterable<string>} input
 * @returns {Promise<string>}
 */
async function collect(input) {
  let output = "";
  for await (const chunk of input) {
    output += chunk;
  }
  return output;
}

test("streaming stored svg update rewrites touched items and appends creates without full-text parsing", async () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="keep"></marker></defs>' +
    '<g id="drawingArea">' +
    '<path id="item-0" d="M 1 2 L 1 2 C 1 2 3 4 3 4" stroke="#123456" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '<text id="item-2" x="3" y="4" font-size="18" fill="#654321">hello</text>' +
    '<rect id="item-3" x="5" y="6" width="4" height="6" stroke="#123456" stroke-width="2" fill="none"></rect>' +
    '<ellipse id="item-4" cx="12" cy="22" rx="2" ry="2" stroke="#123456" stroke-width="2" fill="none"></ellipse>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";
  const mutations = [
    {
      mutation: {
        tool: "Rectangle",
        type: "update",
        id: "item-3",
        x2: 15,
        y2: 18,
      },
    },
    {
      mutation: {
        tool: "Text",
        type: "update",
        id: "item-2",
        txt: "hello streaming",
      },
    },
    {
      mutation: {
        tool: "Pencil",
        type: "child",
        parent: "item-0",
        x: 4,
        y: 2,
      },
    },
    {
      mutation: {
        tool: "Hand",
        type: "copy",
        id: "item-3",
        newid: "item-3-copy",
      },
    },
    {
      mutation: {
        tool: "Rectangle",
        type: "rect",
        id: "item-new",
        color: "#abcdef",
        size: 3,
        x: 20,
        y: 21,
        x2: 28,
        y2: 29,
      },
    },
  ];

  const expected = rewriteStoredSvg(svg, { readonly: false }, 5, mutations);
  /** @type {{parsedExistingItems?: number}} */
  const stats = {};
  const actual = await collect(
    streamingUpdate(
      chunkString(svg, 17),
      mutations.map((entry) => entry.mutation),
      { metadata: { readonly: false }, toSeqInclusive: 5, stats },
    ),
  );

  assert.deepEqual(parseStoredSvg(actual), parseStoredSvg(expected));
  assert.equal(stats.parsedExistingItems, 3);
  assert.equal(actual.includes('id="item-4"'), true);
});

test("streaming stored svg update matches clear and same-batch followup semantics", async () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<path id="line-1" d="M 1 2" stroke="#123456" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '<rect id="rect-old" x="5" y="6" width="4" height="6" stroke="#123456" stroke-width="2" fill="none"></rect>' +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";
  const mutations = [
    {
      mutation: {
        tool: "Hand",
        type: "copy",
        id: "line-1",
        newid: "line-2",
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
    {
      mutation: {
        tool: "Clear",
        type: "clear",
      },
    },
    {
      mutation: {
        tool: "Rectangle",
        type: "rect",
        id: "rect-new",
        color: "#abcdef",
        size: 3,
        x: 20,
        y: 21,
        x2: 24,
        y2: 26,
      },
    },
    {
      mutation: {
        tool: "Rectangle",
        type: "update",
        id: "rect-new",
        x2: 28,
        y2: 29,
      },
    },
  ];

  const expected = rewriteStoredSvg(svg, { readonly: false }, 6, mutations);
  /** @type {{parsedExistingItems?: number}} */
  const stats = {};
  const actual = await collect(
    streamingUpdate(
      chunkString(svg, 11),
      mutations.map((entry) => entry.mutation),
      { metadata: { readonly: false }, toSeqInclusive: 6, stats },
    ),
  );

  assert.deepEqual(parseStoredSvg(actual), parseStoredSvg(expected));
  assert.equal(stats.parsedExistingItems, 0);
  assert.equal(actual.includes('id="rect-old"'), false);
  assert.equal(actual.includes('id="line-2"'), false);
  assert.equal(actual.includes('id="rect-new"'), true);
});
