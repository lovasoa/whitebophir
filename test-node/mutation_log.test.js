const test = require("node:test");
const assert = require("node:assert/strict");

const { createMutationLog } = require("../server/mutation_log.mjs");

test("mutation logs append contiguous seq values from the initial baseline", () => {
  const log = createMutationLog(4);

  const first = log.append({
    board: "demo",
    acceptedAtMs: 100,
    mutation: { tool: "Rectangle", type: "rect", id: "rect-1" },
  });
  const second = log.append({
    board: "demo",
    acceptedAtMs: 200,
    mutation: { tool: "Eraser", type: "delete", id: "rect-1" },
  });

  assert.equal(first.seq, 5);
  assert.equal(second.seq, 6);
  assert.equal(log.latestSeq(), 6);
});

test("mutation logs read contiguous ranges and trim old replay entries", () => {
  const log = createMutationLog(0);
  for (let index = 0; index < 5; index++) {
    log.append({
      board: "demo",
      acceptedAtMs: index,
      mutation: { tool: "Text", type: "update", id: `text-${index}` },
    });
  }

  assert.deepEqual(
    log.readRange(2, 4).map((entry) => entry.seq),
    [3, 4],
  );

  log.trimBefore(4);

  assert.equal(log.minReplayableSeq(), 4);
  assert.deepEqual(
    log.readRange(0, 5).map((entry) => entry.seq),
    [4, 5],
  );
});
