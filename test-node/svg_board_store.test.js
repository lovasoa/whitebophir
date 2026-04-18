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
const {
  wboPencilPoint,
} = require("../client-data/tools/pencil/wbo_pencil_point.js");

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {{x: number, y: number}[]} points
 * @returns {string}
 */
function renderExpectedPencilPath(points) {
  /** @type {{type: string, values: number[]}[]} */
  const pathData = [];
  points.forEach((point) => {
    wboPencilPoint(pathData, point.x, point.y);
  });
  return pathData
    .map((segment) => `${segment.type} ${segment.values.join(" ")}`)
    .join(" ");
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
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="3" data-wbo-readonly="false">' +
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
    '<svg id="canvas" width="800" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="2" data-wbo-readonly="false">' +
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
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="777" height="888" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
    '<defs id="defs"><style>.keep-me{}</style><marker id="m1"></marker></defs>' +
    '<g id="drawingArea">' +
    '<rect id="old-item" x="0" y="0" width="10" height="10" stroke="#000000" stroke-width="1" fill="none"></rect>' +
    "</g>" +
    '<g id="cursors"><path id="cursor-template"></path></g>' +
    "</svg>";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardSvgPath(boardName),
      existingSvg,
      "utf8",
    );
    await svgBoardStore.writeBoardState(
      boardName,
      {
        "line-1": {
          id: "line-1",
          tool: "Straight line",
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
          tool: "Text",
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
    );

    const rewritten = await fs.readFile(
      svgBoardStore.boardSvgPath(boardName),
      "utf8",
    );
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

test("local persisted-board helper falls back to legacy json when svg is absent", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-json-fallback-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardJsonPath("legacy-board"),
      JSON.stringify({
        __wbo_meta__: { readonly: true },
        "rect-1": {
          id: "rect-1",
          tool: "Rectangle",
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
    assert.equal(state.board["rect-1"].tool, "Rectangle");
  });
});

test("local persisted-board helper prefers authoritative svg over stale legacy json", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-svg-preferred-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardJsonPath("svg-preferred"),
      JSON.stringify({
        "rect-json": {
          id: "rect-json",
          tool: "Rectangle",
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
    await svgBoardStore.writeBoardState(
      "svg-preferred",
      {
        "rect-svg": {
          id: "rect-svg",
          tool: "Rectangle",
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
    );

    const state = await readPersistedBoardState("svg-preferred", historyDir);

    assert.equal(state.source, "svg");
    assert.equal(state.metadata.readonly, true);
    assert.equal(state.seq, 7);
    assert.deepEqual(Object.keys(state.board), ["rect-svg"]);
  });
});

test("readBoardLoadState reports svg byte length without a second board parse", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-load-state-"),
  );
  const boardName = "load-state-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="7" data-wbo-readonly="true"><defs id="defs"></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardSvgPath(boardName),
      storedSvg,
      "utf8",
    );

    const state = await svgBoardStore.readBoardLoadState(boardName);

    assert.equal(state.source, "svg");
    assert.equal(state.byteLength, storedSvg.length);
    assert.equal(state.summaries.get("rect-1")?.tool, "Rectangle");
  });
});

test("readBoardLoadState streams root metadata for empty drawing areas", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-load-state-empty-"),
  );
  const boardName = "load-state-empty-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="9" data-wbo-readonly="true"><defs id="defs"></defs><g id="drawingArea"></g><g id="cursors"></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardSvgPath(boardName),
      storedSvg,
      "utf8",
    );

    const state = await svgBoardStore.readBoardLoadState(boardName);

    assert.equal(state.source, "svg");
    assert.equal(state.byteLength, storedSvg.length);
    assert.equal(state.seq, 9);
    assert.equal(state.metadata.readonly, true);
    assert.equal(state.summaries.size, 0);
  });
});

test("readServedBaseline returns stored svg bytes unchanged when svg exists", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-served-opaque-"),
  );
  const boardName = "served-opaque";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="7" data-wbo-readonly="true"><defs id="defs"><marker id="keep"></marker></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"><path id="cursor-template"></path></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardSvgPath(boardName),
      storedSvg,
      "utf8",
    );

    assert.equal(await svgBoardStore.readServedBaseline(boardName), storedSvg);
  });
});

test("readBoardDocumentState returns metadata and inline svg from one stored svg source", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-document-state-"),
  );
  const boardName = "document-state-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="640" height="480" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="7" data-wbo-readonly="true"><defs id="defs"><marker id="keep"></marker></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"><path id="cursor-template"></path></g></svg>';

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardSvgPath(boardName),
      storedSvg,
      "utf8",
    );

    const state = await svgBoardStore.readBoardDocumentState(boardName);

    assert.deepEqual(state.metadata, { readonly: true });
    assert.equal(state.inlineBoardSvg, storedSvg);
  });
});

test("readBoardDocumentState falls back to legacy json metadata and inline rendering", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-document-state-json-"),
  );
  const boardName = "document-state-json";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardJsonPath(boardName),
      JSON.stringify({
        __wbo_meta__: { readonly: true },
        "rect-1": {
          id: "rect-1",
          tool: "Rectangle",
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

    const state = await svgBoardStore.readBoardDocumentState(boardName);

    assert.deepEqual(state.metadata, { readonly: true });
    assert.match(state.inlineBoardSvg, /data-wbo-readonly="true"/);
    assert.match(state.inlineBoardSvg, /id="rect-1"/);
  });
});

