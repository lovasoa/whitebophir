const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { withEnv } = require("./test_helpers.js");

const svgEnvelope = require("../server/svg_envelope.mjs");
const svgBoardStore = require("../server/svg_board_store.mjs");
const legacyJsonBoardSource = require("../server/legacy_json_board_source.mjs");
const storedSvgItemCodec = require("../server/stored_svg_item_codec.mjs");
const { copyCanonicalItem } = require("../server/canonical_board_items.mjs");

/**
 * @param {string} boardName
 * @param {string} historyDir
 * @returns {string}
 */
function svgPath(boardName, historyDir) {
  return svgBoardStore.boardSvgPath(boardName, historyDir);
}

/**
 * @param {string} boardName
 * @param {string} historyDir
 * @returns {string}
 */
function jsonPath(boardName, historyDir) {
  return svgBoardStore.boardJsonPath(boardName, historyDir);
}

/**
 * @param {string} boardName
 * @param {string} historyDir
 * @returns {Promise<any>}
 */
function readCanonicalBoardState(boardName, historyDir) {
  return svgBoardStore.readCanonicalBoardState(boardName, { historyDir });
}

/**
 * @param {string} boardName
 * @param {string} historyDir
 * @returns {Promise<string>}
 */
function readServedBaseline(boardName, historyDir) {
  return svgBoardStore.readServedBaseline(boardName, { historyDir });
}

/**
 * @param {string} boardName
 * @param {string} historyDir
 * @returns {Promise<any>}
 */
function readBoardDocumentState(boardName, historyDir) {
  return svgBoardStore.readBoardDocumentState(boardName, { historyDir });
}

/**
 * @param {string} boardName
 * @param {{[name: string]: any}} board
 * @param {{readonly: boolean}} metadata
 * @param {number} seq
 * @param {string} historyDir
 * @returns {Promise<void>}
 */
function writeBoardState(boardName, board, metadata, seq, historyDir) {
  return svgBoardStore.writeBoardState(boardName, board, metadata, seq, {
    historyDir,
  });
}

/**
 * @param {string} boardName
 * @param {Map<string, any>} itemsById
 * @param {string[]} paintOrder
 * @param {{readonly: boolean, seq?: number}} metadata
 * @param {Set<string>} persistedItemIds
 * @param {number} persistedSeq
 * @param {number} latestSeq
 * @param {string} historyDir
 * @returns {Promise<Set<string>>}
 */
function rewriteStoredSvgFromCanonical(
  boardName,
  itemsById,
  paintOrder,
  metadata,
  persistedItemIds,
  persistedSeq,
  latestSeq,
  historyDir,
) {
  return svgBoardStore.rewriteStoredSvgFromCanonical(
    boardName,
    itemsById,
    paintOrder,
    metadata,
    persistedItemIds,
    persistedSeq,
    latestSeq,
    { historyDir },
  );
}
/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {{[name: string]: string}} rootAttributes
 * @returns {number}
 */
function normalizeStoredSeq(rootAttributes) {
  const seq = Number(rootAttributes["data-wbo-seq"]);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
}

/**
 * @param {string} svg
 * @returns {{board: {[name: string]: any}, metadata: {readonly: boolean}, seq: number}}
 */
function parseStoredSvg(svg) {
  const envelope = svgEnvelope.parseStoredSvgEnvelope(svg);
  /** @type {{[name: string]: any}} */
  const board = {};
  for (const itemEntry of svgEnvelope.parseStoredSvgItems(
    envelope.drawingAreaContent,
  )) {
    const summary = storedSvgItemCodec.summarizeStoredSvgItem(itemEntry);
    if (!summary?.id) continue;
    if (summary.tool === "pencil") {
      board[summary.id] = {
        id: summary.id,
        tool: summary.tool,
        ...summary.data,
        d: itemEntry.attributes?.d,
        childCount: summary.childCount,
        localBounds: summary.localBounds,
      };
      continue;
    }
    const item = storedSvgItemCodec.parseStoredSvgItem(itemEntry);
    if (item?.id) board[item.id] = item;
  }
  return {
    board,
    metadata: {
      readonly: envelope.rootAttributes["data-wbo-readonly"] === "true",
    },
    seq: normalizeStoredSeq(envelope.rootAttributes),
  };
}

