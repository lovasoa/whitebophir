const test = require("node:test");
const assert = require("node:assert/strict");

const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Hand, Rectangle } = require("../client-data/tools/index.js");
const { collectOptimisticAffectedIds, collectOptimisticDependencyIds } =
  require("../client-data/js/optimistic_mutation.js");
const {
  optimisticPrunePlanForAuthoritativeMessage,
} = require("../client-data/js/authoritative_mutation_effects.js");
const {
  createOptimisticJournal,
} = require("../client-data/js/optimistic_journal.js");

/**
 * @param {any} journal
 * @param {{tool: number, type: number, clientMutationId?: string, [key: string]: any}} message
 */
function trackOptimisticMessage(journal, message) {
  const clientMutationId = message.clientMutationId;
  if (!clientMutationId) throw new Error("missing clientMutationId");
  journal.append({
    clientMutationId,
    affectedIds: collectOptimisticAffectedIds(message),
    dependsOn: journal.dependencyMutationIdsForItemIds(
      collectOptimisticDependencyIds(message),
    ),
    dependencyItemIds: collectOptimisticDependencyIds(message),
    rollback: { kind: "items", snapshots: [] },
    message,
  });
}

test("optimistic journal appends and promotes entries in order", () => {
  const journal = createOptimisticJournal();
  journal.append({
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-1",
      type: MutationType.CREATE,
    },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-2",
      type: MutationType.CREATE,
    },
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
  journal.append({
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-1",
      type: MutationType.CREATE,
    },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-1", "shape-2"],
    dependsOn: ["c1"],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-1",
      type: MutationType.UPDATE,
    },
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
  journal.append({
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-1",
      type: MutationType.CREATE,
    },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-1"],
    dependsOn: ["c1"],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-1",
      type: MutationType.UPDATE,
    },
  });
  journal.append({
    clientMutationId: "c3",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-2",
      type: MutationType.CREATE,
    },
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
  journal.append({
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      id: "shape-1",
      type: MutationType.CREATE,
    },
  });

  assert.equal(journal.size(), 1);
  assert.deepEqual(
    journal.reset().map((entry) => entry.clientMutationId),
    ["c1"],
  );
  assert.equal(journal.size(), 0);
});

test("optimistic journal prunes entries invalidated by authoritative deletes", () => {
  const journal = createOptimisticJournal();
  journal.append({
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
  journal.append({
    clientMutationId: "copy-1-transform",
    affectedIds: ["copy-1"],
    dependsOn: ["copy-1"],
    dependencyItemIds: ["copy-1"],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: Hand.id, type: MutationType.UPDATE, id: "copy-1" },
  });
  journal.append({
    clientMutationId: "shape-2-update",
    affectedIds: ["shape-2"],
    dependsOn: [],
    dependencyItemIds: ["shape-2"],
    rollback: { kind: "items", snapshots: [] },
    message: {
      tool: Rectangle.id,
      type: MutationType.UPDATE,
      id: "shape-2",
    },
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
    tool: "clear",
    type: MutationType.CLEAR,
  });
  assert.equal(clearPrunePlan.reset, true);

  if (clearPrunePlan.reset) {
    journal.reset();
  }

  assert.equal(journal.size(), 0);
});
