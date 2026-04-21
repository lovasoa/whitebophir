const test = require("node:test");
const assert = require("node:assert/strict");

const { parseStoredSvgItem } = require("../server/stored_svg_item_codec.mjs");
const {
  streamingUpdate,
} = require("../server/streaming_stored_svg_update.mjs");
const {
  parseStoredSvgEnvelope,
  parseStoredSvgItems,
} = require("../server/svg_envelope.mjs");

/**
 * @param {string} svg
 * @returns {{board: {[name: string]: any}, metadata: {readonly: boolean}, seq: number}}
 */
function parseStoredSvg(svg) {
  const envelope = parseStoredSvgEnvelope(svg);
  /** @type {{[name: string]: any}} */
  const board = {};
  for (const itemEntry of parseStoredSvgItems(envelope.drawingAreaContent)) {
    const item = parseStoredSvgItem(itemEntry);
    if (item?.id) {
      board[item.id] = item;
    }
  }
  return {
    board,
    metadata: {
      readonly: envelope.rootAttributes["data-wbo-readonly"] === "true",
    },
    seq: Number(envelope.rootAttributes["data-wbo-seq"]) || 0,
  };
}

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

/**
 * @param {string} svg
 * @param {any[]} mutations
 * @param {{readonly: boolean}} metadata
 * @param {number} toSeqInclusive
 * @param {number} chunkSize
 * @param {{parsedExistingItems?: number}=} [stats]
 * @returns {Promise<string>}
 */
function rewriteViaStreaming(
  svg,
  mutations,
  metadata,
  toSeqInclusive,
  chunkSize,
  stats,
) {
  return collect(
    streamingUpdate(
      chunkString(svg, chunkSize),
      mutations.map((entry) => entry.mutation),
      { metadata, toSeqInclusive, stats },
    ),
  );
}

test("streaming stored svg update rewrites touched items and appends creates without full-text parsing", async () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="keep"></marker></defs>' +
    '<g id="drawingArea">' +
    '<path id="item-0" d="M 1 2 l 0 0 l 2 2" stroke="#123456" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '<text id="item-2" x="3" y="4" font-size="18" fill="#654321">hello</text>' +
    '<rect id="item-3" x="5" y="6" width="4" height="6" stroke="#123456" stroke-width="2" fill="none"></rect>' +
    '<ellipse id="item-4" cx="12" cy="22" rx="2" ry="2" stroke="#123456" stroke-width="2" fill="none"></ellipse>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";
  const mutations = [
    {
      mutation: {
        tool: "rectangle",
        type: "update",
        id: "item-3",
        x2: 15,
        y2: 18,
      },
    },
    {
      mutation: {
        tool: "text",
        type: "update",
        id: "item-2",
        txt: "hello streaming",
      },
    },
    {
      mutation: {
        tool: "pencil",
        type: "child",
        parent: "item-0",
        x: 4,
        y: 2,
      },
    },
    {
      mutation: {
        tool: "hand",
        type: "copy",
        id: "item-3",
        newid: "item-3-copy",
      },
    },
    {
      mutation: {
        tool: "rectangle",
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

  /** @type {{parsedExistingItems?: number}} */
  const stats = {};
  const actual = await rewriteViaStreaming(
    svg,
    mutations,
    { readonly: false },
    5,
    17,
    stats,
  );
  const parsed = parseStoredSvg(actual);

  assert.equal(parsed.board["item-3"].x2, 15);
  assert.equal(parsed.board["item-2"].txt, "hello streaming");
  assert.equal(parsed.board["item-0"]._children.length, 3);
  assert.equal(parsed.board["item-3-copy"].tool, "rectangle");
  assert.equal(parsed.board["item-new"].tool, "rectangle");
  assert.deepEqual(Object.keys(parsed.board), [
    "item-0",
    "item-2",
    "item-3",
    "item-4",
    "item-3-copy",
    "item-new",
  ]);
  assert.equal(stats.parsedExistingItems, 3);
  assert.equal(actual.includes('id="item-4"'), true);
});

test("streaming stored svg update matches clear and same-batch followup semantics", async () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="1" data-wbo-readonly="false">' +
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
        tool: "hand",
        type: "copy",
        id: "line-1",
        newid: "line-2",
      },
    },
    {
      mutation: {
        tool: "pencil",
        type: "child",
        parent: "line-2",
        x: 9,
        y: 10,
      },
    },
    {
      mutation: {
        tool: "clear",
        type: "clear",
      },
    },
    {
      mutation: {
        tool: "rectangle",
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
        tool: "rectangle",
        type: "update",
        id: "rect-new",
        x2: 28,
        y2: 29,
      },
    },
  ];

  /** @type {{parsedExistingItems?: number}} */
  const stats = {};
  const actual = await rewriteViaStreaming(
    svg,
    mutations,
    { readonly: false },
    6,
    11,
    stats,
  );
  const parsed = parseStoredSvg(actual);

  assert.deepEqual(Object.keys(parsed.board), ["rect-new"]);
  assert.equal(parsed.board["rect-new"].x2, 28);
  assert.equal(parsed.board["rect-new"].y2, 29);
  assert.equal(stats.parsedExistingItems, 0);
  assert.equal(actual.includes('id="rect-old"'), false);
  assert.equal(actual.includes('id="line-2"'), false);
  assert.equal(actual.includes('id="rect-new"'), true);
});