/**
 * @param {string} svg
 * @returns {{summaries: Map<string, any>, metadata: {readonly: boolean}, seq: number}}
 */
function summarizeStoredSvg(svg) {
  const envelope = svgEnvelope.parseStoredSvgEnvelope(svg);
  const summaries = new Map();
  let paintOrder = 0;
  for (const itemEntry of svgEnvelope.parseStoredSvgItems(
    envelope.drawingAreaContent,
  )) {
    const summary = storedSvgItemCodec.summarizeStoredSvgItem(
      itemEntry,
      paintOrder,
    );
    if (!summary?.id) continue;
    summaries.set(summary.id, summary);
    paintOrder += 1;
  }
  return {
    summaries,
    metadata: {
      readonly: envelope.rootAttributes["data-wbo-readonly"] === "true",
    },
    seq: normalizeStoredSeq(envelope.rootAttributes),
  };
}

/**
 * @param {string} boardName
 * @param {string} historyDir
 * @returns {Promise<{board: {[name: string]: any}, metadata: {readonly: boolean}, seq: number, source: "svg" | "json" | "empty"}>}
 */
async function readPersistedBoardState(boardName, historyDir) {
  try {
    return {
      ...parseStoredSvg(
        await fs.readFile(
          svgBoardStore.boardSvgPath(boardName, historyDir),
          "utf8",
        ),
      ),
      source: "svg",
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  try {
    const parsed = await legacyJsonBoardSource.readLegacyBoardState(boardName, {
      historyDir,
    });
    return {
      board: parsed.board,
      metadata: parsed.metadata,
      seq: 0,
      source: "json",
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  return {
    board: {},
    metadata: { readonly: false },
    seq: 0,
    source: "empty",
  };
}

test("parseStoredSvgEnvelope keeps non-drawing shell content opaque", () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="3" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="triangle"></marker></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="3" height="4" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    "</g>" +
    '<g id="cursors"><circle id="ghost"></circle></g>' +
    "</svg>";

  const envelope = svgEnvelope.parseStoredSvgEnvelope(svg);

  assert.match(
    envelope.prefix,
    /<defs id="defs"><marker id="triangle"><\/marker><\/defs><g id="drawingArea">$/,
  );
  assert.equal(
    envelope.drawingAreaContent,
    '<rect id="rect-1" x="1" y="2" width="3" height="4" stroke="#123456" stroke-width="4" fill="none"></rect>',
  );
  assert.match(
    envelope.suffix,
    /^<\/g><g id="cursors"><circle id="ghost"><\/circle><\/g><\/svg>$/,
  );
});

test("parseStoredSvgItems returns canonical direct children without touching the shell", () => {
  const items = svgEnvelope.parseStoredSvgItems(
    '<rect id="rect-1" x="1" y="2" width="3" height="4" stroke="#123456" stroke-width="4" fill="none"></rect>' +
      '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello &amp; bye</text>',
  );

  assert.deepEqual(items, [
    {
      raw: '<rect id="rect-1" x="1" y="2" width="3" height="4" stroke="#123456" stroke-width="4" fill="none"></rect>',
      tagName: "rect",
      content: "",
      attributes: {
        id: "rect-1",
        x: "1",
        y: "2",
        width: "3",
        height: "4",
        stroke: "#123456",
        "stroke-width": "4",
        fill: "none",
      },
    },
    {
      raw: '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello &amp; bye</text>',
      tagName: "text",
      content: "hello &amp; bye",
      attributes: {
        id: "text-1",
        x: "5",
        y: "6",
        "font-size": "18",
        fill: "#654321",
      },
    },
  ]);
});

test("updateRootMetadata rewrites only root metadata attributes", () => {
  const prefix =
    '<svg id="canvas" width="800" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="2" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="keep"></marker></defs>' +
    '<g id="drawingArea">';

  const updated = svgEnvelope.updateRootMetadata(prefix, { readonly: true }, 9);

  assert.match(updated, /data-wbo-seq="9"/);
  assert.match(updated, /data-wbo-readonly="true"/);
  assert.match(
    updated,
    /<marker id="keep"><\/marker><\/defs><g id="drawingArea">$/,
  );
  assert.match(updated, /width="800"/);
});

test("writeBoardState preserves opaque shell while rewriting stored items", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-preserve-"),
  );
  const boardName = "opaque-shell";
  const existingSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="777" height="888" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"><style>.keep-me{}</style><marker id="m1"></marker></defs>' +
    '<g id="drawingArea">' +
    '<rect id="old-item" x="0" y="0" width="10" height="10" stroke="#000000" stroke-width="1" fill="none"></rect>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(svgPath(boardName, historyDir), existingSvg, "utf8");
    await writeBoardState(
      boardName,
      {
        "line-1": {
          id: "line-1",
          tool: "straight-line",
          x: 10,
          y: 20,
          x2: 40,
          y2: 60,
          color: "#123456",
          size: 4,
          opacity: 0.6,
        },
        "text-1": {
          id: "text-1",
          tool: "text",
          x: 5,
          y: 7,
          size: 20,
          color: "#654321",
          opacity: 0.7,
          txt: "hello",
        },
      },
      { readonly: true },
      12,
      historyDir,
    );

    const rewritten = await fs.readFile(svgPath(boardName, historyDir), "utf8");
    assert.match(
      rewritten,
      /<style>\.keep-me\{\}<\/style><marker id="m1"><\/marker><\/defs>/,
    );
    assert.match(
      rewritten,
      /<g id="cursors"><path id="cursor-template"><\/path><\/g>/,
    );
    assert.match(rewritten, /data-wbo-seq="12"/);
    assert.match(rewritten, /data-wbo-readonly="true"/);
    const lineIndex = rewritten.indexOf('id="line-1"');
    const textIndex = rewritten.indexOf('id="text-1"');
    assert.ok(lineIndex !== -1);
    assert.ok(textIndex !== -1);
    assert.ok(lineIndex < textIndex);
  });
});

