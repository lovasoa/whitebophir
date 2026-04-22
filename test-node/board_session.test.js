const test = require("node:test");
const assert = require("node:assert/strict");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BOARD_SESSION_PATH = path.join(
  __dirname,
  "..",
  "server",
  "board_session.mjs",
);
let boardSessionLoadSequence = 0;

/**
 * @returns {Promise<any>}
 */
async function loadBoardSession() {
  return import(
    `${pathToFileURL(BOARD_SESSION_PATH).href}?cache-bust=${++boardSessionLoadSequence}`
  );
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
    recordPersistentMutation(/** @type {any} */ message) {
      seq += 1;
      steps.push(`record:${message.id}`);
      return { seq, mutation: message };
    },
  };
  const session = createBoardSession(board);

  const first = session.acceptPersistentMutation(
    "socket-1",
    { tool: "rectangle", type: MutationType.CREATE, id: "first" },
    "cm-1",
    10,
  );
  const second = session.acceptPersistentMutation(
    "socket-1",
    { tool: "rectangle", type: MutationType.CREATE, id: "second" },
    "cm-2",
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
  assert.equal(firstResult.envelope.seq, 1);
  assert.equal(secondResult.envelope.seq, 2);
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
      /** @type {any} */ clientMutationId,
      /** @type {any} */ socketId,
    ) {
      recorded.push({ message, acceptedAtMs, clientMutationId, socketId });
      return { seq: 5, mutation: message, clientMutationId, socketId };
    },
  };

  const result = await createBoardSession(board).acceptPersistentMutation(
    "socket-1",
    { tool: "text", type: MutationType.UPDATE, id: "text-1", txt: "draft" },
    "cm-9",
    99,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(processed, [
    {
      tool: "text",
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "prepared text",
    },
  ]);
  assert.deepEqual(recorded, [
    {
      message: {
        tool: "text",
        type: MutationType.UPDATE,
        id: "text-1",
        txt: "prepared text",
      },
      acceptedAtMs: 99,
      clientMutationId: "cm-9",
      socketId: "socket-1",
    },
  ]);
});

test("board session does not mutate or replace the accepted mutation when preparation is a pass-through", async () => {
  const { createBoardSession } = await loadBoardSession();
  /** @type {any[]} */
  const processed = [];
  const mutation = {
    tool: "rectangle",
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
    "socket-1",
    mutation,
    "cm-1",
    1,
  );

  assert.equal(result.ok, true);
  assert.strictEqual(processed[0], mutation);
  assert.strictEqual(result.value, mutation);
  assert.deepEqual(mutation, {
    tool: "rectangle",
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
      "socket-1",
      {
        tool: "pencil",
        type: MutationType.APPEND,
        parent: "missing-parent",
        x: 1,
        y: 2,
      },
      "cm-reject",
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
            tool: "eraser",
            type: MutationType.DELETE,
            id: "rect-seed",
          },
        },
      ];
    },
    recordPersistentMutation(
      /** @type {any} */ message,
      /** @type {any} */ acceptedAtMs,
      /** @type {any} */ clientMutationId,
    ) {
      recorded.push({ message, acceptedAtMs, clientMutationId });
      return {
        seq: 9,
        mutation: message,
      };
    },
  };

  const result = await createBoardSession(board).acceptPersistentMutation(
    "socket-1",
    {
      tool: "rectangle",
      type: MutationType.UPDATE,
      id: "rect-seed",
      x: 0,
      y: 0,
      x2: 5000,
      y2: 20,
    },
    "cm-reject-followup",
    55,
  );

  assert.deepEqual(recorded, [
    {
      message: {
        tool: "eraser",
        type: MutationType.DELETE,
        id: "rect-seed",
      },
      acceptedAtMs: 55,
      clientMutationId: undefined,
    },
  ]);
  assert.deepEqual(result, {
    ok: false,
    reason: "update rejected: shape too large",
    followup: [
      {
        envelope: {
          seq: 9,
          mutation: {
            tool: "eraser",
            type: MutationType.DELETE,
            id: "rect-seed",
          },
        },
        mutation: {
          tool: "eraser",
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
            tool: "eraser",
            type: MutationType.DELETE,
            id: "rect-1",
          },
        },
      ];
    },
    recordPersistentMutation(
      /** @type {any} */ message,
      /** @type {any} */ acceptedAtMs,
      /** @type {any} */ clientMutationId,
    ) {
      recorded.push({ message, acceptedAtMs, clientMutationId });
      return {
        seq: recorded.length,
        mutation: message,
      };
    },
  };

  const result = await createBoardSession(board).acceptPersistentMutation(
    "socket-1",
    {
      tool: "rectangle",
      type: MutationType.CREATE,
      id: "rect-2",
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    },
    "cm-ok-followup",
    33,
  );

  assert.deepEqual(recorded, [
    {
      message: {
        tool: "rectangle",
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
      clientMutationId: "cm-ok-followup",
    },
    {
      message: {
        tool: "eraser",
        type: MutationType.DELETE,
        id: "rect-1",
      },
      acceptedAtMs: 33,
      clientMutationId: undefined,
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      tool: "rectangle",
      type: MutationType.CREATE,
      id: "rect-2",
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
    },
    envelope: {
      seq: 1,
      mutation: {
        tool: "rectangle",
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
        envelope: {
          seq: 2,
          mutation: {
            tool: "eraser",
            type: MutationType.DELETE,
            id: "rect-1",
          },
        },
        mutation: {
          tool: "eraser",
          type: MutationType.DELETE,
          id: "rect-1",
        },
      },
    ],
  });
});
