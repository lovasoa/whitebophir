const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  BOARD_DATA_PATH,
  CONFIG_PATH,
  createConfig,
  loadBoardData,
  withBoardHistoryDir,
  withEnv,
  writeBoard,
} = require("./test_helpers.js");
const {
  pinReplayBaseline,
  resetBoardRegistry,
} = require("../server/board_registry.mjs");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const {
  Clear,
  Eraser,
  Hand,
  Pencil,
  Rectangle,
  Text,
} = require("../client-data/tools/index.js");
const observability = require("../server/observability.mjs").default;

function getBoardDataClass() {
  return loadBoardData();
}

/**
 * @param {any} BoardData
 * @param {string} name
 * @param {any} [config]
 * @returns {any}
 */
function createBoard(BoardData, name, config) {
  return new BoardData(name, config || createConfig());
}

/**
 * @param {any} BoardData
 * @param {string} name
 * @param {any} [config]
 * @returns {Promise<any>}
 */
function loadBoard(BoardData, name, config) {
  return BoardData.load(name, config || createConfig());
}

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
 * @param {any} board
 * @param {any[]} mutations
 * @param {number} [firstAcceptedAtMs]
 * @returns {Promise<void>}
 */
async function applyPersistentMutations(
  board,
  mutations,
  firstAcceptedAtMs = 1,
) {
  let acceptedAtMs = firstAcceptedAtMs;
  for (const mutation of mutations) {
    await applyPersistentMutation(board, mutation, acceptedAtMs);
    acceptedAtMs += 1;
  }
}

/**
 * @param {any} board
 * @param {any[]} messages
 * @returns {void}
 */
function assertMessagesAccepted(board, messages) {
  for (const message of messages) {
    assert.equal(board.processMessage(message).ok, true);
  }
}

/**
 * @param {string} id
 * @param {string} color
 * @param {number} size
 * @param {any} x
 * @param {any} y
 * @param {any} x2
 * @param {any} y2
 * @returns {any}
 */
function rectangleMessage(id, color, size, x, y, x2, y2) {
  return {
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id,
    color,
    size,
    x,
    y,
    x2,
    y2,
  };
}

/**
 * @param {string} id
 * @param {{ [key: string]: any }} changes
 * @returns {any}
 */
function rectangleUpdate(id, changes) {
  return { tool: Rectangle.id, type: MutationType.UPDATE, id, ...changes };
}

/**
 * @param {{
 *   id: string,
 *   x: number,
 *   y: number,
 *   color: string,
 *   size: number,
 *   txt?: string,
 * }} fields
 * @returns {any}
 */
function textCreate(fields) {
  return { tool: Text.id, type: MutationType.CREATE, ...fields };
}

/**
 * @param {string} id
 * @param {string} txt
 * @returns {any}
 */
function textUpdate(id, txt) {
  return { tool: Text.id, type: MutationType.UPDATE, id, txt };
}

/**
 * @param {string} id
 * @param {{a: number, b: number, c: number, d: number, e: number, f: number}} transform
 * @returns {any}
 */
function handUpdate(id, transform) {
  return { tool: Hand.id, type: MutationType.UPDATE, id, transform };
}

/**
 * @param {string} id
 * @returns {any}
 */
function handDelete(id) {
  return { tool: Hand.id, type: MutationType.DELETE, id };
}

/**
 * @param {string} id
 * @param {string} newid
 * @returns {any}
 */
function handCopy(id, newid) {
  return { tool: Hand.id, type: MutationType.COPY, id, newid };
}

/**
 * @param {string} id
 * @returns {any}
 */
function eraserDelete(id) {
  return {
    tool: Eraser.id,
    type: MutationType.DELETE,
    id,
  };
}

/** @returns {any} */
function clearMessage() {
  return { tool: Clear.id, type: MutationType.CLEAR };
}

/**
 * @param {{
 *   historyDir: string,
 *   boardName: string,
 *   storedBoard?: any,
 *   storedSvg?: string,
 * }} options
 * @returns {Promise<{
 *   BoardData: any,
 *   board: any,
 *   svgPath: string,
 * }>}
 */
async function withLoadedBoard(options) {
  const { historyDir, boardName, storedBoard, storedSvg } = options;
  const BoardData = getBoardDataClass();
  const config = createConfig({ HISTORY_DIR: historyDir });
  const svgPath = path.join(historyDir, `board-${boardName}.svg`);
  if (storedBoard !== undefined) {
    await writeBoard(historyDir, boardName, storedBoard);
  }
  if (storedSvg !== undefined) {
    await fs.writeFile(svgPath, storedSvg, "utf8");
  }
  return {
    BoardData,
    board: await loadBoard(BoardData, boardName, config),
    svgPath,
  };
}

/**
 * @param {{
 *   seq?: number,
 *   readonly?: boolean,
 *   width?: number,
 *   height?: number,
 *   defs?: string,
 *   drawingArea?: string,
 *   cursors?: string,
 * }} [options]
 * @returns {string}
 */
function buildStoredSvg(options = {}) {
  const {
    seq = 1,
    readonly = false,
    width = 777,
    height = 888,
    defs = "",
    drawingArea = "",
    cursors = "",
  } = options;
  return `<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="${seq}" data-wbo-readonly="${readonly}"><defs id="defs">${defs}</defs><g id="drawingArea">${drawingArea}</g><g id="cursors">${cursors}</g></svg>`;
}

