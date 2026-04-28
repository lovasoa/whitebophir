const test = require("node:test");
const assert = require("node:assert/strict");

const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Hand, Rectangle } = require("../client-data/tools/index.js");
const { TOOL_CODE_BY_ID } = require("../client-data/tools/tool-order.js");
const { collectOptimisticAffectedIds, collectOptimisticDependencyIds } =
  require("../client-data/js/optimistic_mutation.js");
const {
  optimisticPrunePlanForAuthoritativeMessage,
} = require("../client-data/js/authoritative_mutation_effects.js");
const {
  createOptimisticJournal,
} = require("../client-data/js/optimistic_journal.js");

/** @typedef {import("../types/app-runtime").ClientTrackedMessage} ClientTrackedMessage */
/** @typedef {import("../types/app-runtime").LiveBoardMessage} LiveBoardMessage */
/** @typedef {import("../types/app-runtime").OptimisticRollback} OptimisticRollback */
/** @typedef {import("../types/app-runtime").OptimisticJournalState} OptimisticJournalState */

const IDENTITY_TRANSFORM = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** @param {string} id */
function rectCreate(id) {
  return {
    tool: Rectangle.id,
    id,
    type: MutationType.CREATE,
    color: "#123456",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
  };
}

/** @param {string} id */
function rectUpdate(id) {
  return {
    tool: Rectangle.id,
    id,
    type: MutationType.UPDATE,
    x: 0,
    y: 0,
    x2: 20,
    y2: 20,
  };
}

/** @param {string} id */
function handUpdate(id) {
  return {
    tool: Hand.id,
    type: MutationType.UPDATE,
    id,
    transform: IDENTITY_TRANSFORM,
  };
}

/**
 * @param {OptimisticJournalState} journal
 * @param {ClientTrackedMessage} message
 */
function trackOptimisticMessage(journal, message) {
  journal.append({
    affectedIds: collectOptimisticAffectedIds(message),
    dependsOn: journal.dependencyMutationIdsForItemIds(
      collectOptimisticDependencyIds(message),
    ),
    dependencyItemIds: collectOptimisticDependencyIds(message),
    rollback: { kind: "items", snapshots: [] },
    message,
  });
}

/**
 * @param {OptimisticJournalState} journal
 * @param {{clientMutationId: string, affectedIds: string[], dependsOn: string[], dependencyItemIds?: string[], rollback: OptimisticRollback, message: LiveBoardMessage}} entry
 */
function appendOptimisticEntry(journal, entry) {
  entry.message.clientMutationId = entry.clientMutationId;
  return journal.append({
    affectedIds: entry.affectedIds,
    dependsOn: entry.dependsOn,
    dependencyItemIds: entry.dependencyItemIds,
    rollback: entry.rollback,
    message: /** @type {ClientTrackedMessage} */ (entry.message),
  });
}

test("optimistic journal appends and promotes entries in order", () => {
  const journal = createOptimisticJournal();
  appendOptimisticEntry(journal, {
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: rectCreate("shape-1"),
  });
  appendOptimisticEntry(journal, {
    clientMutationId: "c2",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: rectCreate("shape-2"),
  });

  assert.deepEqual(
    journal.list().map((entry) => entry.clientMutationId),
    ["c1", "c2"],
  );
  assert.deepEqual(
    journal.promote("c1").map((entry) => entry.clientMutationId),
    ["c1"],
  );
  assert.deepEqual(
    journal.list().map((entry) => entry.clientMutationId),
    ["c2"],
  );
  assert.deepEqual(journal.dependencyMutationIdsForItemIds(["shape-1"]), []);
});

test("optimistic journal tracks the latest pending mutation per affected item", () => {
  const journal = createOptimisticJournal();
  appendOptimisticEntry(journal, {
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: rectCreate("shape-1"),
  });
  appendOptimisticEntry(journal, {
    clientMutationId: "c2",
    affectedIds: ["shape-1", "shape-2"],
    dependsOn: ["c1"],
    rollback: { kind: "items", snapshots: [] },
    message: rectUpdate("shape-1"),
  });

  assert.deepEqual(
    journal.dependencyMutationIdsForItemIds(["shape-1", "shape-2"]),
    ["c2"],
  );

  journal.promote("c2");

  assert.deepEqual(
    journal.dependencyMutationIdsForItemIds(["shape-1", "shape-2"]),
    ["c1"],
  );
});

test("optimistic journal rejects dependent descendants together", () => {
  const journal = createOptimisticJournal();
  appendOptimisticEntry(journal, {
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: rectCreate("shape-1"),
  });
  appendOptimisticEntry(journal, {
    clientMutationId: "c2",
    affectedIds: ["shape-1"],
    dependsOn: ["c1"],
    rollback: { kind: "items", snapshots: [] },
    message: rectUpdate("shape-1"),
  });
  appendOptimisticEntry(journal, {
    clientMutationId: "c3",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: rectCreate("shape-2"),
  });

  assert.deepEqual(
    journal.reject("c1").map((entry) => entry.clientMutationId),
    ["c1", "c2"],
  );
  assert.deepEqual(
    journal.list().map((entry) => entry.clientMutationId),
    ["c3"],
  );
});

