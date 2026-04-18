const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  BOARD_DATA_PATH,
  boardFile,
  withEnv,
  writeBoard,
} = require("./test_helpers.js");

/**
 * @template T
 * @param {T} board
 * @returns {T}
 */
function disableSaves(board) {
  /** @type {{delaySave: () => void}} */ (board).delaySave = () => {};
  return board;
}

/**
 * @param {{board: { [id: string]: { [key: string]: any } }}} board
 * @returns {{ [id: string]: { [key: string]: any } }}
 */
function normalizeBoardSnapshot(board) {
  /** @type {{ [id: string]: { [key: string]: any } }} */
  const snapshot = {};
  for (const [id, item] of Object.entries(board.board)) {
    const copy = Object.assign({}, item);
    delete copy.time;
    snapshot[id] = copy;
  }
  return snapshot;
}

test("BoardData processMessageBatch and per-message processing stay in sync", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const single = disableSaves(new BoardData("process-sequence-single"));
  const batch = disableSaves(new BoardData("process-sequence-batch"));

  const messages = [
    {
      tool: "Pencil",
      type: "line",
      id: "p-1",
      color: "#123456",
      size: 4,
    },
    {
      tool: "Pencil",
      type: "child",
      parent: "p-1",
      x: 10,
      y: 20,
    },
    {
      tool: "Rectangle",
      type: "rect",
      id: "r-1",
      color: "#123456",
      size: 4,
      x: 2,
      y: 3,
      x2: 10,
      y2: 20,
    },
    {
      tool: "Rectangle",
      type: "update",
      id: "r-1",
      x: 5,
      y: 6,
      x2: 12,
      y2: 18,
    },
    {
      tool: "Hand",
      type: "update",
      id: "r-1",
      transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 },
    },
    {
      tool: "Hand",
      type: "copy",
      id: "r-1",
      newid: "r-2",
    },
    {
      tool: "Hand",
      type: "delete",
      id: "r-2",
    },
    {
      tool: "Hand",
      type: "update",
      id: "r-1",
      transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
    },
    {
      tool: "Eraser",
      type: "delete",
      id: "p-1",
    },
  ];

  for (const message of messages) {
    const result = single.processMessage(/** @type {any} */ (message));
    assert.equal(result.ok, true);
  }
  assert.equal(batch.processMessageBatch(messages).ok, true);

  assert.deepEqual(
    normalizeBoardSnapshot(single),
    normalizeBoardSnapshot(batch),
  );
});

test("BoardData replays batch updates, copies, and deletes consistently", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("replay-board"));

  board.processMessage({
    _children: [
      {
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        color: "#112233",
        size: 4,
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
      },
      {
        tool: "Hand",
        type: "update",
        id: "rect-1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
      },
      {
        tool: "Hand",
        type: "copy",
        id: "rect-1",
        newid: "rect-2",
      },
      {
        tool: "Eraser",
        type: "delete",
        id: "rect-1",
      },
    ],
  });

  assert.equal(board.get("rect-1"), undefined);
  assert.deepEqual(board.get("rect-2"), {
    tool: "Rectangle",
    type: "rect",
    id: "rect-2",
    color: "#112233",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
    transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
    time: board.get("rect-2").time,
  });
});

test("BoardData applies parent tool metadata to batched Hand updates", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("hand-batch-board"));

  board.processMessage({
    tool: "Rectangle",
    type: "rect",
    id: "rect-1",
    color: "#112233",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
  });

  board.processMessage({
    tool: "Hand",
    _children: [
      {
        type: "update",
        id: "rect-1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
      },
    ],
  });

  assert.deepEqual(board.get("rect-1").transform, {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 25,
    f: 30,
  });
});

test("BoardData copy keeps pencil child arrays isolated", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("copy-pencil-isolation"));

  board.processMessage({
    tool: "Pencil",
    type: "line",
    id: "p-1",
    color: "#123456",
    size: 4,
  });
  board.processMessage({
    tool: "Pencil",
    type: "child",
    parent: "p-1",
    x: 10,
    y: 20,
  });
  board.processMessage({
    tool: "Hand",
    type: "copy",
    id: "p-1",
    newid: "p-2",
  });
  board.processMessage({
    tool: "Pencil",
    type: "child",
    parent: "p-1",
    x: 30,
    y: 40,
  });

  assert.equal(board.get("p-1")._children.length, 2);
  assert.equal(board.get("p-2")._children.length, 1);
  assert.notStrictEqual(board.get("p-1")._children, board.get("p-2")._children);
});