/**
 * @param {string} id
 * @param {string} color
 * @param {number} size
 * @param {{x: number, y: number}[]} [points]
 * @returns {any[]}
 */
function buildPencilStrokeMutations(id, color, size, points = []) {
  return [
    {
      tool: Pencil.id,
      type: MutationType.CREATE,
      id,
      color,
      size,
    },
    ...points.map(({ x, y }) => ({
      tool: Pencil.id,
      type: MutationType.APPEND,
      parent: id,
      x,
      y,
    })),
  ];
}

test("BoardData processMessageBatch and per-message processing stay in sync", () => {
  const BoardData = getBoardDataClass();
  const single = disableSaves(
    createBoard(BoardData, "process-sequence-single"),
  );
  const batch = disableSaves(createBoard(BoardData, "process-sequence-batch"));

  const messages = [
    {
      tool: Pencil.id,
      type: MutationType.CREATE,
      id: "p-1",
      color: "#123456",
      size: 4,
    },
    {
      tool: Pencil.id,
      type: MutationType.APPEND,
      parent: "p-1",
      x: 10,
      y: 20,
    },
    {
      ...rectangleMessage("r-1", "#123456", 4, 2, 3, 10, 20),
    },
    {
      ...rectangleUpdate("r-1", {
        x: 5,
        y: 6,
        x2: 12,
        y2: 18,
      }),
    },
    handUpdate("r-1", { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }),
    handCopy("r-1", "r-2"),
    handDelete("r-2"),
    handUpdate("r-1", { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 }),
    eraserDelete("p-1"),
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

test("computeScheduledSaveDelayMs respects idle and max-delay deadlines", () => {
  const { computeScheduledSaveDelayMs } = require(BOARD_DATA_PATH);

  assert.equal(
    computeScheduledSaveDelayMs({
      nowMs: 1_000,
      dirtyFromMs: 1_000,
      lastWriteAtMs: 1_000,
      saveIntervalMs: 2_000,
      maxSaveDelayMs: 60_000,
    }),
    2_000,
  );
  assert.equal(
    computeScheduledSaveDelayMs({
      nowMs: 60_000,
      dirtyFromMs: 1_000,
      lastWriteAtMs: 60_000,
      saveIntervalMs: 2_000,
      maxSaveDelayMs: 60_000,
    }),
    1_000,
  );
  assert.equal(
    computeScheduledSaveDelayMs({
      nowMs: 62_000,
      dirtyFromMs: 1_000,
      lastWriteAtMs: 61_990,
      saveIntervalMs: 2_000,
      maxSaveDelayMs: 60_000,
    }),
    0,
  );
});

test("configuration rejects MAX_SAVE_DELAY below SAVE_INTERVAL", async () => {
  await assert.rejects(
    withEnv(
      {
        WBO_SAVE_INTERVAL: "2000",
        WBO_MAX_SAVE_DELAY: "1999",
      },
      async () => {
        await import(
          `${pathToFileURL(CONFIG_PATH).href}?invalid-save-config=${Date.now()}`
        );
      },
    ),
    /Invalid save timing config/,
  );
});

test("finalizePersistedItems leaves newer canonical revisions dirty", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(
    createBoard(BoardData, "finalize-persisted-snapshot"),
  );

  assert.equal(
    board.processMessage(
      textCreate({
        id: "text-1",
        x: 120,
        y: 140,
        color: "#111111",
        size: 18,
      }),
    ).ok,
    true,
  );
  assert.equal(
    board.processMessage(textUpdate("text-1", "before save")).ok,
    true,
  );

  const persistedSnapshot = new Map(board.itemsById);

  assert.equal(
    board.processMessage(textUpdate("text-1", "after save started")).ok,
    true,
  );

  board.finalizePersistedItems(persistedSnapshot);

  assert.deepEqual(board.get("text-1"), {
    id: "text-1",
    tool: "text",
    type: "text",
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
  const BoardData = getBoardDataClass();
  const board = disableSaves(
    createBoard(BoardData, "finalize-persisted-children"),
  );

  assertMessagesAccepted(
    board,
    buildPencilStrokeMutations("line-1", "#111111", 4, [{ x: 10, y: 20 }]),
  );

  const persistedSnapshot = new Map(board.itemsById);

  assertMessagesAccepted(
    board,
    buildPencilStrokeMutations("line-1", "#111111", 4, [
      { x: 25, y: 35 },
    ]).slice(1),
  );

  board.finalizePersistedItems(persistedSnapshot);

  const line = board.itemsById.get("line-1");
  assert.equal(line?.payload?.persistedChildCount, 1);
  assert.deepEqual(line?.payload?.appendedChildren, [{ x: 25, y: 35 }]);
  assert.equal(line?.dirty, true);
});

test("finalizePersistedItems keeps omitted pencil creates dirty until they serialize", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "finalize-omitted-pencil"));

  assertMessagesAccepted(
    board,
    buildPencilStrokeMutations("line-1", "#111111", 4),
  );

  const persistedSnapshot = new Map(board.itemsById);

  assertMessagesAccepted(
    board,
    buildPencilStrokeMutations("line-1", "#111111", 4, [
      { x: 10, y: 20 },
    ]).slice(1),
  );

  board.finalizePersistedItems(persistedSnapshot, new Set());

  const line = board.itemsById.get("line-1");
  assert.equal(line?.dirty, true);
  assert.equal(line?.payload?.persistedChildCount, 0);
  assert.deepEqual(line?.payload?.appendedChildren, [{ x: 10, y: 20 }]);
});

test("BoardData.save skips redundant clean saves once persisted state is current", async () => {
  await withBoardHistoryDir("wbo-save-skip-clean-", async ({ historyDir }) => {
    const BoardData = getBoardDataClass();
    const config = createConfig({ HISTORY_DIR: historyDir });
    const board = createBoard(BoardData, "skip-clean-save", config);
    const svgPath = path.join(historyDir, "board-skip-clean-save.svg");

    board.board = {
      "text-1": {
        id: "text-1",
        tool: "text",
        x: 1,
        y: 2,
        txt: "hi",
        size: 12,
        color: "#000000",
      },
    };

    await board.save();
    const firstStat = await fs.stat(svgPath);

    await new Promise((resolve) => setTimeout(resolve, 25));
    await board.save();

    const secondStat = await fs.stat(svgPath);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  });
});

test("scheduleSaveTimeout does not queue an autosave while a save is in progress", async () => {
  const BoardData = getBoardDataClass();
  const board = createBoard(BoardData, "skip-timer-during-save");
  let saveCalls = 0;

  board.saveInProgress = true;
  board.save = async () => {
    saveCalls += 1;
  };

  board.scheduleSaveTimeout(0);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(saveCalls, 0);
  assert.equal(board.saveTimeoutId, undefined);
});

test("BoardData.makeCopyCandidate derives copySource from persisted board membership", async () => {
  await withBoardHistoryDir(
    "wbo-copy-source-membership-",
    async ({ historyDir }) => {
      const { board } = await withLoadedBoard({
        historyDir,
        boardName: "copy-source-membership",
        storedSvg: buildStoredSvg({
          drawingArea:
            '<text id="text-1" x="10" y="20" font-size="18" fill="#123456">hello</text>',
        }),
      });

      const source = board.itemsById.get("text-1");
      const copied = board.makeCopyCandidate("text-2", source);

      assert.equal(copied.ok, true);
      assert.deepEqual(copied.value.copySource, {
        sourceId: "text-1",
      });
      assert.equal(copied.value.payload.modifiedText, undefined);
    },
  );
});

test("BoardData replays batch updates, copies, and deletes consistently", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "replay-board"));

  board.processMessage({
    _children: [
      rectangleMessage("rect-1", "#112233", 4, 0, 0, 10, 10),
      handUpdate("rect-1", { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 }),
      handCopy("rect-1", "rect-2"),
      eraserDelete("rect-1"),
    ],
  });

  assert.equal(board.get("rect-1"), undefined);
  assert.deepEqual(board.get("rect-2"), {
    tool: "rectangle",
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
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "paint-order-stability"));

  assertMessagesAccepted(board, [
    rectangleMessage("rect-1", "#112233", 4, 0, 0, 10, 10),
    rectangleMessage("rect-2", "#445566", 4, 20, 20, 30, 30),
  ]);

  const beforeOrder = [...board.paintOrder];

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      board.processMessage(
        handUpdate("rect-1", {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: index,
          f: index * 2,
        }),
      ).ok,
      true,
    );
  }

  assert.deepEqual(board.paintOrder, beforeOrder);
  assert.equal(board.paintOrder.length, 2);
});