test("parseBoardItems hydrates only requested stored svg items", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-parse-items-svg-"),
  );
  const boardName = "parse-items-svg";
  const storedSvg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="4" data-wbo-readonly="false">' +
    '<defs id="defs"></defs>' +
    '<g id="drawingArea">' +
    '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
    '<text id="text-1" x="5" y="6" font-size="18" fill="#654321" transform="matrix(1 0 0 1 7 8)">hello</text>' +
    "</g>" +
    '<g id="cursors"></g>' +
    "</svg>";

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardSvgPath(boardName),
      storedSvg,
      "utf8",
    );

    const items = await svgBoardStore.parseBoardItems(
      boardName,
      new Set(["text-1"]),
    );

    assert.equal(items.size, 1);
    assert.deepEqual(items.get("text-1"), {
      id: "text-1",
      tool: "Text",
      x: 5,
      y: 6,
      txt: "hello",
      size: 18,
      color: "#654321",
      transform: { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 },
    });
  });
});

test("local stored-svg summary helper derives minimal pencil summaries", () => {
  const summary = summarizeStoredSvg(
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="4" data-wbo-readonly="false">' +
      '<defs id="defs"></defs>' +
      '<g id="drawingArea">' +
      '<path id="line-1" d="M 1 2 L 3 4 C 3 4 8 9 8 9" stroke="#123456" stroke-width="4" fill="none" transform="matrix(1 0 0 1 7 8)"></path>' +
      '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>' +
      "</g>" +
      '<g id="cursors"></g>' +
      "</svg>",
  );

  assert.equal(summary.seq, 4);
  assert.equal(summary.metadata.readonly, false);
  assert.deepEqual(summary.summaries.get("line-1"), {
    id: "line-1",
    tool: "Pencil",
    childCount: 3,
    localBounds: { minX: 1, minY: 2, maxX: 8, maxY: 9 },
    paintOrder: 0,
    transform: { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 },
  });
  assert.deepEqual(summary.summaries.get("text-1"), {
    id: "text-1",
    tool: "Text",
    x: 5,
    y: 6,
    size: 18,
    txt: "hello",
    localBounds: {
      minX: 5,
      minY: -12,
      maxX: 95,
      maxY: 6,
    },
    paintOrder: 1,
  });
});

test("parseBoardItems falls back to legacy json and filters ids", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-parse-items-json-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      svgBoardStore.boardJsonPath("parse-items-json"),
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

    const items = await svgBoardStore.parseBoardItems(
      "parse-items-json",
      new Set(["rect-1"]),
    );

    assert.deepEqual([...items.keys()], ["rect-1"]);
    assert.equal(items.get("rect-1")?.tool, "Rectangle");
  });
});

test("served svg baselines keep pencil smoothing compatible with the client path builder", async () => {
  const points = [
    { x: 1, y: 2 },
    { x: 10, y: 12 },
    { x: 18, y: 9 },
    { x: 25, y: 30 },
  ];
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-served-pencil-json-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      legacyJsonBoardSource.boardJsonPath("served-pencil-json"),
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

    const svg = await svgBoardStore.readServedBaseline("served-pencil-json");
    assert.match(
      svg,
      new RegExp(`d="${escapeRegExp(renderExpectedPencilPath(points))}"`),
    );
  });
});

test("stored svg preserves style state needed for authoritative rendering", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-style-state-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await svgBoardStore.writeBoardState(
      "style-state",
      {
        "rect-1": {
          id: "rect-1",
          tool: "Rectangle",
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
          tool: "Text",
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
          tool: "Pencil",
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
    );

    const state = await readPersistedBoardState("style-state", historyDir);
    assert.deepEqual(state.board["rect-1"], {
      id: "rect-1",
      tool: "Rectangle",
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
      tool: "Text",
      x: 5,
      y: 6,
      txt: "hello",
      size: 18,
      color: "#654321",
      opacity: 0.7,
    });
    assert.deepEqual(state.board["line-1"], {
      id: "line-1",
      tool: "Pencil",
      color: "#abcdef",
      size: 5,
      opacity: 0.8,
      _children: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
  });
});

test("rewriteStoredSvg rejects stored svg base-seq mismatches", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-svg-store-rewrite-seq-mismatch-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await svgBoardStore.writeBoardState(
      "rewrite-seq-mismatch",
      {
        "rect-1": {
          id: "rect-1",
          tool: "Rectangle",
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
    );

    await assert.rejects(
      svgBoardStore.rewriteStoredSvg(
        "rewrite-seq-mismatch",
        0,
        2,
        [
          {
            mutation: {
              tool: "Rectangle",
              type: "update",
              id: "rect-1",
              x2: 30,
              y2: 40,
            },
          },
        ],
        { readonly: false },
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
      svgBoardStore.boardSvgPath("empty-board"),
      '<svg id="canvas" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false"><g id="drawingArea"></g></svg>',
      "utf8",
    );
    await fs.writeFile(
      svgBoardStore.boardJsonPath("empty-board"),
      JSON.stringify({
        "rect-1": {
          id: "rect-1",
          tool: "Rectangle",
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

    await svgBoardStore.writeBoardState(
      "empty-board",
      {},
      { readonly: false },
      0,
    );

    await assert.rejects(fs.stat(svgBoardStore.boardSvgPath("empty-board")));
    await assert.rejects(fs.stat(svgBoardStore.boardJsonPath("empty-board")));
  });
});