test("BoardData.addChild enforces MAX_CHILDREN on stored strokes", async () => {
  await withEnv({ WBO_MAX_CHILDREN: "1" }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = disableSaves(new BoardData("child-cap-board"));

    board.set("line-1", {
      tool: "Pencil",
      type: "line",
      id: "line-1",
      color: "#123456",
      size: 4,
    });

    assert.equal(board.addChild("line-1", { x: 1, y: 2 }).ok, true);
    assert.equal(board.addChild("line-1", { x: 3, y: 4 }).ok, false);
    assert.deepEqual(board.get("line-1")._children, [{ x: 1, y: 2 }]);
  });
});

test("BoardData rejects the first pencil child that makes a stroke oversized", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("oversized-pencil-board"));

  assert.equal(
    board.set("line-1", {
      tool: "Pencil",
      type: "line",
      id: "line-1",
      color: "#123456",
      size: 4,
    }).ok,
    true,
  );

  assert.equal(board.addChild("line-1", { x: 0, y: 0 }).ok, true);
  assert.equal(board.addChild("line-1", { x: 3199, y: 0 }).ok, true);
  assert.equal(board.addChild("line-1", { x: 3201, y: 0 }).ok, false);
  assert.deepEqual(board.get("line-1")._children, [
    { x: 0, y: 0 },
    { x: 3199, y: 0 },
  ]);
});

test("BoardData rejects transform updates that make a stored shape oversized", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("oversized-transform-board"));

  board.processMessage({
    tool: "Rectangle",
    type: "rect",
    id: "rect-1",
    color: "#112233",
    size: 4,
    x: 0,
    y: 0,
    x2: 1000,
    y2: 1000,
  });

  assert.equal(
    board.processMessage({
      tool: "Hand",
      type: "update",
      id: "rect-1",
      transform: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
    }).ok,
    false,
  );
  assert.equal(board.get("rect-1").transform, undefined);
});

test("BoardData drops zero-size seed shapes after an oversized update is rejected", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("oversized-seed-shape-board"));

  assert.equal(
    board.processMessage({
      tool: "Rectangle",
      type: "rect",
      id: "rect-1",
      color: "#112233",
      size: 4,
      x: 10,
      y: 10,
      x2: 10,
      y2: 10,
    }).ok,
    true,
  );

  assert.equal(
    board.processMessage({
      tool: "Rectangle",
      type: "update",
      id: "rect-1",
      x: 10,
      y: 10,
      x2: 4015,
      y2: 30,
    }).ok,
    false,
  );
  assert.equal(board.get("rect-1"), undefined);
});

test("BoardData.preparePersistentMutation preserves seed-drop followups and stays in sync after them", async () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("prepare-seed-followup-board"));

  assert.equal(
    board.processMessage({
      tool: "Rectangle",
      type: "rect",
      id: "rect-1",
      color: "#112233",
      size: 4,
      x: 10,
      y: 10,
      x2: 10,
      y2: 10,
    }).ok,
    true,
  );

  const oversizedUpdate = {
    tool: "Rectangle",
    type: "update",
    id: "rect-1",
    x: 10,
    y: 10,
    x2: 4015,
    y2: 30,
  };

  assert.deepEqual(await board.preparePersistentMutation(oversizedUpdate), {
    ok: true,
    mutation: oversizedUpdate,
  });
  assert.equal(board.processMessage(oversizedUpdate).ok, false);
  assert.equal(board.get("rect-1"), undefined);
  assert.deepEqual(board.consumePendingRejectedMutationEffects(), [
    {
      mutation: {
        tool: "Eraser",
        type: "delete",
        id: "rect-1",
      },
    },
  ]);

  assert.deepEqual(
    await board.preparePersistentMutation({
      tool: "Hand",
      type: "copy",
      id: "rect-1",
      newid: "rect-2",
    }),
    {
      ok: false,
      reason: "copied object does not exist",
    },
  );
});

test("BoardData rejects hand batches atomically when one transform is oversized", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("atomic-hand-batch-board"));

  board.processMessage({
    tool: "Rectangle",
    type: "rect",
    id: "rect-1",
    color: "#112233",
    size: 4,
    x: 0,
    y: 0,
    x2: 1000,
    y2: 1000,
  });
  board.processMessage({
    tool: "Rectangle",
    type: "rect",
    id: "rect-2",
    color: "#112233",
    size: 4,
    x: 0,
    y: 0,
    x2: 100,
    y2: 100,
  });

  assert.equal(
    board.processMessage({
      tool: "Hand",
      _children: [
        {
          type: "update",
          id: "rect-1",
          transform: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
        },
        {
          type: "update",
          id: "rect-2",
          transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
        },
      ],
    }).ok,
    false,
  );
  assert.equal(board.get("rect-1").transform, undefined);
  assert.equal(board.get("rect-2").transform, undefined);
});