test("BoardData applies parent tool metadata to batched Hand updates", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "hand-batch-board"));

  assertMessagesAccepted(board, [
    rectangleMessage("rect-1", "#112233", 4, 0, 0, 10, 10),
    {
      tool: Hand.id,
      _children: [
        handUpdate("rect-1", { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 }),
      ],
    },
  ]);

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
  const BoardData = getBoardDataClass();
  const board = disableSaves(
    createBoard(BoardData, "authoritative-count-clear"),
  );

  assertMessagesAccepted(board, [
    rectangleMessage("rect-1", "#112233", 4, 0, 0, 10, 10),
    rectangleMessage("rect-2", "#445566", 4, 20, 20, 30, 30),
  ]);

  assert.equal(board.authoritativeItemCount(), 2);

  assertMessagesAccepted(board, [clearMessage()]);

  assert.equal(board.authoritativeItemCount(), 0);
  assert.equal(board.get("rect-1"), undefined);
  assert.equal(board.get("rect-2"), undefined);
});

test("BoardData copy keeps pencil child arrays isolated", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "copy-pencil-isolation"));

  assertMessagesAccepted(board, [
    ...buildPencilStrokeMutations("p-1", "#123456", 4, [{ x: 10, y: 20 }]),
    handCopy("p-1", "p-2"),
    ...buildPencilStrokeMutations("p-1", "#123456", 4, [
      { x: 30, y: 40 },
    ]).slice(1),
  ]);

  assert.equal(board.get("p-1")._children.length, 2);
  assert.equal(board.get("p-2")._children.length, 1);
  assert.notStrictEqual(board.get("p-1")._children, board.get("p-2")._children);
});

test("BoardData.addChild enforces MAX_CHILDREN on stored strokes", () => {
  const BoardData = getBoardDataClass();
  const config = createConfig({ MAX_CHILDREN: 1 });
  const board = disableSaves(createBoard(BoardData, "child-cap-board", config));

  board.set("line-1", {
    tool: "pencil",
    type: "path",
    id: "line-1",
    color: "#123456",
    size: 4,
  });

  assert.equal(board.addChild("line-1", { x: 1, y: 2 }).ok, true);
  assert.equal(board.addChild("line-1", { x: 3, y: 4 }).ok, false);
  assert.deepEqual(board.get("line-1")._children, [{ x: 1, y: 2 }]);
});

