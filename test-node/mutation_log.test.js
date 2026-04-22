const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getToolCode,
  MutationType,
} = require("../client-data/js/message_tool_metadata.js");
const { createMutationLog } = require("../server/mutation_log.mjs");

const ERASER_TOOL_CODE = getToolCode("eraser");
const RECTANGLE_TOOL_CODE = getToolCode("rectangle");
const TEXT_TOOL_CODE = getToolCode("text");

test("mutation logs append contiguous seq values from the initial baseline", () => {
  const log = createMutationLog(4);

  const first = log.append({
    board: "demo",
    acceptedAtMs: 100,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-1",
    },
  });
  const second = log.append({
    board: "demo",
    acceptedAtMs: 200,
    mutation: {
      tool: ERASER_TOOL_CODE,
      type: MutationType.DELETE,
      id: "rect-1",
    },
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
      mutation: {
        tool: TEXT_TOOL_CODE,
        type: MutationType.UPDATE,
        id: `text-${index}`,
      },
    });
  }

  assert.deepEqual(
    log.readRange(2, 4).map((entry) => entry.seq),
    [3, 4],
  );

  log.trimBefore(4);

  assert.equal(log.minReplayableSeq(), 3);
  assert.deepEqual(
    log.readRange(0, 5).map((entry) => entry.seq),
    [4, 5],
  );
});

test("mutation logs track the latest persisted baseline seq", () => {
  const log = createMutationLog(2);
  log.append({
    board: "demo",
    acceptedAtMs: 3,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-1",
    },
  });

  assert.equal(log.persistedSeq(), 2);
  log.markPersisted(3);
  assert.equal(log.persistedSeq(), 3);
});

test("mutation logs trim only persisted entries older than the retention cutoff", () => {
  const log = createMutationLog(0);
  log.append({
    board: "demo",
    acceptedAtMs: 10,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-1",
    },
  });
  log.append({
    board: "demo",
    acceptedAtMs: 20,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-2",
    },
  });
  log.append({
    board: "demo",
    acceptedAtMs: 30,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-3",
    },
  });

  log.markPersisted(2);
  log.trimPersistedOlderThan(25);

  assert.equal(log.minReplayableSeq(), 2);
  assert.deepEqual(
    log.readRange(0, 3).map((entry) => entry.seq),
    [3],
  );
});

test("mutation logs keep pinned replay history even after persisted retention expires", () => {
  const log = createMutationLog(0);
  log.append({
    board: "demo",
    acceptedAtMs: 10,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-1",
    },
  });
  log.append({
    board: "demo",
    acceptedAtMs: 20,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-2",
    },
  });
  log.append({
    board: "demo",
    acceptedAtMs: 30,
    mutation: {
      tool: RECTANGLE_TOOL_CODE,
      type: MutationType.CREATE,
      id: "rect-3",
    },
  });

  log.markPersisted(3);
  log.trimPersistedOlderThan(100, 1);

  assert.equal(log.minReplayableSeq(), 1);
  assert.deepEqual(
    log.readRange(0, 3).map((entry) => entry.seq),
    [2, 3],
  );
});
