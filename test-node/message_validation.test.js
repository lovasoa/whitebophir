const test = require("node:test");
const assert = require("node:assert/strict");

const { MESSAGE_VALIDATION_PATH } = require("./test_helpers.js");
const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");
const {
  Cursor,
  Hand,
  Rectangle,
  StraightLine,
  Text,
} = require("../client-data/tools/index.js");
const { MutationType } = MessageToolMetadata;

test("normalizeIncomingMessage rejects live tool/type combinations that are not defined", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      tool: Rectangle.id,
      type: MutationType.COPY,
      id: "shape-1",
    }),
    {
      ok: false,
      reason: "invalid tool/type",
    },
  );
});

test("normalizeIncomingMessage requires required fields for updates", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const invalidUpdate = messageValidation.normalizeIncomingMessage({
    tool: Rectangle.id,
    type: MutationType.UPDATE,
    id: "shape-1",
    x: 10,
  });
  assert.equal(invalidUpdate.ok, false);
  assert.match(invalidUpdate.reason, /missing y/);
});

test("normalizeIncomingMessage requires explicit live seed geometry", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      tool: StraightLine.id,
      type: MutationType.CREATE,
      id: "line-1",
      color: "#123456",
      size: 10,
      opacity: 1,
      x: 10,
      y: 20,
    }),
    {
      ok: false,
      reason: "missing x2",
    },
  );
});

test("normalizeIncomingMessage rejects non-canonical live values instead of repairing them", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);

  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: "rect-1",
      color: "#123456",
      size: 4,
      opacity: 1,
      x: 1,
      y: 2,
      x2: 3,
      y2: 4,
    }),
    {
      ok: false,
      reason: "size: invalid size",
    },
  );

  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: "rect-2",
      color: "#123456",
      size: 10,
      opacity: 1,
      x: "10.26",
      y: 2,
      x2: 3,
      y2: 4,
    }),
    {
      ok: false,
      reason: "x: invalid coord",
    },
  );
});

test("normalizeIncomingMessage rejects malformed hand batches atomically", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: Hand.id,
    _children: [
      {
        type: MutationType.UPDATE,
        id: "r1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 6 },
      },
      {
        type: MutationType.UPDATE,
        id: "r2",
        transform: { a: 1, b: 0, c: 0, d: 1, e: Infinity, f: 6 },
      },
    ],
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.reason, /_children\[1\]/);
});

test("normalizeIncomingMessage rejects messages without a tool", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      type: MutationType.CREATE,
      id: "rect-1",
      color: "#123456",
      size: 10,
      opacity: 1,
      x: 1,
      y: 42,
      x2: 1,
      y2: 42,
    }),
    {
      ok: false,
      reason: "missing tool",
    },
  );
});

test("normalizeIncomingMessage rejects oversized live shapes", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      tool: Rectangle.id,
      type: MutationType.CREATE,
      id: "rect-big",
      color: "#123456",
      size: 10,
      opacity: 1,
      x: 0,
      y: 0,
      x2: 40000,
      y2: 20,
    }),
    {
      ok: false,
      reason: "shape too large",
    },
  );
});

test("normalizeIncomingMessage rejects transforms that move live shapes outside the board", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      tool: Hand.id,
      _children: [
        {
          type: MutationType.UPDATE,
          id: "r1",
          transform: { a: 1, b: 0, c: 0, d: 1, e: 999999999, f: 6 },
        },
      ],
    }),
    {
      ok: true,
      value: {
        tool: Hand.id,
        _children: [
          {
            type: MutationType.UPDATE,
            id: "r1",
            transform: { a: 1, b: 0, c: 0, d: 1, e: 999999999, f: 6 },
          },
        ],
      },
    },
  );
});

test("normalizeIncomingMessage rejects over-limit text instead of truncating it", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  assert.deepEqual(
    messageValidation.normalizeIncomingMessage({
      tool: Text.id,
      type: MutationType.UPDATE,
      id: "text-1",
      txt: "A".repeat(500),
    }),
    {
      ok: false,
      reason: "txt: text too long",
    },
  );
});

test("normalizeIncomingMessage preserves clientMutationId for persistent messages", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-1",
    x: 1,
    y: 2,
    x2: 3,
    y2: 4,
    color: "#123456",
    size: 10,
    opacity: 1,
    clientMutationId: "cm-1",
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.clientMutationId, "cm-1");
});

test("normalizeIncomingMessage rejects invalid clientMutationId and strips it from cursor updates", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const rejected = messageValidation.normalizeIncomingMessage({
    tool: Text.id,
    type: MutationType.UPDATE,
    id: "text-1",
    txt: "hello",
    clientMutationId: "",
  });
  assert.deepEqual(rejected, {
    ok: false,
    reason: "invalid clientMutationId",
  });

  const cursor = messageValidation.normalizeIncomingMessage({
    tool: Cursor.id,
    type: MutationType.UPDATE,
    x: 10,
    y: 20,
    color: "#123456",
    size: 10,
    clientMutationId: "cursor-cm",
  });
  assert.equal(cursor.ok, true);
  assert.equal(Object.hasOwn(cursor.value, "clientMutationId"), false);
});