test("BoardData rejects the first pencil child that makes a stroke oversized", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "oversized-pencil-board"));

  assert.equal(
    board.set("line-1", {
      tool: "pencil",
      type: "path",
      id: "line-1",
      color: "#123456",
      size: 4,
    }).ok,
    true,
  );

  assert.equal(board.addChild("line-1", { x: 0, y: 0 }).ok, true);
  assert.equal(board.addChild("line-1", { x: 31999, y: 0 }).ok, true);
  assert.equal(board.addChild("line-1", { x: 32001, y: 0 }).ok, false);
  assert.deepEqual(board.get("line-1")._children, [
    { x: 0, y: 0 },
    { x: 31999, y: 0 },
  ]);
});

test("BoardData rejects transform updates that make a stored shape oversized", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(
    createBoard(BoardData, "oversized-transform-board"),
  );

  assertMessagesAccepted(board, [
    rectangleMessage("rect-1", "#112233", 4, 0, 0, 10000, 10000),
  ]);

  assert.equal(
    board.processMessage(
      handUpdate("rect-1", { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 }),
    ).ok,
    false,
  );
  assert.equal(board.get("rect-1").transform, undefined);
});

test("BoardData drops zero-size seed shapes after an oversized update is rejected", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(
    createBoard(BoardData, "oversized-seed-shape-board"),
  );

  assertMessagesAccepted(board, [
    rectangleMessage("rect-1", "#112233", 4, 10, 10, 10, 10),
  ]);

  assert.equal(
    board.processMessage(
      rectangleUpdate("rect-1", {
        x: 10,
        y: 10,
        x2: 40015,
        y2: 30,
      }),
    ).ok,
    false,
  );
  assert.equal(board.get("rect-1"), undefined);
});

test("BoardData.preparePersistentMutation preserves seed-drop followups and stays in sync after them", async () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(
    createBoard(BoardData, "prepare-seed-followup-board"),
  );

  assertMessagesAccepted(board, [
    rectangleMessage("rect-1", "#112233", 4, 10, 10, 10, 10),
  ]);

  const oversizedUpdate = rectangleUpdate("rect-1", {
    x: 10,
    y: 10,
    x2: 40015,
    y2: 30,
  });

  assert.deepEqual(await board.preparePersistentMutation(oversizedUpdate), {
    ok: true,
    mutation: oversizedUpdate,
  });
  assert.equal(board.processMessage(oversizedUpdate).ok, false);
  assert.equal(board.get("rect-1"), undefined);
  assert.deepEqual(board.consumePendingRejectedMutationEffects(), [
    {
      mutation: {
        tool: Eraser.id,
        type: MutationType.DELETE,
        id: "rect-1",
      },
    },
  ]);

  assert.deepEqual(
    await board.preparePersistentMutation(handCopy("rect-1", "rect-2")),
    {
      ok: false,
      reason: "copied object does not exist",
    },
  );
});

test("BoardData rejects hand batches atomically when one transform is oversized", () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "atomic-hand-batch-board"));

  assertMessagesAccepted(board, [
    rectangleMessage("rect-1", "#112233", 4, 0, 0, 10000, 10000),
    rectangleMessage("rect-2", "#112233", 4, 0, 0, 100, 100),
  ]);

  assert.equal(
    board.processMessage({
      tool: Hand.id,
      _children: [
        handUpdate("rect-1", { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 }),
        handUpdate("rect-2", { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 }),
      ],
    }).ok,
    false,
  );
  assert.equal(board.get("rect-1").transform, undefined);
  assert.equal(board.get("rect-2").transform, undefined);
});

test("BoardData trims overflow by paint order instead of recency", () => {
  const BoardData = getBoardDataClass();
  const config = createConfig({ MAX_ITEM_COUNT: 2 });
  const board = disableSaves(createBoard(BoardData, "cleanup-board", config));

  assert.equal(
    board.processMessage(
      textCreate({
        id: "first",
        x: 10,
        y: 30,
        color: "#111111",
        size: 18,
        txt: "first",
      }),
    ).ok,
    true,
  );
  assert.equal(
    board.processMessage(
      textCreate({
        id: "second",
        x: 20,
        y: 20,
        color: "#222222",
        size: 18,
        txt: "second",
      }),
    ).ok,
    true,
  );
  assert.equal(
    board.processMessage(textUpdate("first", "first updated")).ok,
    true,
  );
  assert.equal(
    board.processMessage(
      textCreate({
        id: "third",
        x: 30,
        y: 30,
        color: "#333333",
        size: 18,
        txt: "third",
      }),
    ).ok,
    true,
  );

  assert.equal(board.get("first"), undefined);
  assert.deepEqual(Object.keys(board.board).sort(), ["second", "third"]);
  assert.deepEqual(
    board
      .consumePendingAcceptedMutationEffects()
      .map((/** @type {{mutation: any}} */ entry) => entry.mutation),
    [
      {
        tool: Eraser.id,
        type: MutationType.DELETE,
        id: "first",
      },
    ],
  );
});