test("local persisted-board helper falls back to legacy json when svg is absent", {
  concurrency: false,
}, async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-json-fallback-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      jsonPath("legacy-board", historyDir),
      JSON.stringify({
        __wbo_meta__: { readonly: true },
        "rect-1": {
          id: "rect-1",
          tool: "rectangle",
          type: "rect",
          x: 1,
          y: 2,
          x2: 3,
          y2: 4,
          color: "#abcdef",
          size: 5,
        },
      }),
      "utf8",
    );

    const state = await readPersistedBoardState("legacy-board", historyDir);

    assert.equal(state.source, "json");
    assert.equal(state.metadata.readonly, true);
    assert.equal(state.seq, 0);
    assert.equal(state.board["rect-1"].tool, "rectangle");
  });
});

test("local persisted-board helper prefers authoritative svg over stale legacy json", {
  concurrency: false,
}, async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-svg-preferred-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      jsonPath("svg-preferred", historyDir),
      JSON.stringify({
        "rect-json": {
          id: "rect-json",
          tool: "rectangle",
          x: 0,
          y: 0,
          x2: 1,
          y2: 1,
          color: "#000000",
          size: 1,
        },
      }),
      "utf8",
    );
    await writeBoardState(
      "svg-preferred",
      {
        "rect-svg": {
          id: "rect-svg",
          tool: "rectangle",
          type: "rect",
          x: 10,
          y: 20,
          x2: 30,
          y2: 40,
          color: "#123456",
          size: 4,
        },
      },
      { readonly: true },
      7,
      historyDir,
    );

    const state = await readPersistedBoardState("svg-preferred", historyDir);

    assert.equal(state.source, "svg");
    assert.equal(state.metadata.readonly, true);
    assert.equal(state.seq, 7);
    assert.deepEqual(Object.keys(state.board), ["rect-svg"]);
  });
});

