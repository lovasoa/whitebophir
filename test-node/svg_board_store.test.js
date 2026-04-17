const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { withEnv } = require("./test_helpers.js");

const svgEnvelope = require("../server/svg_envelope.mjs");
const svgBoardStore = require("../server/svg_board_store.mjs");
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

test("parseStoredSvgEnvelope keeps non-drawing shell content opaque", () => {
  const svg =
    '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="3" data-wbo-readonly="false">' +
    '<defs id="defs"><marker id="triangle"></marker></defs>' +
    '<g id="drawingArea">' +
    '<g id="rect-1" data-wbo-tool="Rectangle" data-wbo-item="%7B%22id%22%3A%22rect-1%22%2C%22tool%22%3A%22Rectangle%22%7D"></g>' +
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
    '<g id="rect-1" data-wbo-tool="Rectangle" data-wbo-item="%7B%22id%22%3A%22rect-1%22%2C%22tool%22%3A%22Rectangle%22%7D"></g>',
  );
  assert.match(
    envelope.suffix,
    /^<\/g><g id="cursors"><circle id="ghost"><\/circle><\/g><\/svg>$/,
  );
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
    '<g id="old-item" data-wbo-tool="Rectangle" data-wbo-item="%7B%22id%22%3A%22old-item%22%2C%22tool%22%3A%22Rectangle%22%2C%22x%22%3A0%2C%22y%22%3A0%2C%22x2%22%3A10%2C%22y2%22%3A10%2C%22color%22%3A%22%23000000%22%2C%22size%22%3A1%7D"></g>' +
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

test("readBoardState falls back to legacy json when svg is absent", async () => {
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

    const state = await svgBoardStore.readBoardState("legacy-board");

    assert.equal(state.source, "json");
    assert.equal(state.metadata.readonly, true);
    assert.equal(state.seq, 0);
    assert.equal(state.board["rect-1"].tool, "Rectangle");
  });
});

test("readBoardState prefers authoritative svg over stale legacy json", async () => {
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

    const state = await svgBoardStore.readBoardState("svg-preferred");

    assert.equal(state.source, "svg");
    assert.equal(state.metadata.readonly, true);
    assert.equal(state.seq, 7);
    assert.deepEqual(Object.keys(state.board), ["rect-svg"]);
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
    '<g id="rect-1" data-wbo-tool="Rectangle" data-wbo-item="%7B%22id%22%3A%22rect-1%22%2C%22tool%22%3A%22Rectangle%22%2C%22x%22%3A1%2C%22y%22%3A2%2C%22x2%22%3A3%2C%22y2%22%3A4%2C%22color%22%3A%22%23123456%22%2C%22size%22%3A4%7D"></g>' +
    '<g id="text-1" data-wbo-tool="Text" data-wbo-item="%7B%22id%22%3A%22text-1%22%2C%22tool%22%3A%22Text%22%2C%22x%22%3A5%2C%22y%22%3A6%2C%22txt%22%3A%22hello%22%2C%22size%22%3A18%2C%22color%22%3A%22%23654321%22%7D" transform="matrix(1 0 0 1 7 8)"></g>' +
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
  const svg = svgBoardStore.renderServedBaselineSvg(
    {
      "line-1": {
        id: "line-1",
        tool: "Pencil",
        type: "line",
        color: "#123456",
        size: 4,
        _children: points,
      },
    },
    { readonly: false },
    9,
  );

  assert.match(
    svg,
    new RegExp(`d="${escapeRegExp(renderExpectedPencilPath(points))}"`),
  );
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