test("BoardData.load normalizes stored board items from disk", async () => {
  await withBoardHistoryDir("wbo-board-data-load-", async ({ historyDir }) => {
    const BoardData = getBoardDataClass();
    const config = createConfig({ HISTORY_DIR: historyDir });
    await writeBoard(historyDir, "normalized-load", {
      bad1: {
        ...rectangleMessage(
          "wrong-id",
          "#abcdef",
          200,
          -100,
          "20.333",
          "70000",
          40,
        ),
        tool: "rectangle",
        type: "rect",
        opacity: 3,
        ignored: true,
      },
      bad2: {
        tool: "Unknown",
        id: "bad2",
      },
    });

    const board = await loadBoard(BoardData, "normalized-load", config);

    assert.equal(board.get("bad1"), undefined);
    assert.equal(board.get("bad2"), undefined);
  });
});

test("BoardData.load eagerly migrates legacy json boards to svg", async () => {
  await withBoardHistoryDir(
    "wbo-board-json-migrate-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({ HISTORY_DIR: historyDir });
      await writeBoard(historyDir, "legacy-migrate", {
        __wbo_meta__: { readonly: true },
        rect: {
          ...rectangleMessage("rect", "#123456", 4, 0, 0, 10, 10),
          tool: "rectangle",
          type: "rect",
        },
        pencil: {
          id: "pencil",
          tool: "pencil",
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
          tool: "text",
          type: "new",
          x: 360,
          y: 180,
          color: "#111111",
          size: 18,
          txt: "Slow sync",
        },
      });

      const board = await loadBoard(BoardData, "legacy-migrate", config);
      const svgPath = path.join(historyDir, "board-legacy-migrate.svg");
      const svg = await fs.readFile(svgPath, "utf8");

      assert.equal(board.metadata.readonly, true);
      assert.equal(board.get("rect").tool, "rectangle");
      assert.equal(board.get("pencil").tool, "pencil");
      assert.equal(board.get("text").tool, "text");
      assert.match(svg, /data-wbo-format="whitebophir-svg-v2"/);
      assert.match(svg, /data-wbo-readonly="true"/);
      assert.match(svg, /<rect id="rect" x="0" y="0" width="100" height="100"/);
      assert.match(svg, /<path id="pencil" d="M 600 800/);
      assert.match(svg, />Slow sync<\/text>/);
      assert.doesNotMatch(svg, /data-wbo-item|data-wbo-tool/);
    },
  );
});

test("BoardData eagerly loads canonical persisted svg items before applying updates", async () => {
  await withBoardHistoryDir(
    "wbo-board-lazy-hydrate-",
    async ({ historyDir }) => {
      const { board } = await withLoadedBoard({
        historyDir,
        boardName: "lazy-hydrate",
        storedSvg: buildStoredSvg({
          width: 5000,
          height: 5000,
          drawingArea:
            '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>',
        }),
      });
      assert.deepEqual(board.get("rect-1"), {
        id: "rect-1",
        tool: "rectangle",
        x: 1,
        y: 2,
        x2: 3,
        y2: 4,
        color: "#123456",
        size: 4,
      });

      const updateRect = rectangleUpdate("rect-1", { x2: 30, y2: 40 });
      await applyPersistentMutation(board, updateRect, 1);
      assert.deepEqual(
        {
          ...board.get("rect-1"),
          time: undefined,
        },
        {
          id: "rect-1",
          tool: "rectangle",
          x: 1,
          y: 2,
          x2: 30,
          y2: 40,
          color: "#123456",
          size: 4,
          time: undefined,
        },
      );
    },
  );
});