test("readCanonicalBoardState reports svg byte length and canonical items", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-load-state-"),
  );
  const boardName = "load-state-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="7" data-wbo-readonly="true"><defs id="defs"></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(svgPath(boardName, historyDir), storedSvg, "utf8");

    const state = await readCanonicalBoardState(boardName, historyDir);

    assert.equal(state.source, "svg");
    assert.equal(state.byteLength, storedSvg.length);
    assert.deepEqual(state.paintOrder, ["rect-1"]);
    assert.equal(state.itemsById.get("rect-1")?.tool, "rectangle");
  });
});

test("readCanonicalBoardState streams root metadata for empty drawing areas", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-load-state-empty-"),
  );
  const boardName = "load-state-empty-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="9" data-wbo-readonly="true"><defs id="defs"></defs><g id="drawingArea"></g><g id="cursors"></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(svgPath(boardName, historyDir), storedSvg, "utf8");

    const state = await readCanonicalBoardState(boardName, historyDir);

    assert.equal(state.source, "svg");
    assert.equal(state.byteLength, storedSvg.length);
    assert.equal(state.seq, 9);
    assert.equal(state.metadata.readonly, true);
    assert.equal(state.itemsById.size, 0);
  });
});

test("readCanonicalBoardState falls back to the backup svg when the primary file is missing", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-load-backup-"),
  );
  const boardName = "load-state-backup-svg";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await writeBoardState(
      boardName,
      {
        "rect-1": {
          id: "rect-1",
          tool: "rectangle",
          x: 1,
          y: 2,
          x2: 30,
          y2: 40,
          color: "#123456",
          size: 4,
        },
      },
      { readonly: true },
      7,
      historyDir,
    );
    await fs.unlink(svgPath(boardName, historyDir));

    const state = await readCanonicalBoardState(boardName, historyDir);
    const servedBaseline = await readServedBaseline(boardName, historyDir);

    assert.equal(state.source, "svg_backup");
    assert.deepEqual(state.paintOrder, ["rect-1"]);
    assert.equal(state.itemsById.get("rect-1")?.tool, "rectangle");
    assert.match(servedBaseline, /id="rect-1"/);
  });
});

test("readServedBaseline returns stored svg bytes unchanged when svg exists", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-served-opaque-"),
  );
  const boardName = "served-opaque";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="7" data-wbo-readonly="true"><defs id="defs"><marker id="keep"></marker></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"><path id="cursor-template"></path></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(svgPath(boardName, historyDir), storedSvg, "utf8");

    assert.equal(await readServedBaseline(boardName, historyDir), storedSvg);
  });
});

test("readBoardDocumentState returns metadata and streaming source details for stored svg boards", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-document-state-"),
  );
  const boardName = "document-state-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="7" data-wbo-readonly="true"><defs id="defs"><marker id="keep"></marker></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"><path id="cursor-template"></path></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(svgPath(boardName, historyDir), storedSvg, "utf8");

    const state = await readBoardDocumentState(boardName, historyDir);

    assert.deepEqual(state.metadata, { readonly: true, seq: 7 });
    assert.equal(state.source, "svg");
    assert.equal(state.byteLength, Buffer.byteLength(storedSvg));
    assert.equal(state.inlineBoardSvg, null);
  });
});

test("readBoardDocumentState falls back to legacy json metadata and generated inline rendering", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-document-state-json-"),
  );
  const boardName = "document-state-json";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      jsonPath(boardName, historyDir),
      JSON.stringify({
        __wbo_meta__: { readonly: true },
        "rect-1": {
          id: "rect-1",
          tool: "rectangle",
          x: 1,
          y: 2,
          x2: 30,
          y2: 40,
          color: "#123456",
          size: 4,
        },
      }),
      "utf8",
    );

    const state = await readBoardDocumentState(boardName, historyDir);

    assert.deepEqual(state.metadata, { readonly: true, seq: 0 });
    assert.equal(state.source, "generated");
    assert.equal(state.byteLength, 0);
    assert.ok(state.inlineBoardSvg);
    assert.match(state.inlineBoardSvg, /data-wbo-readonly="true"/);
    assert.match(state.inlineBoardSvg, /id="rect-1"/);
  });
});

