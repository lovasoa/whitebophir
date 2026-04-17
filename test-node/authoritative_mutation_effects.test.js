const test = require("node:test");
const assert = require("node:assert/strict");

const {
  optimisticPrunePlanForAuthoritativeMessage,
} = require("../client-data/js/authoritative_mutation_effects.js");

test("authoritative delete invalidates only the targeted stable id", () => {
  assert.deepEqual(
    optimisticPrunePlanForAuthoritativeMessage({
      tool: "Eraser",
      type: "delete",
      id: "rect-1",
    }),
    {
      reset: false,
      invalidatedIds: ["rect-1"],
    },
  );
});

test("authoritative clear resets all speculative state", () => {
  assert.deepEqual(
    optimisticPrunePlanForAuthoritativeMessage({
      tool: "Clear",
      type: "clear",
    }),
    {
      reset: true,
      invalidatedIds: [],
    },
  );
});

test("non-destructive authoritative messages do not trigger optimistic pruning", () => {
  assert.deepEqual(
    optimisticPrunePlanForAuthoritativeMessage({
      tool: "Rectangle",
      type: "update",
      id: "rect-1",
      x2: 25,
      y2: 30,
    }),
    {
      reset: false,
      invalidatedIds: [],
    },
  );
});
