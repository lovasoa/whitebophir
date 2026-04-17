const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { withEnv } = require("./test_helpers.js");

const svgEnvelope = require("../server/svg_envelope.mjs");
const svgBoardStore = require("../server/svg_board_store.mjs");

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
