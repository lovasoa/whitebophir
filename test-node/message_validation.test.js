const test = require("node:test");
const assert = require("node:assert/strict");

const { MESSAGE_VALIDATION_PATH, withEnv } = require("./test_helpers.js");

test("normalizeIncomingMessage defaults shape end coordinates from the starting point", function () {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: "Straight line",
    type: "straight",
    id: "line-1",
    color: "#123456",
    size: 4,
    x: "10.26",
    y: 20,
  });

  assert.deepEqual(normalized, {
    ok: true,
    value: {
      tool: "Straight line",
      type: "straight",
      id: "line-1",
      color: "#123456",
      size: 4,
      x: 10.3,
      y: 20,
      x2: 10.3,
      y2: 20,
    },
  });
});

test("normalizeIncomingMessage rejects malformed hand batches atomically", function () {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: "Hand",
    _children: [
      {
        type: "update",
        id: "r1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 6 },
      },
      {
        type: "update",
        id: "r2",
        transform: { a: 1, b: 0, c: 0, d: 1, e: Infinity, f: 6 },
      },
    ],
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.reason, /_children\[1\]/);
});

test("normalizeStoredItem sanitizes stored pencil children before replay", async function () {
  await withEnv({ WBO_MAX_CHILDREN: "2" }, async function () {
    const messageValidation = require(MESSAGE_VALIDATION_PATH);

    const malformedChildren = messageValidation.normalizeStoredItem(
      {
        tool: "Pencil",
        color: "#123456",
        size: 4,
        _children: [{ x: 1, y: 2 }, null, { x: 4, y: 5 }],
      },
      "line-drop",
    );
    assert.deepEqual(malformedChildren, {
      ok: true,
      value: {
        tool: "Pencil",
        type: "line",
        id: "line-drop",
        color: "#123456",
        size: 4,
        _children: [{ x: 1, y: 2 }],
      },
    });

    const truncatedChildren = messageValidation.normalizeStoredItem(
      {
        tool: "Pencil",
        color: "#123456",
        size: 4,
        _children: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      },
      "line-cap",
    );
    assert.deepEqual(truncatedChildren, {
      ok: true,
      value: {
        tool: "Pencil",
        type: "line",
        id: "line-cap",
        color: "#123456",
        size: 4,
        _children: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    });
  });
});