test("BoardData.clean keeps the newest items when trimming history", async () => {
  await withEnv({ WBO_MAX_ITEM_COUNT: "2" }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = disableSaves(new BoardData("cleanup-board"));

    board.board = {
      oldest: { id: "oldest", tool: "Text", type: "new", time: 1 },
      middle: { id: "middle", tool: "Text", type: "new", time: 2 },
      newest: { id: "newest", tool: "Text", type: "new", time: 3 },
    };

    board.clean();

    assert.deepEqual(Object.keys(board.board).sort(), ["middle", "newest"]);
  });
});

test("BoardData.load normalizes stored board items from disk", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-data-load-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    await writeBoard(historyDir, "normalized-load", {
      bad1: {
        tool: "Rectangle",
        type: "rect",
        id: "wrong-id",
        color: "#abcdef",
        size: 200,
        opacity: 3,
        x: -100,
        y: "20.333",
        x2: "70000",
        y2: 40,
        ignored: true,
      },
      bad2: {
        tool: "Unknown",
        id: "bad2",
      },
    });

    const board = await BoardData.load("normalized-load");

    assert.equal(board.get("bad1"), undefined);
    assert.equal(board.get("bad2"), undefined);
  });
});

test("BoardData.load eagerly migrates legacy json boards to svg", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-json-migrate-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    await writeBoard(historyDir, "legacy-migrate", {
      __wbo_meta__: { readonly: true },
      rect: {
        id: "rect",
        tool: "Rectangle",
        type: "rect",
        color: "#123456",
        size: 4,
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
      },
    });

    const board = await BoardData.load("legacy-migrate");
    const svgPath = path.join(historyDir, "board-legacy-migrate.svg");
    const svg = await fs.readFile(svgPath, "utf8");

    assert.equal(board.metadata.readonly, true);
    assert.equal(board.get("rect").tool, "Rectangle");
    assert.match(svg, /data-wbo-format="whitebophir-svg-v1"/);
    assert.match(svg, /data-wbo-readonly="true"/);
    assert.match(svg, /<rect id="rect" x="0" y="0" width="10" height="10"/);
    assert.doesNotMatch(svg, /data-wbo-item|data-wbo-tool/);
  });
});

test("BoardData lazily hydrates persisted svg items before applying updates", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-lazy-hydrate-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    await fs.writeFile(
      path.join(historyDir, "board-lazy-hydrate.svg"),
      '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false"><defs id="defs"></defs><g id="drawingArea"><rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect></g><g id="cursors"></g></svg>',
      "utf8",
    );

    const board = await BoardData.load("lazy-hydrate");
    assert.equal(board.get("rect-1"), undefined);

    const updateRect = {
      tool: "Rectangle",
      type: "update",
      id: "rect-1",
      x2: 30,
      y2: 40,
    };
    assert.deepEqual(await board.preparePersistentMutation(updateRect), {
      ok: true,
      mutation: updateRect,
    });
    assert.equal(board.processMessage(updateRect).ok, true);
    assert.deepEqual(board.get("rect-1"), {
      id: "rect-1",
      tool: "Rectangle",
      type: "rect",
      x: 1,
      y: 2,
      x2: 30,
      y2: 40,
      color: "#123456",
      size: 4,
    });
  });
});

test("BoardData records contiguous mutation seq values and persists them into svg baselines", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-seq-save-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = new BoardData("seq-save");

    const message = {
      id: "rect-1",
      tool: "Rectangle",
      type: "rect",
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    };

    assert.equal(board.processMessage({ ...message }).ok, true);
    const firstEnvelope = board.recordPersistentMutation(message, 100, "c1");
    const secondEnvelope = board.recordPersistentMutation(
      { tool: "Eraser", type: "delete", id: "rect-1" },
      200,
      "c2",
    );

    assert.equal(firstEnvelope.seq, 1);
    assert.equal(secondEnvelope.seq, 2);
    assert.equal(board.getSeq(), 2);
    assert.equal(board.minReplayableSeq(), 0);
    assert.deepEqual(
      board
        .readMutationRange(0, 2)
        .map((/** @type {{seq: number}} */ entry) => entry.seq),
      [1, 2],
    );

    clearTimeout(board.saveTimeoutId);
    board.saveTimeoutId = undefined;
    await board.save();

    const svg = await fs.readFile(
      path.join(historyDir, "board-seq-save.svg"),
      "utf8",
    );
    assert.match(svg, /data-wbo-seq="2"/);
  });
});