test("readCanonicalBoardState eagerly loads canonical stored svg items", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-parse-items-svg-"),
  );
  const boardName = "parse-items-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="4" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    '<text id="text-1" x="5" y="6" font-size="18" fill="#654321" transform="matrix(1 0 0 1 7 8)">hello</text>' +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(svgPath(boardName, historyDir), storedSvg, "utf8");

    const state = await readCanonicalBoardState(boardName, historyDir);

    assert.deepEqual(state.paintOrder, ["rect-1", "text-1"]);
    const item = state.itemsById.get("text-1");
    assert.equal(item?.tool, "text");
    assert.deepEqual(item?.attrs, {
      x: 5,
      y: 6,
      size: 18,
      color: "#654321",
    });
    assert.deepEqual(item?.transform, { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 });
    assert.equal(item?.textLength, 5);
    assert.deepEqual(item?.payload, { kind: "text" });
  });
});

test("local stored-svg summary helper derives minimal pencil summaries", () => {
  const summary = summarizeStoredSvg(
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="4" data-wbo-readonly="false">' +
      '<defs id="defs"></defs>' +
      '<g id="drawingArea">' +
      '<path id="line-1" d="M 1 2 l 2 2 l 5 5" stroke="#123456" stroke-width="4" fill="none" transform="matrix(1 0 0 1 7 8)"></path>' +
      '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>' +
      "</g>" +
      '<g id="cursors"></g>' +
      "</svg>",
  );

  assert.equal(summary.seq, 4);
  assert.equal(summary.metadata.readonly, false);
  assert.deepEqual(summary.summaries.get("line-1"), {
    id: "line-1",
    tool: "pencil",
    data: {
      color: "#123456",
      size: 4,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 },
    },
    childCount: 3,
    localBounds: { minX: 1, minY: 2, maxX: 8, maxY: 9 },
    paintOrder: 0,
  });
  assert.deepEqual(summary.summaries.get("text-1"), {
    id: "text-1",
    tool: "text",
    data: {
      x: 5,
      y: 6,
      size: 18,
      color: "#654321",
    },
    textLength: 5,
    localBounds: {
      minX: 5,
      minY: -12,
      maxX: 95,
      maxY: 6,
    },
    paintOrder: 1,
  });
});

test("readCanonicalBoardState migrates legacy json to svg before canonical load", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-parse-items-json-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      jsonPath("parse-items-json", historyDir),
      JSON.stringify({
        "rect-1": {
          id: "rect-1",
          tool: "Rectangle",
          x: 1,
          y: 2,
          x2: 3,
          y2: 4,
          color: "#abcdef",
          size: 5,
        },
        "text-1": {
          id: "text-1",
          tool: "Text",
          x: 5,
          y: 6,
          txt: "hello",
          size: 18,
          color: "#654321",
        },
      }),
      "utf8",
    );

    const state = await readCanonicalBoardState("parse-items-json", historyDir);

    assert.equal(state.source, "svg");
    assert.deepEqual(state.paintOrder, ["rect-1", "text-1"]);
    assert.equal(state.itemsById.get("rect-1")?.tool, "rectangle");
    assert.deepEqual(state.itemsById.get("text-1")?.payload, { kind: "text" });
    await assert.doesNotReject(() =>
      fs.access(svgPath("parse-items-json", historyDir)),
    );
    await assert.doesNotReject(() =>
      fs.access(jsonPath("parse-items-json", historyDir)),
    );
  });
});

