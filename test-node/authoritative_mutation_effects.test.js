const test = require("node:test");
const assert = require("node:assert/strict");

const {
  optimisticPrunePlanForAuthoritativeMessage,
} = require("../client-data/js/authoritative_mutation_effects.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");

test("authoritative delete invalidates only the targeted stable id", () => {
  assert.deepEqual(
    optimisticPrunePlanForAuthoritativeMessage({
      tool: "eraser",
      type: MutationType.DELETE,
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
      tool: "clear",
      type: MutationType.CLEAR,
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
      tool: "rectangle",
      type: MutationType.UPDATE,
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