test("BoardData.save trims persisted replay history past the configured retention window", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-replay-retention-"),
  );

  await withEnv(
    {
      WBO_HISTORY_DIR: historyDir,
      WBO_SEQ_REPLAY_RETENTION_MS: "0",
    },
    async () => {
      const BoardData = require(BOARD_DATA_PATH).BoardData;
      const board = disableSaves(new BoardData("replay-retention"));
      const first = {
        id: "rect-1",
        tool: "Rectangle",
        type: "rect",
        color: "#123456",
        size: 4,
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
      };
      const second = {
        id: "rect-2",
        tool: "Rectangle",
        type: "rect",
        color: "#654321",
        size: 4,
        x: 20,
        y: 20,
        x2: 30,
        y2: 30,
      };

      assert.equal(board.processMessage(first).ok, true);
      board.recordPersistentMutation(first, 1);
      assert.equal(board.processMessage(second).ok, true);
      board.recordPersistentMutation(second, 2);

      await board.save();

      assert.equal(board.getPersistedSeq(), 2);
      assert.equal(board.minReplayableSeq(), 2);
      assert.deepEqual(
        board
          .readMutationRange(0, 2)
          .map((/** @type {{seq: number}} */ entry) => entry.seq),
        [],
      );
    },
  );
});

test("BoardData.save keeps writing to the board's original history dir after env changes", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-sticky-history-"),
  );

  /** @type {InstanceType<typeof import("../server/boardData.mjs").BoardData> | undefined} */
  let board;
  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    board = new BoardData("sticky-history");
    const stickyBoard =
      /** @type {InstanceType<typeof import("../server/boardData.mjs").BoardData>} */ (
        board
      );
    stickyBoard.processMessage({
      id: "rect-1",
      tool: "Rectangle",
      type: "rect",
      color: "#654321",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    });
    stickyBoard.recordPersistentMutation({
      id: "rect-1",
      tool: "Rectangle",
      type: "rect",
      color: "#654321",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    });
    clearTimeout(stickyBoard.saveTimeoutId);
    stickyBoard.saveTimeoutId = undefined;
  });
  assert.ok(board);
  const stickyBoard = board;

  await withEnv({ WBO_HISTORY_DIR: undefined }, async () => {
    await stickyBoard.save();
  });

  const svg = await fs.readFile(
    path.join(historyDir, "board-sticky-history.svg"),
    "utf8",
  );
  assert.match(svg, /data-wbo-seq="1"/);
});

test("BoardData.save rewrites existing stored svg from queued mutations", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-save-rewrite-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const svgPath = path.join(historyDir, "board-rewrite-save.svg");
    const existingSvg =
      '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="777" height="888" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
      '<defs id="defs"><style>.keep-me{}</style><marker id="m1"></marker></defs>' +
      '<g id="drawingArea">' +
      '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
      '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>' +
      "</g>" +
      '<g id="cursors"><path id="cursor-template"></path></g>' +
      "</svg>";
    await fs.writeFile(svgPath, existingSvg, "utf8");

    const board = await BoardData.load("rewrite-save");
    const updateRect = {
      tool: "Rectangle",
      type: "update",
      id: "rect-1",
      x2: 30,
      y2: 40,
    };
    const copyRect = {
      tool: "Hand",
      type: "copy",
      id: "rect-1",
      newid: "rect-2",
    };
    const deleteText = {
      tool: "Eraser",
      type: "delete",
      id: "text-1",
    };

    assert.deepEqual(await board.preparePersistentMutation(updateRect), {
      ok: true,
      mutation: updateRect,
    });
    assert.equal(board.processMessage(updateRect).ok, true);
    board.recordPersistentMutation(updateRect, 2);
    assert.deepEqual(await board.preparePersistentMutation(copyRect), {
      ok: true,
      mutation: copyRect,
    });
    assert.equal(board.processMessage(copyRect).ok, true);
    board.recordPersistentMutation(copyRect, 3);
    assert.deepEqual(await board.preparePersistentMutation(deleteText), {
      ok: true,
      mutation: deleteText,
    });
    assert.equal(board.processMessage(deleteText).ok, true);
    board.recordPersistentMutation(deleteText, 4);

    await board.save();

    const rewritten = await fs.readFile(svgPath, "utf8");
    assert.match(
      rewritten,
      /<style>\.keep-me\{\}<\/style><marker id="m1"><\/marker><\/defs>/,
    );
    assert.match(
      rewritten,
      /<g id="cursors"><path id="cursor-template"><\/path><\/g>/,
    );
    assert.match(rewritten, /data-wbo-seq="4"/);
    const rect1Index = rewritten.indexOf('id="rect-1"');
    const rect2Index = rewritten.indexOf('id="rect-2"');
    assert.ok(rect1Index !== -1);
    assert.ok(rect2Index !== -1);
    assert.ok(rect1Index < rect2Index);
    assert.equal(rewritten.includes('id="text-1"'), false);
  });
});

