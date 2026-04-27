const test = require("node:test");
const assert = require("node:assert/strict");

const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Eraser, Rectangle, Text } = require("../client-data/tools/index.js");
const { createMutationLog } = require("../server/board/mutation_log.mjs");

/** @param {string} id */
function rectCreate(id) {
  return {
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id,
    color: "#123456",
    size: 4,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
  };
}

/** @param {string} id */
function textUpdate(id) {
  return {
    tool: Text.id,
    type: MutationType.UPDATE,
    id,
    txt: "updated",
  };
}

test("mutation logs append contiguous seq values from the initial baseline", () => {
  const log = createMutationLog(4);

  const first = log.append({
    acceptedAtMs: 100,
    mutation: rectCreate("rect-1"),
  });
  const second = log.append({
    acceptedAtMs: 200,
    mutation: {
      tool: Eraser.id,
      type: MutationType.DELETE,
      id: "rect-1",
    },
  });

  assert.equal(first.seq, 5);
  assert.equal(second.seq, 6);
  assert.equal(log.latestSeq(), 6);
});

test("mutation logs read contiguous suffixes and trim old replay entries", () => {
  const log = createMutationLog(0);
  for (let index = 0; index < 5; index++) {
    log.append({
      acceptedAtMs: index,
      mutation: textUpdate(`text-${index}`),
    });
  }

  assert.deepEqual(
    log.readFrom(2).map((entry) => entry.seq),
    [3, 4, 5],
  );

  log.trimBefore(4);

  assert.equal(log.minReplayableSeq(), 3);
  assert.deepEqual(
    log.readFrom(0).map((entry) => entry.seq),
    [4, 5],
  );
  assert.deepEqual(
    log.readFrom(4).map((entry) => entry.seq),
    [5],
  );
});

test("mutation logs track the latest persisted baseline seq", () => {
  const log = createMutationLog(2);
  log.append({
    acceptedAtMs: 3,
    mutation: rectCreate("rect-1"),
  });

  assert.equal(log.persistedSeq(), 2);
  log.markPersisted(3);
  assert.equal(log.persistedSeq(), 3);
});

test("mutation logs trim retention as a contiguous replay suffix", () => {
  const log = createMutationLog(0);
  log.append({
    acceptedAtMs: 10,
    mutation: rectCreate("rect-1"),
  });
  log.append({
    acceptedAtMs: 100,
    mutation: rectCreate("rect-2"),
  });
  log.append({
    acceptedAtMs: 20,
    mutation: rectCreate("rect-3"),
  });

  log.markPersisted(3);
  log.trimPersistedOlderThan(50);

  assert.equal(log.minReplayableSeq(), 1);
  assert.deepEqual(
    log.readFrom(0).map((entry) => entry.seq),
    [2, 3],
  );
});

test("mutation logs keep pinned replay history even after persisted retention expires", () => {
  const log = createMutationLog(0);
  log.append({
    acceptedAtMs: 10,
    mutation: rectCreate("rect-1"),
  });
  log.append({
    acceptedAtMs: 20,
    mutation: rectCreate("rect-2"),
  });
  log.append({
    acceptedAtMs: 30,
    mutation: rectCreate("rect-3"),
  });

  log.markPersisted(3);
  log.trimPersistedOlderThan(100, 1);

  assert.equal(log.minReplayableSeq(), 1);
  assert.deepEqual(
    log.readFrom(0).map((entry) => entry.seq),
    [2, 3],
  );
});
