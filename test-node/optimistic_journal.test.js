const test = require("node:test");
const assert = require("node:assert/strict");

const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const {
  createOptimisticJournal,
} = require("../client-data/js/optimistic_journal.js");

test("optimistic journal appends and promotes entries in order", () => {
  const journal = createOptimisticJournal();
  journal.append({
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "rectangle", id: "shape-1", type: MutationType.CREATE },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "rectangle", id: "shape-2", type: MutationType.CREATE },
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
    message: { tool: "rectangle", id: "shape-1", type: MutationType.CREATE },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-1", "shape-2"],
    dependsOn: ["c1"],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "rectangle", id: "shape-1", type: MutationType.UPDATE },
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
    message: { tool: "rectangle", id: "shape-1", type: MutationType.CREATE },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-1"],
    dependsOn: ["c1"],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "rectangle", id: "shape-1", type: MutationType.UPDATE },
  });
  journal.append({
    clientMutationId: "c3",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "rectangle", id: "shape-2", type: MutationType.CREATE },
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
    message: { tool: "rectangle", id: "shape-1", type: MutationType.CREATE },
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
      tool: "hand",
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
    message: { tool: "hand", type: MutationType.UPDATE, id: "copy-1" },
  });
  journal.append({
    clientMutationId: "shape-2-update",
    affectedIds: ["shape-2"],
    dependsOn: [],
    dependencyItemIds: ["shape-2"],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "rectangle", type: MutationType.UPDATE, id: "shape-2" },
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