test("BoardData.save preserves cold-loaded stored svg when there are no pending mutations", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-save-cold-noop-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const svgPath = path.join(historyDir, "board-cold-noop.svg");
    const existingSvg =
      '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="777" height="888" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="7" data-wbo-readonly="false">' +
      '<defs id="defs"><marker id="m1"></marker></defs>' +
      '<g id="drawingArea">' +
      '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
      '<path id="line-1" d="M 1 2 L 1 2 C 1 2 3 4 3 4" stroke="#654321" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
      "</g>" +
      '<g id="cursors"><path id="cursor-template"></path></g>' +
      "</svg>";
    await fs.writeFile(svgPath, existingSvg, "utf8");

    const board = await BoardData.load("cold-noop");

    assert.equal(Object.keys(board.board).length, 0);
    await board.save();

    assert.equal(await fs.readFile(svgPath, "utf8"), existingSvg);
  });
});

test("BoardData.save persists direct in-memory board items even before the admission index is rebuilt", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-save-direct-memory-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = new BoardData("direct-memory-save");
    board.board["text-1"] = {
      id: "text-1",
      tool: "Text",
      x: 1,
      y: 2,
      txt: "hi",
      size: 12,
      color: "#000000",
    };

    await board.save();

    const svg = await fs.readFile(
      path.join(historyDir, "board-direct-memory-save.svg"),
      "utf8",
    );
    assert.match(svg, /id="text-1"/);
  });
});

test("BoardData.save falls back to a full authoritative write on stored svg seq mismatch", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-save-rewrite-mismatch-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const svgPath = path.join(historyDir, "board-rewrite-mismatch.svg");
    const existingSvg =
      '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="777" height="888" data-wbo-format="whitebophir-svg-v1" data-wbo-seq="1" data-wbo-readonly="false">' +
      '<defs id="defs"><style>.keep-me{}</style><marker id="m1"></marker></defs>' +
      '<g id="drawingArea">' +
      '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
      "</g>" +
      '<g id="cursors"><path id="cursor-template"></path></g>' +
      "</svg>";
    await fs.writeFile(svgPath, existingSvg, "utf8");

    const board = await BoardData.load("rewrite-mismatch");
    await fs.writeFile(
      svgPath,
      existingSvg.replace('data-wbo-seq="1"', 'data-wbo-seq="99"'),
      "utf8",
    );
    const updateRect = {
      tool: "Rectangle",
      type: "update",
      id: "rect-1",
      x2: 30,
      y2: 40,
    };

    assert.deepEqual(await board.preparePersistentMutation(updateRect), {
      ok: true,
      mutation: updateRect,
    });
    assert.equal(board.processMessage(updateRect).ok, true);
    board.recordPersistentMutation(updateRect, 2);

    await board.save();

    const rewritten = await fs.readFile(svgPath, "utf8");
    assert.match(rewritten, /data-wbo-seq="2"/);
    assert.match(
      rewritten,
      /<rect id="rect-1" x="1" y="2" width="29" height="38" stroke="#123456" stroke-width="4" fill="none"><\/rect>/,
    );
  });
});

test("BoardData.save serializes concurrent saves and releases after failure", async () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = new BoardData("serial-save-board");
  /** @type {string[]} */
  const calls = [];
  let shouldFail = true;

  board._unsafe_save = async () => {
    calls.push("start");
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (shouldFail) {
      shouldFail = false;
      calls.push("fail");
      throw new Error("boom");
    }
    calls.push("ok");
  };

  const firstSave = board.save().then(
    () => {
      calls.push("first-resolved");
    },
    () => {
      calls.push("first-rejected");
    },
  );
  const secondSave = board.save().then(() => {
    calls.push("second-resolved");
  });

  await Promise.all([firstSave, secondSave]);

  assert.equal(calls[0], "start");
  assert.equal(calls[1], "fail");
  assert.equal(calls[2], "start");
  assert.equal(calls.includes("first-rejected"), true);
  assert.equal(calls[calls.length - 2], "ok");
  assert.equal(calls[calls.length - 1], "second-resolved");
});
