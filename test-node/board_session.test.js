const test = require("node:test");
const assert = require("node:assert/strict");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const {
  Eraser,
  Pencil,
  Rectangle,
  Text,
} = require("../client-data/tools/index.js");
const path = require("node:path");

const BOARD_SESSION_PATH = path.join(
  __dirname,
  "..",
  "server",
  "board",
  "session.mjs",
);

/**
 * @returns {Promise<any>}
 */
async function loadBoardSession() {
  return require(BOARD_SESSION_PATH);
}

function createGate() {
  /** @type {(value?: void) => void} */
  let resolve = () => {};
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("board session serializes persistent mutation acceptance per board", async () => {
  const { createBoardSession } = await loadBoardSession();
  const gate = createGate();
  /** @type {string[]} */
  const steps = [];
  let seq = 0;
  const board = {
    name: "session-serialization",
    async preparePersistentMutation(/** @type {any} */ message) {
      steps.push(`prepare:${message.id}`);
      if (message.id === "first") {
        await gate.promise;
      }
      return { ok: true, mutation: message };
    },
    processMessage(/** @type {any} */ message) {
      steps.push(`process:${message.id}`);
      return { ok: true };
    },
    recordPersistentMutation(
      /** @type {any} */ message,
      /** @type {any} */ acceptedAtMs,
    ) {
      seq += 1;
      steps.push(`record:${message.id}`);
      return { seq, acceptedAtMs, mutation: message };
    },
  };
  const session = createBoardSession(board);

  const first = session.acceptPersistentMutation(
    { tool: Rectangle.id, type: MutationType.CREATE, id: "first" },
    10,
  );
  const second = session.acceptPersistentMutation(
    { tool: Rectangle.id, type: MutationType.CREATE, id: "second" },
    20,
  );

  await Promise.resolve();
  assert.deepEqual(steps, ["prepare:first"]);

  gate.resolve();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.deepEqual(steps, [
    "prepare:first",
    "process:first",
    "record:first",
    "prepare:second",
    "process:second",
    "record:second",
  ]);
  assert.equal(firstResult.entry.seq, 1);
  assert.equal(secondResult.entry.seq, 2);
});

test("board session records the prepared mutation payload", async () => {
  const { createBoardSession } = await loadBoardSession();
  /** @type {any[]} */
  const processed = [];
  /** @type {any[]} */
  const recorded = [];
  const board = {
    name: "session-prepared-mutation",
    preparePersistentMutation(/** @type {any} */ message) {
      return {
        ok: true,
        mutation: { ...message, txt: "prepared text" },
      };
    },
    processMessage(/** @type {any} */ message) {
      processed.push(message);
      return { ok: true };
    },
    recordPersistentMutation(
      /** @type {any} */ message,
      /** @type {any} */ acceptedAtMs,
    ) {
      recorded.push({ message, acceptedAtMs });
      return { seq: 5, acceptedAtMs, mutation: message };
    },
  };

  const result = await createBoardSession(board).acceptPersistentMutation(
    {
      tool: Text.id,
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "draft",
    },
    99,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(processed, [
    {
      tool: Text.id,
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "prepared text",
    },
  ]);
  assert.deepEqual(recorded, [
    {
      message: {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-1",
        txt: "prepared text",
      },
      acceptedAtMs: 99,
    },
  ]);
});

test("board session does not mutate or replace the accepted mutation when preparation is a pass-through", async () => {
  const { createBoardSession } = await loadBoardSession();
  /** @type {any[]} */
  const processed = [];
  const mutation = {
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-1",
    color: "#123456",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
  };
  const board = {
    name: "session-pass-through-mutation",
    preparePersistentMutation(/** @type {any} */ message) {
      assert.strictEqual(message, mutation);
      return { ok: true, mutation: message };
    },
    processMessage(/** @type {any} */ message) {
      processed.push(message);
      return { ok: true };
    },
    recordPersistentMutation(/** @type {any} */ message) {
      return { seq: 1, mutation: message };
    },
  };

  const result = await createBoardSession(board).acceptPersistentMutation(
    mutation,
    1,
  );

  assert.equal(result.ok, true);
  assert.strictEqual(processed[0], mutation);
  assert.strictEqual(result.value, mutation);
  assert.deepEqual(mutation, {
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-1",
    color: "#123456",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
  });
});

test("board session does not append to the mutation log after rejection", async () => {
  const { createBoardSession } = await loadBoardSession();
  let recordCount = 0;
  const board = {
    name: "session-rejected-mutation",
    processMessage() {
      return { ok: false, reason: "invalid parent for child" };
    },
    recordPersistentMutation() {
      recordCount += 1;
      return { seq: 1 };
    },
  };

  assert.deepEqual(
    await createBoardSession(board).acceptPersistentMutation(
      {
        tool: Pencil.id,
        type: MutationType.APPEND,
        parent: "missing-parent",
        x: 1,
        y: 2,
      },
      12,
    ),
    {
      ok: false,
      reason: "invalid parent for child",
    },
  );
  assert.equal(recordCount, 0);
});

test("board session appends sequenced followups generated during rejection", async () => {
  const { createBoardSession } = await loadBoardSession();
  /** @type {any[]} */
  const recorded = [];
  const board = {
    name: "session-rejected-followup",
    processMessage() {
      return { ok: false, reason: "update rejected: shape too large" };
    },
    consumePendingRejectedMutationEffects() {
      return [
        {
          mutation: {
            tool: Eraser.id,
            type: MutationType.DELETE,
            id: "rect-seed",
          },
        },
      ];
    },
    recordPersistentMutation(
      /** @type {any} */ message,
      /** @type {any} */ acceptedAtMs,
    ) {
      recorded.push({ message, acceptedAtMs });
      return {
        seq: 9,
        acceptedAtMs,
        mutation: message,
      };
    },
  };

  const result = await createBoardSession(board).acceptPersistentMutation(
    {
      tool: Rectangle.id,
      type: MutationType.UPDATE,
      id: "rect-seed",
      x: 0,
      y: 0,
      x2: 5000,
      y2: 20,
    },
    55,
  );

  assert.deepEqual(recorded, [
    {
      message: {
        tool: Eraser.id,
        type: MutationType.DELETE,
        id: "rect-seed",
      },
      acceptedAtMs: 55,
    },
  ]);
  assert.deepEqual(result, {
    ok: false,
    reason: "update rejected: shape too large",
    followup: [
      {
        seq: 9,
        acceptedAtMs: 55,
        mutation: {
          tool: Eraser.id,
          type: MutationType.DELETE,
          id: "rect-seed",
        },
      },
    ],
  });
});

test("board session appends sequenced followups generated during successful acceptance", async () => {
  const { createBoardSession } = await loadBoardSession();
  /** @type {any[]} */
  const recorded = [];
  const board = {
    name: "session-accepted-followup",
    processMessage() {
      return { ok: true };
    },
    consumePendingAcceptedMutationEffects() {
      return [
        {
          mutation: {
            tool: Eraser.id,
            type: MutationType.DELETE,
            id: "rect-1",
          },
        },
      ];
    },
    recordPersistentMutation(
      /** @type {any} */ message,
      /** @type {any} */ acceptedAtMs,
    ) {
      recorded.push({ message, acceptedAtMs });
      return {
        seq: recorded.length,
        acceptedAtMs,
        mutation: message,
      };
    },
  };

  const result = await createBoardSession(board).acceptPersistentMutation(
    {
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: "rect-2",
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    },
    33,
  );

  assert.deepEqual(recorded, [
    {
      message: {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "rect-2",
        color: "#123456",
        size: 4,
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
      },
      acceptedAtMs: 33,
    },
    {
      message: {
        tool: Eraser.id,
        type: MutationType.DELETE,
        id: "rect-1",
      },
      acceptedAtMs: 33,
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: "rect-2",
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    },
    entry: {
      seq: 1,
      acceptedAtMs: 33,
      mutation: {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "rect-2",
        color: "#123456",
        size: 4,
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
      },
    },
    followup: [
      {
        seq: 2,
        acceptedAtMs: 33,
        mutation: {
          tool: Eraser.id,
          type: MutationType.DELETE,
          id: "rect-1",
        },
      },
    ],
  });
});