test("BoardData records contiguous mutation seq values and persists them into svg baselines", async () => {
  await withBoardHistoryDir("wbo-board-seq-save-", async ({ historyDir }) => {
    const BoardData = getBoardDataClass();
    const config = createConfig({ HISTORY_DIR: historyDir });
    const board = createBoard(BoardData, "seq-save", config);

    const message = {
      id: "rect-1",
      tool: Rectangle.id,
      type: MutationType.CREATE,
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    };

    assert.equal(board.processMessage({ ...message }).ok, true);
    const firstEntry = board.recordPersistentMutation(message, 100);
    const secondEntry = board.recordPersistentMutation(
      eraserDelete("rect-1"),
      200,
    );

    assert.equal(firstEntry.seq, 1);
    assert.equal(secondEntry.seq, 2);
    assert.equal(Object.hasOwn(firstEntry, "board"), false);
    assert.equal(Object.hasOwn(firstEntry, "clientMutationId"), false);
    assert.equal(Object.hasOwn(firstEntry, "socketId"), false);
    assert.equal(board.getSeq(), 2);
    assert.equal(board.minReplayableSeq(), 0);
    assert.deepEqual(
      board
        .readMutationsAfter(0)
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

test("BoardData does not mutate create messages while accepting them", async () => {
  const BoardData = getBoardDataClass();
  const board = disableSaves(createBoard(BoardData, "message-immutability"));
  const message = rectangleMessage("rect-1", "#123456", 4, 0, 0, 10, 10);

  assert.equal(board.processMessage(message).ok, true);
  assert.equal(message.time, undefined);
  assert.equal(board.get("rect-1")?.id, "rect-1");
  assert.equal(board.get("rect-1")?.time !== undefined, true);
});

test("BoardData.save trims persisted replay history past the configured retention window", async () => {
  await withBoardHistoryDir(
    "wbo-board-replay-retention-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({
        HISTORY_DIR: historyDir,
        SEQ_REPLAY_RETENTION_MS: 0,
      });
      const board = disableSaves(
        createBoard(BoardData, "replay-retention", config),
      );
      const first = rectangleMessage("rect-1", "#123456", 4, 0, 0, 10, 10);
      const second = rectangleMessage("rect-2", "#654321", 4, 20, 20, 30, 30);

      assertMessagesAccepted(board, [first, second]);
      board.recordPersistentMutation(first, 1);
      board.recordPersistentMutation(second, 2);

      await board.save();

      assert.equal(board.getPersistedSeq(), 2);
      assert.equal(board.minReplayableSeq(), 2);
      assert.deepEqual(
        board
          .readMutationsAfter(0)
          .map((/** @type {{seq: number}} */ entry) => entry.seq),
        [],
      );
    },
    { WBO_SEQ_REPLAY_RETENTION_MS: "0" },
  );
});

test("BoardData.save keeps persisted replay history needed by pinned baselines", async () => {
  await withBoardHistoryDir(
    "wbo-board-pinned-replay-retention-",
    async ({ historyDir }) => {
      resetBoardRegistry();
      try {
        const BoardData = getBoardDataClass();
        const config = createConfig({
          HISTORY_DIR: historyDir,
          SEQ_REPLAY_RETENTION_MS: 0,
        });
        const board = disableSaves(
          createBoard(BoardData, "pinned-replay-retention", config),
        );
        const first = rectangleMessage("rect-1", "#123456", 4, 0, 0, 10, 10);
        const second = rectangleMessage("rect-2", "#654321", 4, 20, 20, 30, 30);

        assertMessagesAccepted(board, [first, second]);
        board.recordPersistentMutation(first, 1);
        board.recordPersistentMutation(second, 2);
        pinReplayBaseline(board.name, 0, Number.MAX_SAFE_INTEGER);

        await board.save();

        assert.equal(board.getPersistedSeq(), 2);
        assert.equal(board.minReplayableSeq(), 0);
        assert.deepEqual(
          board
            .readMutationsAfter(0)
            .map((/** @type {{seq: number}} */ entry) => entry.seq),
          [1, 2],
        );
      } finally {
        resetBoardRegistry();
      }
    },
    { WBO_SEQ_REPLAY_RETENTION_MS: "0" },
  );
});

test("BoardData.save keeps writing to the board's original history dir after env changes", async () => {
  /** @type {InstanceType<typeof import("../server/boardData.mjs").BoardData> | undefined} */
  let board;
  let historyDir;
  await withBoardHistoryDir("wbo-board-sticky-history-", async (context) => {
    historyDir = context.historyDir;
    const BoardData = getBoardDataClass();
    const config = createConfig({ HISTORY_DIR: context.historyDir });
    board = createBoard(BoardData, "sticky-history", config);
    const stickyBoard =
      /** @type {InstanceType<typeof import("../server/boardData.mjs").BoardData>} */ (
        board
      );
    const rect = rectangleMessage("rect-1", "#654321", 4, 0, 0, 10, 10);
    stickyBoard.processMessage(rect);
    stickyBoard.recordPersistentMutation(rect);
    clearTimeout(stickyBoard.saveTimeoutId);
    stickyBoard.saveTimeoutId = undefined;
  });
  assert.ok(board);
  assert.ok(historyDir);
  const stickyBoard = board;

  await stickyBoard.save();

  const svg = await fs.readFile(
    path.join(historyDir, "board-sticky-history.svg"),
    "utf8",
  );
  assert.match(svg, /data-wbo-seq="1"/);
});

test("BoardData.save rewrites existing stored svg from queued mutations", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-rewrite-",
    async ({ historyDir }) => {
      const existingSvg = buildStoredSvg({
        defs: '<style>.keep-me{}</style><marker id="m1"></marker>',
        drawingArea:
          '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
          '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>',
        cursors: '<path id="cursor-template"></path>',
      });
      const { board, svgPath } = await withLoadedBoard({
        historyDir,
        boardName: "rewrite-save",
        storedSvg: existingSvg,
      });
      const updateRect = rectangleUpdate("rect-1", { x2: 30, y2: 40 });
      const copyRect = handCopy("rect-1", "rect-2");
      const deleteText = eraserDelete("text-1");
      await applyPersistentMutations(
        board,
        [updateRect, copyRect, deleteText],
        2,
      );

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
    },
  );
});

test("BoardData.save treats a missing persisted baseline as a stale writer", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-missing-baseline-stale-",
    async ({ historyDir }) => {
      const existingSvg = buildStoredSvg({
        defs: "<style>.keep-me{}</style>",
        drawingArea:
          '<text id="text-1" x="5" y="6" font-size="18" fill="#654321">hello</text>',
      });
      const { board, svgPath } = await withLoadedBoard({
        historyDir,
        boardName: "missing-baseline-stale",
        storedSvg: existingSvg,
      });
      await fs.unlink(svgPath);
      await applyPersistentMutation(
        board,
        rectangleMessage("rect-2", "#654321", 5, 10, 20, 30, 40),
        2,
      );

      const result = await board.save();

      assert.deepEqual(result, { status: "stale" });
      await assert.rejects(fs.stat(svgPath), { code: "ENOENT" });
      assert.equal(board.getPersistedSeq(), 1);
      assert.equal(board.getSeq(), 2);
      assert.deepEqual(Object.keys(board.board).sort(), ["rect-2", "text-1"]);
    },
  );
});