test("optimistic journal reset clears all pending entries", () => {
  const journal = createOptimisticJournal();
  appendOptimisticEntry(journal, {
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: rectCreate("shape-1"),
  });

  assert.equal(journal.size(), 1);
  assert.deepEqual(
    journal.reset().map((entry) => entry.clientMutationId),
    ["c1"],
  );
  assert.equal(journal.size(), 0);
});

test("optimistic journal does not require native structuredClone", () => {
  const nativeStructuredClone = globalThis.structuredClone;
  Reflect.set(globalThis, "structuredClone", undefined);
  try {
    const journal = createOptimisticJournal();
    const rollback = {
      kind: /** @type {"items"} */ ("items"),
      snapshots: [
        {
          id: "shape-1",
          outerHTML: '<rect id="shape-1"></rect>',
          nextSiblingId: null,
        },
      ],
    };
    const message = rectCreate("shape-1");

    const appended = appendOptimisticEntry(journal, {
      clientMutationId: "c1",
      affectedIds: ["shape-1"],
      dependsOn: [],
      rollback,
      message,
    });

    const listed = journal.list()[0];
    assert.equal(appended.message, message);
    assert.equal(appended.rollback, rollback);
    assert.equal(listed?.message, message);
    assert.equal(listed?.rollback, rollback);
    assert.equal(
      listed?.rollback.kind === "items"
        ? listed.rollback.snapshots[0]?.outerHTML
        : undefined,
      '<rect id="shape-1"></rect>',
    );
    assert.equal(appended.message.color, "#123456");
  } finally {
    Reflect.set(globalThis, "structuredClone", nativeStructuredClone);
  }
});

test("optimistic journal prunes entries invalidated by authoritative deletes", () => {
  const journal = createOptimisticJournal();
  appendOptimisticEntry(journal, {
    clientMutationId: "copy-1",
    affectedIds: ["copy-1"],
    dependsOn: [],
    dependencyItemIds: ["seed-1"],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Hand.id,
      type: MutationType.COPY,
      id: "seed-1",
      newid: "copy-1",
    },
  });
  appendOptimisticEntry(journal, {
    clientMutationId: "copy-1-transform",
    affectedIds: ["copy-1"],
    dependsOn: ["copy-1"],
    dependencyItemIds: ["copy-1"],
    rollback: { kind: "items", snapshots: [] },
    message: handUpdate("copy-1"),
  });
  appendOptimisticEntry(journal, {
    clientMutationId: "shape-2-update",
    affectedIds: ["shape-2"],
    dependsOn: [],
    dependencyItemIds: ["shape-2"],
    rollback: { kind: "items", snapshots: [] },
    message: rectUpdate("shape-2"),
  });

  assert.deepEqual(
    journal
      .rejectByInvalidatedIds(["seed-1"])
      .map((entry) => entry.clientMutationId),
    ["copy-1", "copy-1-transform"],
  );
  assert.deepEqual(
    journal.list().map((entry) => entry.clientMutationId),
    ["shape-2-update"],
  );
});

test("optimistic journal uses authoritative prune plans with dependency-driven entries", () => {
  const journal = createOptimisticJournal();

  trackOptimisticMessage(journal, {
    clientMutationId: "cm-create-rect-1",
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-1",
    color: "#123456",
    size: 4,
    x: 10,
    y: 10,
    x2: 20,
    y2: 20,
  });
  trackOptimisticMessage(journal, {
    clientMutationId: "cm-append-1",
    tool: Rectangle.id,
    type: MutationType.UPDATE,
    id: "rect-1",
    x: 20,
    y: 20,
    x2: 30,
    y2: 30,
  });
  trackOptimisticMessage(journal, {
    clientMutationId: "cm-create-rect-2",
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-2",
    color: "#654321",
    size: 4,
    x: 20,
    y: 20,
    x2: 30,
    y2: 30,
  });

  const entries = journal.list();
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0]?.dependsOn, []);
  assert.deepEqual(entries[1]?.dependsOn, ["cm-create-rect-1"]);
  assert.deepEqual(journal.dependencyMutationIdsForItemIds(["rect-1"]), [
    "cm-append-1",
  ]);

  assert.deepEqual(
    journal.list().map((entry) => entry.clientMutationId),
    ["cm-create-rect-1", "cm-append-1", "cm-create-rect-2"],
  );

  const deletePrunePlan = optimisticPrunePlanForAuthoritativeMessage({
    tool: Rectangle.id,
    type: MutationType.DELETE,
    id: "rect-1",
  });
  assert.deepEqual(deletePrunePlan, {
    reset: false,
    invalidatedIds: ["rect-1"],
  });

  const rejectedByDelete = journal.rejectByInvalidatedIds(
    deletePrunePlan.invalidatedIds,
  );
  assert.deepEqual(
    rejectedByDelete.map((entry) => entry.clientMutationId),
    ["cm-create-rect-1", "cm-append-1"],
  );
  assert.deepEqual(
    journal.list().map((entry) => entry.clientMutationId),
    ["cm-create-rect-2"],
  );

  const clearPrunePlan = optimisticPrunePlanForAuthoritativeMessage({
    tool: TOOL_CODE_BY_ID.clear,
    type: MutationType.CLEAR,
  });
  assert.equal(clearPrunePlan.reset, true);

  if (clearPrunePlan.reset) {
    journal.reset();
  }

  assert.equal(journal.size(), 0);
});