test("readCanonicalBoardState keeps legacy json when migration cannot serialize items", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-parse-items-invalid-json-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const invalidJsonPath = jsonPath("parse-items-invalid-json", historyDir);
    await fs.writeFile(
      invalidJsonPath,
      JSON.stringify({
        "unknown-1": {
          id: "unknown-1",
          tool: "Unknown",
          x: 1,
          y: 2,
        },
      }),
      "utf8",
    );

    await assert.rejects(
      () => readCanonicalBoardState("parse-items-invalid-json", historyDir),
      /produced no SVG items/,
    );
    await assert.doesNotReject(() => fs.access(invalidJsonPath));
    await assert.rejects(() =>
      fs.access(svgPath("parse-items-invalid-json", historyDir)),
    );
  });
});

test("readCanonicalBoardState ignores childless legacy pencils during migration", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-childless-pencil-json-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      jsonPath("childless-pencil-json", historyDir),
      JSON.stringify({
        "pencil-1": {
          id: "pencil-1",
          tool: "Pencil",
          color: "#123456",
          size: 6,
        },
      }),
      "utf8",
    );

    const state = await readCanonicalBoardState(
      "childless-pencil-json",
      historyDir,
    );

    assert.equal(state.source, "svg");
    assert.deepEqual(state.paintOrder, []);
    assert.equal(state.itemsById.size, 0);
    await assert.doesNotReject(() =>
      fs.access(svgPath("childless-pencil-json", historyDir)),
    );
    await assert.doesNotReject(() =>
      fs.access(jsonPath("childless-pencil-json", historyDir)),
    );
  });
});

test("served svg baselines keep raw pencil paths for client-side smoothing", async () => {
  const points = [
    { x: 1, y: 2 },
    { x: 10, y: 12 },
    { x: 18, y: 9 },
    { x: 25, y: 30 },
  ];
  const legacyPoints = points.map((point) => ({
    x: point.x * 10,
    y: point.y * 10,
  }));
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-served-pencil-json-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      legacyJsonBoardSource.boardJsonPath("served-pencil-json", historyDir),
      JSON.stringify({
        "line-1": {
          id: "line-1",
          tool: "Pencil",
          type: "line",
          color: "#123456",
          size: 4,
          _children: points,
        },
      }),
      "utf8",
    );

    const svg = await readServedBaseline("served-pencil-json", historyDir);
    assert.match(
      svg,
      new RegExp(
        `d="${escapeRegExp(storedSvgItemCodec.renderPencilPath(legacyPoints))}"`,
      ),
    );
  });
});

test("stored svg preserves style state needed for authoritative rendering", {
  concurrency: false,
}, async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-style-state-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await writeBoardState(
      "style-state",
      {
        "rect-1": {
          id: "rect-1",
          tool: "rectangle",
          type: "rect",
          x: 1,
          y: 2,
          x2: 30,
          y2: 40,
          color: "#123456",
          size: 4,
          opacity: 0.6,
        },
        "text-1": {
          id: "text-1",
          tool: "text",
          type: "new",
          x: 5,
          y: 6,
          txt: "hello",
          size: 18,
          color: "#654321",
          opacity: 0.7,
        },
        "line-1": {
          id: "line-1",
          tool: "pencil",
          type: "line",
          color: "#abcdef",
          size: 5,
          opacity: 0.8,
          _children: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      },
      { readonly: false },
      11,
      historyDir,
    );

    const state = await readPersistedBoardState("style-state", historyDir);
    assert.deepEqual(state.board["rect-1"], {
      id: "rect-1",
      tool: "rectangle",
      x: 1,
      y: 2,
      x2: 30,
      y2: 40,
      color: "#123456",
      size: 4,
      opacity: 0.6,
    });
    assert.deepEqual(state.board["text-1"], {
      id: "text-1",
      tool: "text",
      x: 5,
      y: 6,
      txt: "hello",
      size: 18,
      color: "#654321",
      opacity: 0.7,
    });
    assert.deepEqual(state.board["line-1"], {
      id: "line-1",
      tool: "pencil",
      color: "#abcdef",
      size: 5,
      opacity: 0.8,
      d: "M 1 2 l 2 2",
      childCount: 2,
      localBounds: {
        minX: 1,
        minY: 2,
        maxX: 3,
        maxY: 4,
      },
    });
  });
});