test("BoardData.save tolerates a missing file while only unreconstructible items remain", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-missing-pencil-baseline-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({ HISTORY_DIR: historyDir });
      const svgPath = path.join(
        historyDir,
        "board-missing-pencil-baseline.svg",
      );
      const board = await loadBoard(
        BoardData,
        "missing-pencil-baseline",
        config,
      );

      await applyPersistentMutation(
        board,
        buildPencilStrokeMutations("pencil-1", "#123456", 3)[0],
        1,
      );

      await board.save();
      await assert.rejects(fs.stat(svgPath), { code: "ENOENT" });

      await applyPersistentMutations(
        board,
        buildPencilStrokeMutations("pencil-1", "#123456", 3, [
          { x: 10, y: 20 },
          { x: 15, y: 25 },
        ]).slice(1),
        2,
      );

      await board.save();

      const savedSvg = await fs.readFile(svgPath, "utf8");
      assert.match(savedSvg, /id="pencil-1"/);
    },
  );
});

test("BoardData.save treats a missing baseline and backup before a new seed stroke completes as stale", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-missing-baseline-seed-stale-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({ HISTORY_DIR: historyDir });
      const svgPath = path.join(
        historyDir,
        "board-missing-baseline-seed-stale.svg",
      );
      const board = createBoard(
        BoardData,
        "missing-baseline-seed-stale",
        config,
      );

      await applyPersistentMutations(
        board,
        buildPencilStrokeMutations("pencil-1", "#123456", 3, [
          { x: 10, y: 20 },
          { x: 15, y: 25 },
        ]),
        1,
      );

      await board.save();
      await fs.unlink(svgPath);
      await fs.unlink(`${svgPath}.bak`);

      await applyPersistentMutation(
        board,
        buildPencilStrokeMutations("pencil-2", "#654321", 2)[0],
        4,
      );

      const result = await board.save();

      assert.deepEqual(result, { status: "stale" });
      await assert.rejects(fs.stat(svgPath), { code: "ENOENT" });
      assert.equal(board.hasPersistedBaseline, true);
      assert.deepEqual(Object.keys(board.board).sort(), [
        "pencil-1",
        "pencil-2",
      ]);
    },
  );
});

test("BoardData.dispose prevents queued autosaves from a stale board instance", async () => {
  await withBoardHistoryDir(
    "wbo-board-dispose-stale-save-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({ HISTORY_DIR: historyDir });
      const svgPath = path.join(historyDir, "board-anonymous.svg");
      const staleBoard = createBoard(BoardData, "anonymous", config);

      await applyPersistentMutations(
        staleBoard,
        buildPencilStrokeMutations("pencil-1", "#123456", 3, [
          { x: 10, y: 20 },
          { x: 15, y: 25 },
        ]),
        1,
      );
      await staleBoard.save();
      await fs.unlink(svgPath);

      await applyPersistentMutation(
        staleBoard,
        buildPencilStrokeMutations("pencil-2", "#654321", 2)[0],
        4,
      );
      staleBoard.dispose();

      const currentBoard = await loadBoard(BoardData, "anonymous", config);
      await applyPersistentMutation(
        currentBoard,
        rectangleMessage("rect-1", "#222222", 2, 1, 2, 3, 4),
        5,
      );
      await currentBoard.save();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const savedSvg = await fs.readFile(svgPath, "utf8");
      assert.match(savedSvg, /id="rect-1"/);
      assert.equal(savedSvg.includes('id="pencil-2"'), false);
    },
  );
});

test("BoardData.save preserves cold-loaded stored svg when there are no pending mutations", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-cold-noop-",
    async ({ historyDir }) => {
      const existingSvg = buildStoredSvg({
        seq: 7,
        defs: '<marker id="m1"></marker>',
        drawingArea:
          '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>' +
          '<path id="line-1" d="M 1 2 l 0 0 l 2 2" stroke="#654321" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>',
        cursors: '<path id="cursor-template"></path>',
      });
      const { board, svgPath } = await withLoadedBoard({
        historyDir,
        boardName: "cold-noop",
        storedSvg: existingSvg,
      });

      assert.deepEqual(Object.keys(board.board).sort(), ["line-1", "rect-1"]);
      await board.save();

      assert.equal(await fs.readFile(svgPath, "utf8"), existingSvg);
    },
  );
});

test("BoardData.save preserves cold-loaded state when only the backup svg remains", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-cold-backup-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({ HISTORY_DIR: historyDir });
      const svgBoardStore = require("../server/svg_board_store.mjs");
      const boardName = "cold-backup";
      const svgPath = path.join(historyDir, "board-cold-backup.svg");

      await svgBoardStore.writeBoardState(
        boardName,
        {
          "line-1": {
            id: "line-1",
            tool: "pencil",
            color: "#654321",
            size: 5,
            _children: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
            ],
          },
        },
        { readonly: false },
        7,
        { historyDir },
      );
      await fs.unlink(svgPath);

      const board = await loadBoard(BoardData, boardName, config);
      assert.equal(board.loadSource, "svg_backup");
      assert.deepEqual(Object.keys(board.board), ["line-1"]);

      await board.save();

      const reloaded = await loadBoard(BoardData, boardName, config);
      assert.equal(reloaded.loadSource, "svg_backup");
      assert.deepEqual(Object.keys(reloaded.board), ["line-1"]);
    },
  );
});

test("BoardData.save persists canonical test-injected board items through the board setter", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-direct-memory-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({ HISTORY_DIR: historyDir });
      const board = createBoard(BoardData, "direct-memory-save", config);
      board.board = {
        "text-1": {
          id: "text-1",
          tool: "text",
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
    },
  );
});

