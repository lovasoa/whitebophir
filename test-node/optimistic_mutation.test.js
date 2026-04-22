const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} = require("../client-data/js/optimistic_mutation.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Hand, Pencil, Rectangle } = require("../client-data/tools/index.js");

test("optimistic mutation helpers classify creates, updates, and pencil children", () => {
  assert.deepEqual(
    collectOptimisticAffectedIds({
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: "shape-1",
    }),
    ["shape-1"],
  );
  assert.deepEqual(
    collectOptimisticDependencyIds({
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: "shape-1",
    }),
    [],
  );
  assert.deepEqual(
    collectOptimisticAffectedIds({
      tool: Pencil.id,
      type: MutationType.APPEND,
      parent: "line-1",
    }),
    ["line-1"],
  );
  assert.deepEqual(
    collectOptimisticDependencyIds({
      tool: Pencil.id,
      type: MutationType.APPEND,
      parent: "line-1",
    }),
    ["line-1"],
  );
});

test("optimistic mutation helpers flatten hand batches and copy semantics", () => {
  const batch = {
    tool: Hand.id,
    _children: [
      { type: MutationType.UPDATE, id: "shape-1" },
      { type: MutationType.COPY, id: "shape-1", newid: "shape-2" },
      { type: MutationType.DELETE, id: "shape-3" },
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
