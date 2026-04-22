const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const { MESSAGE_VALIDATION_PATH, withEnv } = require("./test_helpers.js");
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
  const invalidShapeMutation = messageValidation.normalizeIncomingMessage({
    tool: Rectangle.id,
    type: MutationType.COPY,
    id: "shape-1",
  });
  assert.deepEqual(invalidShapeMutation, {
    ok: false,
    reason: "invalid tool/type",
  });
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

test("normalizeStoredItem accepts stored shape payloads and defaults shape end points", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeStoredItem(
    {
      tool: "rectangle",
      color: "#123456",
      size: 4,
      x: 12,
      y: 34,
    },
    "shape-stored",
  );
  assert.deepEqual(normalized, {
    ok: true,
    value: {
      tool: "rectangle",
      type: "rect",
      id: "shape-stored",
      color: "#123456",
      size: 10,
      x: 12,
      y: 34,
      x2: 12,
      y2: 34,
    },
  });
});

test("normalizeIncomingMessage defaults shape end coordinates from the starting point", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: StraightLine.id,
    type: MutationType.CREATE,
    id: "line-1",
    color: "#123456",
    size: 4,
    x: "10.26",
    y: 20,
  });

  assert.deepEqual(normalized, {
    ok: true,
    value: {
      tool: StraightLine.id,
      type: MutationType.CREATE,
      id: "line-1",
      color: "#123456",
      size: 10,
      x: 10,
      y: 20,
      x2: 10,
      y2: 20,
    },
  });
});

test("normalizeIncomingMessage defaults x2 and y2 from distinct axes", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-1",
    color: "#123456",
    size: 4,
    x: 1,
    y: 42,
  });

  assert.deepEqual(normalized.value.x2, 1);
  assert.deepEqual(normalized.value.y2, 42);
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
  const normalized = messageValidation.normalizeIncomingMessage({
    type: MutationType.CREATE,
    id: "rect-1",
    color: "#123456",
    size: 4,
    x: 1,
    y: 42,
  });

  assert.deepEqual(normalized, {
    ok: false,
    reason: "missing tool",
  });
});

test("normalizeIncomingMessage rejects oversized live shapes", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: Rectangle.id,
    type: MutationType.CREATE,
    id: "rect-big",
    color: "#123456",
    size: 4,
    x: 0,
    y: 0,
    x2: 40000,
    y2: 20,
  });

  assert.deepEqual(normalized, {
    ok: false,
    reason: "shape too large",
  });
});

test("normalizeStoredItem rejects stored items without a supported tool", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeStoredItem(
    {
      color: "#123456",
      size: 4,
      x: 10,
      y: 20,
    },
    "stored-missing-tool",
  );

  assert.deepEqual(normalized, {
    ok: false,
    reason: "unsupported stored tool",
  });
});

test("normalizeIncomingMessage allows text updates but truncates long text", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const longText = "A".repeat(500);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: Text.id,
    type: MutationType.UPDATE,
    id: "text-1",
    txt: longText,
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.txt.length, 280); // MAX_TEXT_LENGTH
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
    size: 4,
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
    size: 4,
    clientMutationId: "cursor-cm",
  });
  assert.equal(cursor.ok, true);
  assert.equal(Object.hasOwn(cursor.value, "clientMutationId"), false);
});

test("normalizeStoredItem rejects oversized stored text", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeStoredItem(
    {
      tool: "text",
      color: "#000000",
      size: 500,
      x: 0,
      y: 0,
      txt: "A".repeat(100), // Width = 500 * 100 = 50000 > 32000 limit
    },
    "text-big",
  );

  assert.deepEqual(normalized, {
    ok: false,
    reason: "shape too large",
  });
});

test("normalizeStoredItem rejects oversized stored pencil", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeStoredItem(
    {
      tool: "pencil",
      color: "#000000",
      size: 4,
      _children: [
        { x: 0, y: 0 },
        { x: 40000, y: 40000 },
      ],
    },
    "pencil-big",
  );

  assert.deepEqual(normalized, {
    ok: false,
    reason: "shape too large",
  });
});

test("normalizeStoredItem rejects transformed oversized shapes", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeStoredItem(
    {
      tool: "rectangle",
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 10000,
      y2: 10000,
      transform: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
    },
    "rect-scaled",
  );

  assert.deepEqual(normalized, {
    ok: false,
    reason: "shape too large",
  });
});

test("normalizeStoredItem sanitizes stored pencil children before replay", async () => {
  await withEnv({ WBO_MAX_CHILDREN: "2" }, async () => {
    const messageValidation = await import(
      `${pathToFileURL(MESSAGE_VALIDATION_PATH).href}?max-children=2`
    );

    const malformedChildren = messageValidation.normalizeStoredItem(
      {
        tool: "pencil",
        color: "#123456",
        size: 4,
        _children: [{ x: 1, y: 2 }, null, { x: 4, y: 5 }],
      },
      "line-drop",
    );
    assert.deepEqual(malformedChildren, {
      ok: true,
      value: {
        tool: "pencil",
        type: "path",
        id: "line-drop",
        color: "#123456",
        size: 10,
        _children: [{ x: 1, y: 2 }],
      },
    });

    const truncatedChildren = messageValidation.normalizeStoredItem(
      {
        tool: "pencil",
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
        tool: "pencil",
        type: "path",
        id: "line-cap",
        color: "#123456",
        size: 10,
        _children: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    });
  });
});
