const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} = require("../client-data/js/optimistic_mutation.js");

test("optimistic mutation helpers classify creates, updates, and pencil children", () => {
  assert.deepEqual(
    collectOptimisticAffectedIds({
      tool: "rectangle",
      type: "rect",
      id: "shape-1",
    }),
    ["shape-1"],
  );
  assert.deepEqual(
    collectOptimisticDependencyIds({
      tool: "rectangle",
      type: "rect",
      id: "shape-1",
    }),
    [],
  );
  assert.deepEqual(
    collectOptimisticAffectedIds({
      tool: "pencil",
      type: "child",
      parent: "line-1",
    }),
    ["line-1"],
  );
  assert.deepEqual(
    collectOptimisticDependencyIds({
      tool: "pencil",
      type: "child",
      parent: "line-1",
    }),
    ["line-1"],
  );
});

test("optimistic mutation helpers flatten hand batches and copy semantics", () => {
  const batch = {
    tool: "hand",
    _children: [
      { type: "update", id: "shape-1" },
      { type: "copy", id: "shape-1", newid: "shape-2" },
      { type: "delete", id: "shape-3" },
    ],
  };

  assert.deepEqual(collectOptimisticAffectedIds(batch), [
    "shape-1",
    "shape-2",
    "shape-3",
  ]);
  assert.deepEqual(collectOptimisticDependencyIds(batch), [
    "shape-1",
    "shape-3",
  ]);
});
