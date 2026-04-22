const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatMessageTypeTag,
  MutationType,
} = require("../client-data/js/message_tool_metadata.js");

test("formatMessageTypeTag emits human-readable names for live mutation codes", () => {
  assert.equal(formatMessageTypeTag(MutationType.CREATE), "create");
  assert.equal(formatMessageTypeTag(MutationType.UPDATE), "update");
  assert.equal(formatMessageTypeTag(MutationType.DELETE), "delete");
  assert.equal(formatMessageTypeTag(MutationType.APPEND), "append");
  assert.equal(formatMessageTypeTag(MutationType.BATCH), "batch");
  assert.equal(formatMessageTypeTag(MutationType.CLEAR), "clear");
  assert.equal(formatMessageTypeTag(MutationType.COPY), "copy");
});

test("formatMessageTypeTag preserves string message tags", () => {
  assert.equal(formatMessageTypeTag("mutation_rejected"), "mutation_rejected");
  assert.equal(formatMessageTypeTag("sync_replay_start"), "sync_replay_start");
  assert.equal(formatMessageTypeTag(""), undefined);
  assert.equal(formatMessageTypeTag(undefined), undefined);
  assert.equal(formatMessageTypeTag(999), undefined);
});
