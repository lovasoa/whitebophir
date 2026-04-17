const test = require("node:test");
const assert = require("node:assert/strict");

const {
  broadcastMessageColor,
  unwrapBroadcastMessage,
} = require("../playwright/helpers/broadcastMessage.js");

test("unwrapBroadcastMessage returns the logical mutation payload", () => {
  assert.deepEqual(
    unwrapBroadcastMessage({
      seq: 3,
      mutation: { tool: "Cursor", type: "update", color: "#00aa11" },
    }),
    { tool: "Cursor", type: "update", color: "#00aa11" },
  );
  assert.deepEqual(
    unwrapBroadcastMessage({
      tool: "Cursor",
      type: "update",
      color: "#123abc",
    }),
    { tool: "Cursor", type: "update", color: "#123abc" },
  );
});

test("broadcastMessageColor reads color from raw and enveloped broadcasts", () => {
  assert.equal(
    broadcastMessageColor({
      seq: 5,
      mutation: { tool: "Cursor", type: "update", color: "#00aa11" },
    }),
    "#00aa11",
  );
  assert.equal(
    broadcastMessageColor({ tool: "Cursor", type: "update", color: "#123abc" }),
    "#123abc",
  );
  assert.equal(broadcastMessageColor({ tool: "Cursor", type: "update" }), "");
});
