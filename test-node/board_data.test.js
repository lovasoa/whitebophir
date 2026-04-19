const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { BOARD_DATA_PATH, withEnv, writeBoard } = require("./test_helpers.js");

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

/**
 * @param {any} board
 * @param {any} mutation
 * @param {number} acceptedAtMs
 * @returns {Promise<void>}
 */
async function applyPersistentMutation(board, mutation, acceptedAtMs) {
  const prepared = await board.preparePersistentMutation(mutation);
  assert.deepEqual(prepared, { ok: true, mutation });
  assert.equal(board.processMessage(mutation).ok, true);
  board.recordPersistentMutation(mutation, acceptedAtMs);
}

/**
 * @param {() => boolean | Promise<boolean>} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for predicate`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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

test("computeSaveDelayMs accelerates the first svg baseline save only", () => {
  const { computeSaveDelayMs } = require(BOARD_DATA_PATH);

  assert.equal(
    computeSaveDelayMs({
      saveIntervalMs: 2000,
      hasPersistedBaseline: false,
    }),
    50,
  );
  assert.equal(
    computeSaveDelayMs({
      saveIntervalMs: 100,
      hasPersistedBaseline: false,
    }),
    50,
  );
  assert.equal(
    computeSaveDelayMs({
      saveIntervalMs: 2000,
      hasPersistedBaseline: true,
    }),
    2000,
  );
  assert.equal(
    computeSaveDelayMs({
      saveIntervalMs: 2000,
      hasPersistedBaseline: true,
      hasDirtyCreatedItems: true,
    }),
    50,
  );
});

test("finalizePersistedItems leaves newer canonical revisions dirty", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("finalize-persisted-snapshot"));

  assert.equal(
    board.processMessage({
      tool: "Text",
      type: "new",
      id: "text-1",
      x: 120,
      y: 140,
      color: "#111111",
      size: 18,
    }).ok,
    true,
  );
  assert.equal(
    board.processMessage({
      tool: "Text",
      type: "update",
      id: "text-1",
      txt: "before save",
    }).ok,
    true,
  );

  const persistedSnapshot = new Map(board.itemsById);

  assert.equal(
    board.processMessage({
      tool: "Text",
      type: "update",
      id: "text-1",
      txt: "after save started",
    }).ok,
    true,
  );

  board.finalizePersistedItems(persistedSnapshot);

  assert.deepEqual(board.get("text-1"), {
    id: "text-1",
    tool: "Text",
    type: "new",
    color: "#111111",
    size: 18,
    x: 120,
    y: 140,
    txt: "after save started",
    textLength: 18,
    time: board.get("text-1").time,
  });
  assert.equal(board.itemsById.get("text-1")?.dirty, true);
});

test("finalizePersistedItems folds newly persisted pencil children into the baseline", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("finalize-persisted-children"));

  assert.equal(
    board.processMessage({
      tool: "Pencil",
      type: "line",
      id: "line-1",
      color: "#111111",
      size: 4,
    }).ok,
    true,
  );
  assert.equal(
    board.processMessage({
      tool: "Pencil",
      type: "child",
      parent: "line-1",
      x: 10,
      y: 20,
    }).ok,
    true,
  );

  const persistedSnapshot = new Map(board.itemsById);

  assert.equal(
    board.processMessage({
      tool: "Pencil",
      type: "child",
      parent: "line-1",
      x: 25,
      y: 35,
    }).ok,
    true,
  );

  board.finalizePersistedItems(persistedSnapshot);

  const line = board.itemsById.get("line-1");
  assert.equal(line?.createdAfterPersistedSeq, false);
  assert.equal(line?.payload?.persistedChildCount, 1);
  assert.deepEqual(line?.payload?.appendedChildren, [{ x: 25, y: 35 }]);
  assert.equal(line?.dirty, true);
});

test("save schedules a fast follow-up when newer created items remain dirty", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-save-follow-up-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = new BoardData("follow-up-save-board");

    assert.equal(
      board.processMessage({
        tool: "Pencil",
        type: "line",
        id: "pencil-1",
        color: "#123456",
        size: 4,
      }).ok,
      true,
    );
    assert.equal(
      board.processMessage({
        tool: "Pencil",
        type: "child",
        parent: "pencil-1",
        x: 100,
        y: 200,
      }).ok,
      true,
    );
    assert.equal(
      board.processMessage({
        tool: "Pencil",
        type: "child",
        parent: "pencil-1",
        x: 300,
        y: 400,
      }).ok,
      true,
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(
      board.processMessage({
        tool: "Pencil",
        type: "line",
        id: "pencil-2",
        color: "#abcdef",
        size: 4,
      }).ok,
      true,
    );
    assert.equal(
      board.processMessage({
        tool: "Pencil",
        type: "child",
        parent: "pencil-2",
        x: 0,
        y: 0,
      }).ok,
      true,
    );
    assert.equal(
      board.processMessage({
        tool: "Pencil",
        type: "child",
        parent: "pencil-2",
        x: 90,
        y: 120,
      }).ok,
      true,
    );
    assert.equal(
      board.processMessage({
        tool: "Pencil",
        type: "child",
        parent: "pencil-2",
        x: 180,
        y: 0,
      }).ok,
      true,
    );

    await waitFor(async () => {
      try {
        const saved = await fs.readFile(
          path.join(historyDir, "board-follow-up-save-board.svg"),
          "utf8",
        );
        return saved.includes("#123456") && saved.includes("#abcdef");
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? error.code
            : undefined;
        if (code === "ENOENT") {
          return false;
        }
        throw error;
      }
    }, 1000);
  });
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

test("BoardData keeps paint order stable when updating existing items", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("paint-order-stability"));

  assert.equal(
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
    }).ok,
    true,
  );
  assert.equal(
    board.processMessage({
      tool: "Rectangle",
      type: "rect",
      id: "rect-2",
      color: "#445566",
      size: 4,
      x: 20,
      y: 20,
      x2: 30,
      y2: 30,
    }).ok,
    true,
  );

  const beforeOrder = [...board.paintOrder];

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      board.processMessage({
        tool: "Hand",
        type: "update",
        id: "rect-1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: index, f: index * 2 },
      }).ok,
      true,
    );
  }

  assert.deepEqual(board.paintOrder, beforeOrder);
  assert.equal(board.paintOrder.length, 2);
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

test("BoardData authoritativeItemCount drops to zero after clear", () => {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = disableSaves(new BoardData("authoritative-count-clear"));

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
    tool: "Rectangle",
    type: "rect",
    id: "rect-2",
    color: "#445566",
    size: 4,
    x: 20,
    y: 20,
    x2: 30,
    y2: 30,
  });

  assert.equal(board.authoritativeItemCount(), 2);

  board.processMessage({
    tool: "Clear",
    type: "clear",
  });

  assert.equal(board.authoritativeItemCount(), 0);
  assert.equal(board.get("rect-1"), undefined);
  assert.equal(board.get("rect-2"), undefined);
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
      pencil: {
        id: "pencil",
        tool: "Pencil",
        type: "line",
        color: "#8844aa",
        size: 4,
        opacity: 1,
        _children: [
          { x: 60, y: 80 },
          { x: 120, y: 130 },
          { x: 180, y: 100 },
          { x: 230, y: 170 },
        ],
      },
      text: {
        id: "text",
        tool: "Text",
        type: "new",
        x: 360,
        y: 180,
        color: "#111111",
        size: 18,
        txt: "Slow sync",
      },
    });

    const board = await BoardData.load("legacy-migrate");
    const svgPath = path.join(historyDir, "board-legacy-migrate.svg");
    const svg = await fs.readFile(svgPath, "utf8");

    assert.equal(board.metadata.readonly, true);
    assert.equal(board.get("rect").tool, "Rectangle");
    assert.equal(board.get("pencil").tool, "Pencil");
    assert.equal(board.get("text").tool, "Text");
    assert.match(svg, /data-wbo-format="whitebophir-svg-v1"/);
    assert.match(svg, /data-wbo-readonly="true"/);
    assert.match(svg, /<rect id="rect" x="0" y="0" width="10" height="10"/);
    assert.match(svg, /<path id="pencil" d="M 60 80/);
    assert.match(svg, />Slow sync<\/text>/);
    assert.doesNotMatch(svg, /data-wbo-item|data-wbo-tool/);
  });
});

test("BoardData eagerly loads canonical persisted svg items before applying updates", async () => {
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
    assert.deepEqual(board.get("rect-1"), {
      id: "rect-1",
      tool: "Rectangle",
      x: 1,
      y: 2,
      x2: 3,
      y2: 4,
      color: "#123456",
      size: 4,
    });

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
    assert.deepEqual(
      {
        ...board.get("rect-1"),
        time: undefined,
      },
      {
        id: "rect-1",
        tool: "Rectangle",
        x: 1,
        y: 2,
        x2: 30,
        y2: 40,
        color: "#123456",
        size: 4,
        time: undefined,
      },
    );
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

    assert.deepEqual(Object.keys(board.board).sort(), ["line-1", "rect-1"]);
    await board.save();

    assert.equal(await fs.readFile(svgPath, "utf8"), existingSvg);
  });
});

test("BoardData.save persists canonical test-injected board items through the board setter", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-save-direct-memory-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const board = new BoardData("direct-memory-save");
    board.board = {
      "text-1": {
        id: "text-1",
        tool: "Text",
        x: 1,
        y: 2,
        txt: "hi",
        size: 12,
        color: "#000000",
      },
    };

    await board.save();

    const svg = await fs.readFile(
      path.join(historyDir, "board-direct-memory-save.svg"),
      "utf8",
    );
    assert.match(svg, /id="text-1"/);
  });
});

test("BoardData.save keeps eagerly loaded canonical items and applies streamed svg updates", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-board-save-streaming-sparse-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    const svgBoardStore = require("../server/svg_board_store.mjs");
    const boardName = "streaming-sparse";

    await svgBoardStore.writeBoardState(
      boardName,
      {
        "item-0": {
          id: "item-0",
          tool: "Pencil",
          color: "#123456",
          size: 2,
          _children: [
            { x: 0, y: 0 },
            { x: 2, y: 1 },
          ],
        },
        "item-1": {
          id: "item-1",
          tool: "Straight line",
          color: "#123456",
          size: 2,
          x: 1,
          y: 2,
          x2: 5,
          y2: 6,
        },
        "item-2": {
          id: "item-2",
          tool: "Text",
          x: 3,
          y: 4,
          txt: "hello",
          size: 18,
          color: "#654321",
        },
        "item-3": {
          id: "item-3",
          tool: "Rectangle",
          color: "#123456",
          size: 2,
          x: 5,
          y: 6,
          x2: 9,
          y2: 12,
        },
        "item-4": {
          id: "item-4",
          tool: "Ellipse",
          color: "#123456",
          size: 2,
          x: 10,
          y: 20,
          x2: 14,
          y2: 24,
        },
      },
      { readonly: false },
      0,
      { historyDir },
    );

    const board = await BoardData.load(boardName);
    assert.deepEqual(Object.keys(board.board).sort(), [
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);

    await applyPersistentMutation(
      board,
      {
        tool: "Rectangle",
        type: "update",
        id: "item-3",
        x2: 15,
        y2: 18,
      },
      1,
    );
    await applyPersistentMutation(
      board,
      {
        tool: "Text",
        type: "update",
        id: "item-2",
        txt: "hello streaming",
      },
      2,
    );
    await applyPersistentMutation(
      board,
      {
        tool: "Pencil",
        type: "child",
        parent: "item-0",
        x: 4,
        y: 2,
      },
      3,
    );
    await applyPersistentMutation(
      board,
      {
        tool: "Hand",
        type: "copy",
        id: "item-3",
        newid: "item-3-copy",
      },
      4,
    );
    await applyPersistentMutation(
      board,
      {
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
      5,
    );

    assert.deepEqual(Object.keys(board.board).sort(), [
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-3-copy",
      "item-4",
      "item-new",
    ]);

    await board.save();

    assert.deepEqual(Object.keys(board.board).sort(), [
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-3-copy",
      "item-4",
      "item-new",
    ]);
    assert.equal(board.authoritativeItemCount(), 7);

    const rewritten = await fs.readFile(
      path.join(historyDir, "board-streaming-sparse.svg"),
      "utf8",
    );
    assert.match(rewritten, /id="item-3-copy"/);
    assert.match(rewritten, /id="item-new"/);
    assert.match(rewritten, /hello streaming/);
  });
});

test("BoardData.save leaves the stored svg unchanged on seq mismatch", async () => {
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
    assert.match(rewritten, /data-wbo-seq="99"/);
    assert.match(
      rewritten,
      /<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"><\/rect>/,
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