test("BoardData.save keeps eagerly loaded canonical items and applies streamed svg updates", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-streaming-sparse-",
    async ({ historyDir }) => {
      const BoardData = getBoardDataClass();
      const config = createConfig({ HISTORY_DIR: historyDir });
      const svgBoardStore = require("../server/svg_board_store.mjs");
      const boardName = "streaming-sparse";

      await svgBoardStore.writeBoardState(
        boardName,
        {
          "item-0": {
            id: "item-0",
            tool: "pencil",
            color: "#123456",
            size: 2,
            _children: [
              { x: 0, y: 0 },
              { x: 2, y: 1 },
            ],
          },
          "item-1": {
            id: "item-1",
            tool: "straight-line",
            color: "#123456",
            size: 2,
            x: 1,
            y: 2,
            x2: 5,
            y2: 6,
          },
          "item-2": {
            id: "item-2",
            tool: "text",
            x: 3,
            y: 24,
            txt: "hello",
            size: 18,
            color: "#654321",
          },
          "item-3": {
            ...rectangleMessage("item-3", "#123456", 2, 5, 6, 9, 12),
            tool: "rectangle",
            type: "rect",
          },
          "item-4": {
            id: "item-4",
            tool: "ellipse",
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

      const board = await loadBoard(BoardData, boardName, config);
      assert.deepEqual(Object.keys(board.board).sort(), [
        "item-0",
        "item-1",
        "item-2",
        "item-3",
        "item-4",
      ]);

      await applyPersistentMutations(
        board,
        [
          rectangleUpdate("item-3", { x2: 15, y2: 18 }),
          textUpdate("item-2", "hello streaming"),
          {
            tool: Pencil.id,
            type: MutationType.APPEND,
            parent: "item-0",
            x: 4,
            y: 2,
          },
          handCopy("item-3", "item-3-copy"),
          rectangleMessage("item-new", "#abcdef", 3, 20, 21, 28, 29),
        ],
        1,
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
    },
  );
});

test("BoardData.save leaves the stored svg unchanged on seq mismatch", async () => {
  await withBoardHistoryDir(
    "wbo-board-save-rewrite-mismatch-",
    async ({ historyDir }) => {
      const existingSvg = buildStoredSvg({
        defs: '<style>.keep-me{}</style><marker id="m1"></marker>',
        drawingArea:
          '<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"></rect>',
        cursors: '<path id="cursor-template"></path>',
      });
      const { board, svgPath } = await withLoadedBoard({
        historyDir,
        boardName: "rewrite-mismatch",
        storedSvg: existingSvg,
      });
      await fs.writeFile(
        svgPath,
        existingSvg.replace('data-wbo-seq="1"', 'data-wbo-seq="99"'),
        "utf8",
      );
      const updateRect = rectangleUpdate("rect-1", { x2: 30, y2: 40 });
      await applyPersistentMutation(board, updateRect, 2);

      /** @type {Array<{name: string, fields: any}>} */
      const warnings = [];
      const originalWarn = observability.logger.warn;
      observability.logger.warn = (name, fields) => {
        warnings.push({ name, fields });
      };
      let result;
      try {
        result = await board.save();
      } finally {
        observability.logger.warn = originalWarn;
      }

      assert.deepEqual(result, { status: "stale" });
      assert.equal(warnings.length, 1);
      const warning = warnings[0];
      assert.ok(warning);
      assert.equal(warning.name, "board.save_stale");
      assert.equal(warning.fields.error, undefined);
      assert.equal(warning.fields["exception.stacktrace"], undefined);
      assert.equal(warning.fields["wbo.board.stale_reason"], "seq_mismatch");
      const rewritten = await fs.readFile(svgPath, "utf8");
      assert.match(rewritten, /data-wbo-seq="99"/);
      assert.match(
        rewritten,
        /<rect id="rect-1" x="1" y="2" width="2" height="2" stroke="#123456" stroke-width="4" fill="none"><\/rect>/,
      );
    },
  );
});

test("BoardData.save serializes concurrent saves and releases after failure", async () => {
  const BoardData = getBoardDataClass();
  const board = createBoard(BoardData, "serial-save-board");
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

test("BoardData.save serializes concurrent saves across boards", async () => {
  const BoardData = getBoardDataClass();
  const firstBoard = createBoard(BoardData, "global-save-queue-first");
  const secondBoard = createBoard(BoardData, "global-save-queue-second");
  /** @type {string[]} */
  const calls = [];
  /** @type {(value?: void) => void} */
  let releaseFirstSave = () => {};
  const firstSaveGate = new Promise((resolve) => {
    releaseFirstSave = resolve;
  });

  firstBoard._unsafe_save = async () => {
    calls.push("first:start");
    await firstSaveGate;
    calls.push("first:end");
    return { status: "saved" };
  };
  secondBoard._unsafe_save = async () => {
    calls.push("second:start");
    calls.push("second:end");
    return { status: "saved" };
  };

  const firstSave = firstBoard.save().then(() => {
    calls.push("first:resolved");
  });
  const secondSave = secondBoard.save().then(() => {
    calls.push("second:resolved");
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["first:start"]);

  releaseFirstSave();
  await Promise.all([firstSave, secondSave]);

  assert.equal(calls[0], "first:start");
  assert.equal(calls[1], "first:end");
  assert.equal(calls[2], "second:start");
  assert.equal(calls[3], "second:end");
  assert.equal(calls.includes("first:resolved"), true);
  assert.equal(calls[calls.length - 1], "second:resolved");
});
