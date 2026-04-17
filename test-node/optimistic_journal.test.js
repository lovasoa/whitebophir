const test = require("node:test");
const assert = require("node:assert/strict");

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
    message: { tool: "Rectangle", id: "shape-1" },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "Rectangle", id: "shape-2" },
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
});

test("optimistic journal rejects dependent descendants together", () => {
  const journal = createOptimisticJournal();
  journal.append({
    clientMutationId: "c1",
    affectedIds: ["shape-1"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "Rectangle", id: "shape-1" },
  });
  journal.append({
    clientMutationId: "c2",
    affectedIds: ["shape-1"],
    dependsOn: ["c1"],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "Rectangle", id: "shape-1", type: "update" },
  });
  journal.append({
    clientMutationId: "c3",
    affectedIds: ["shape-2"],
    dependsOn: [],
    rollback: { kind: "items", snapshots: [] },
    message: { tool: "Rectangle", id: "shape-2" },
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
    message: { tool: "Rectangle", id: "shape-1" },
  });

  assert.equal(journal.size(), 1);
  assert.deepEqual(
    journal.reset().map((entry) => entry.clientMutationId),
    ["c1"],
  );
  assert.equal(journal.size(), 0);
});