test("rewriteStoredSvgFromCanonical reuses raw persisted pencil paths for copied entries", {
  concurrency: false,
}, async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-persisted-pencil-copy-"),
  );
  const boardName = "persisted-pencil-copy";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="5000" height="5000" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="4" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<path id="line-1" d="M 1 2 l 0 0 l 2 2" stroke="#123456" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>' +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(svgPath(boardName, historyDir), storedSvg, "utf8");

    const state = await readCanonicalBoardState(boardName, historyDir);
    const persistedItemIds = new Set(state.itemsById.keys());
    const persistedPencil = state.itemsById.get("line-1");
    assert.ok(persistedPencil);
    persistedPencil.payload.appendedChildren.push({ x: 9, y: 10 });
    persistedPencil.dirty = true;

    const copiedPencil = copyCanonicalItem(persistedPencil, "line-2", 2, 123);
    copiedPencil.copySource = { sourceId: "line-1" };
    state.itemsById.set("line-2", copiedPencil);
    state.paintOrder.push("line-2");

    persistedPencil.deleted = true;
    state.itemsById.set("line-1", persistedPencil);

    const persistedIds = await rewriteStoredSvgFromCanonical(
      boardName,
      state.itemsById,
      state.paintOrder,
      state.metadata,
      persistedItemIds,
      state.seq,
      state.seq + 1,
      historyDir,
    );
    const rewritten = await fs.readFile(svgPath(boardName, historyDir), "utf8");
    const persistedState = await readPersistedBoardState(boardName, historyDir);

    assert.deepEqual([...persistedIds], ["text-1", "line-2"]);
    assert.doesNotMatch(rewritten, /id="line-1"/);
    assert.match(
      rewritten,
      /<path id="line-2" d="M 1 2 l 0 0 l 2 2 l 6 6" stroke="#123456" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"><\/path>/,
    );
    assert.equal(persistedState.board["line-2"]?.d, "M 1 2 l 0 0 l 2 2 l 6 6");
    assert.equal(persistedState.board["line-2"]?.childCount, 3);
    assert.deepEqual(persistedState.board["line-2"]?.localBounds, {
      minX: 1,
      minY: 2,
      maxX: 9,
      maxY: 10,
    });
  });
});

test("rewriteStoredSvg rejects stored svg base-seq mismatches", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-rewrite-seq-mismatch-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await writeBoardState(
      "rewrite-seq-mismatch",
      {
        "rect-1": {
          id: "rect-1",
          tool: "rectangle",
          type: "rect",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#123456",
          size: 4,
        },
      },
      { readonly: false },
      1,
      historyDir,
    );

    const state = await readCanonicalBoardState(
      "rewrite-seq-mismatch",
      historyDir,
    );
    const persistedItemIds = new Set(state.itemsById.keys());

    await assert.rejects(
      rewriteStoredSvgFromCanonical(
        "rewrite-seq-mismatch",
        state.itemsById,
        state.paintOrder,
        state.metadata,
        persistedItemIds,
        0,
        2,
        historyDir,
      ),
      /stored svg seq mismatch/i,
    );
  });
});

test("writeBoardState removes stale svg and legacy json when board becomes empty", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-empty-delete-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgPath("empty-board", historyDir),
      '<svg id="canvas" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="1" data-wbo-readonly="false"><g id="drawingArea"></g></svg>',
      "utf8",
    );
    await fs.writeFile(
      jsonPath("empty-board", historyDir),
      JSON.stringify({
        "rect-1": {
          id: "rect-1",
          tool: "rectangle",
          x: 0,
          y: 0,
          x2: 1,
          y2: 1,
          color: "#000000",
          size: 1,
        },
      }),
      "utf8",
    );

    await writeBoardState(
      "empty-board",
      {},
      { readonly: false },
      0,
      historyDir,
    );

    await assert.rejects(fs.stat(svgPath("empty-board", historyDir)));
    await assert.rejects(fs.stat(jsonPath("empty-board", historyDir)));
  });
});