test("streaming stored svg update preserves shell and paint order across create update copy and delete", async () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="keep"></marker></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";
  const actual = await rewriteViaStreaming(
    svg,
    [
      {
        mutation: {
          tool: "ellipse",
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
          tool: "rectangle",
          type: "update",
          id: "rect-1",
          x2: 30,
          y2: 40,
        },
      },
      {
        mutation: {
          tool: "hand",
          type: "copy",
          id: "rect-1",
          newid: "rect-2",
        },
      },
      {
        mutation: {
          tool: "eraser",
          type: "delete",
          id: "text-1",
        },
      },
    ],
    { readonly: true },
    5,
    13,
  );
  const parsed = parseStoredSvg(actual);

  assert.match(actual, /<marker id="keep"><\/marker><\/defs>/);
  assert.match(
    actual,
    /<g id="cursors"><path id="cursor-template"><\/path><\/g>/,
  );
  assert.match(actual, /data-wbo-seq="5"/);
  assert.match(actual, /data-wbo-readonly="true"/);
  assert.equal(parsed.board["rect-1"].x2, 30);
  assert.equal(parsed.board["ellipse-1"].tool, "ellipse");
  assert.equal(parsed.board["rect-2"].tool, "rectangle");
  assert.deepEqual(Object.keys(parsed.board), [
    "rect-1",
    "ellipse-1",
    "rect-2",
  ]);
});

test("streaming stored svg update preserves untouched bytes and the opaque prefix of touched pencil paths", async () => {
  const untouchedPath =
    '<path id="line-1" d="M 1 2 l 0 0 l 2 2" stroke="#123456" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>';
  const untouchedEllipse =
    '<ellipse id="ellipse-1" cx="12" cy="22" rx="2" ry="2" stroke="#123456" stroke-width="2" fill="none"></ellipse>';
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    untouchedPath +
    untouchedEllipse +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";
  const actual = await rewriteViaStreaming(
    svg,
    [
      {
        mutation: {
          tool: "rectangle",
          type: "update",
          id: "rect-1",
          x2: 30,
          y2: 40,
        },
      },
      {
        mutation: {
          tool: "pencil",
          type: "child",
          parent: "line-1",
          x: 9,
          y: 10,
        },
      },
    ],
    { readonly: false },
    2,
    19,
  );
  const parsed = parseStoredSvg(actual);

  assert.match(
    actual,
    /<rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"><\/rect>/,
  );
  assert.match(actual, /d="M 1 2/);
  assert.equal(actual.includes(untouchedEllipse), true);
  assert.equal(parsed.board["line-1"]._children.length, 3);
});
