const test = require("node:test");
const assert = require("node:assert/strict");
const Replay = require("../client-data/js/board_message_replay.js");

/** @param {number | string} seq @returns {any} */
const sequenced = (seq) => ({ mutation: { type: "update" }, seq });
/** @type {any} */
const plain = { type: "clear" };
/** @type {any} */
const replayBatch = { fromSeq: 1, seq: 3, _children: [] };

test("normalizeSeq accepts positive safe integers only", () => {
  assert.equal(Replay.normalizeSeq(5), 5);
  assert.equal(Replay.normalizeSeq("7"), 7);
  assert.equal(Replay.normalizeSeq(0), 0);
  assert.equal(Replay.normalizeSeq(-1), 0);
  assert.equal(Replay.normalizeSeq(1.5), 0);
  assert.equal(Replay.normalizeSeq(Number.NaN), 0);
  assert.equal(Replay.normalizeSeq("abc"), 0);
});

test("classifySequencedMutationSeq separates stale, next and gap", () => {
  assert.equal(Replay.classifySequencedMutationSeq(sequenced(2), 3), "stale");
  assert.equal(Replay.classifySequencedMutationSeq(sequenced(3), 3), "stale");
  assert.equal(Replay.classifySequencedMutationSeq(sequenced(4), 3), "next");
  assert.equal(Replay.classifySequencedMutationSeq(sequenced(5), 3), "gap");
  assert.equal(Replay.classifySequencedMutationSeq(sequenced("4"), 3), "next");
  assert.equal(Replay.classifySequencedMutationSeq(plain, 3), "unsequenced");
});

test("shouldBufferLiveMessage buffers only plain messages while awaiting a snapshot", () => {
  assert.equal(Replay.shouldBufferLiveMessage(plain, false), false);
  assert.equal(Replay.shouldBufferLiveMessage(plain, true), true);
  assert.equal(Replay.shouldBufferLiveMessage(sequenced(4), true), false);
  assert.equal(Replay.shouldBufferLiveMessage(replayBatch, true), true);
});

test("filterBufferedMessagesAfterSeqReplay drops messages replay already covered", () => {
  const buffered = [plain, sequenced(3), sequenced(5)];
  assert.deepEqual(Replay.filterBufferedMessagesAfterSeqReplay(buffered, 4), [
    plain,
    buffered[2],
  ]);
  assert.deepEqual(Replay.filterBufferedMessagesAfterSeqReplay(buffered, 5), [
    plain,
  ]);
  assert.deepEqual(Replay.filterBufferedMessagesAfterSeqReplay([], 5), []);
});

test("replay batches and sequenced mutations are distinguishable", () => {
  assert.equal(Replay.isSequencedMutationBroadcast(sequenced(1)), true);
  assert.equal(Replay.isSequencedMutationBroadcast(plain), false);
  assert.equal(Replay.isAuthoritativeReplayBatch(replayBatch), true);
  assert.equal(Replay.isAuthoritativeReplayBatch(plain), false);
});

test("unwrapSequencedMutationBroadcast returns the inner mutation", () => {
  const message = sequenced(4);
  assert.equal(
    Replay.unwrapSequencedMutationBroadcast(message),
    message.mutation,
  );
  assert.equal(Replay.unwrapSequencedMutationBroadcast(plain), plain);
});
