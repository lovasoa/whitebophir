const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const { MESSAGE_VALIDATION_PATH, withEnv } = require("./test_helpers.js");
const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");

test("normalizeIncomingMessage supports every live tool/type pair", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);

  /**
   * @type {{[tool: string]: {[type: string]: any}}}
   */
  const messages = {
    Pencil: {
      line: {
        tool: "Pencil",
        type: "line",
        id: "p-1",
        color: "#123456",
        size: 4,
      },
      child: {
        tool: "Pencil",
        type: "child",
        parent: "p-1",
        x: 10,
        y: 20,
      },
    },
    "Straight line": {
      straight: {
        tool: "Straight line",
        type: "straight",
        id: "l-1",
        color: "#123456",
        size: 4,
        x: 1,
        y: 2,
      },
      update: {
        tool: "Straight line",
        type: "update",
        id: "l-1",
        x2: 10,
        y2: 20,
      },
    },
    Rectangle: {
      rect: {
        tool: "Rectangle",
        type: "rect",
        id: "r-1",
        color: "#123456",
        size: 4,
        x: 3,
        y: 4,
      },
      update: {
        tool: "Rectangle",
        type: "update",
        id: "r-1",
        x: 3,
        y: 4,
        x2: 14,
        y2: 24,
      },
    },
    Ellipse: {
      ellipse: {
        tool: "Ellipse",
        type: "ellipse",
        id: "e-1",
        color: "#123456",
        size: 4,
        x: 3,
        y: 4,
      },
      update: {
        tool: "Ellipse",
        type: "update",
        id: "e-1",
        x: 8,
        y: 9,
        x2: 18,
        y2: 22,
      },
    },
    Text: {
      new: {
        tool: "Text",
        type: "new",
        id: "t-1",
        color: "#123456",
        size: 4,
        x: 10,
        y: 20,
      },
      update: {
        tool: "Text",
        type: "update",
        id: "t-1",
        txt: "hello",
      },
    },
    Cursor: {
      update: {
        tool: "Cursor",
        type: "update",
        color: "#123456",
        size: 4,
        x: 11,
        y: 22,
      },
    },
    Eraser: {
      delete: {
        tool: "Eraser",
        type: "delete",
        id: "whatever",
      },
    },
    Clear: {
      clear: {
        tool: "Clear",
        type: "clear",
      },
    },
  };

  for (const [tool, cases] of Object.entries(messages)) {
    for (const [type, sample] of Object.entries(cases)) {
      const normalized = messageValidation.normalizeIncomingMessage(sample);
      assert.equal(
        normalized.ok,
        true,
        `expected valid ${tool}/${type} to normalize`,
      );
      if (sample.tool === "Text") {
        assert.equal(normalized.value.tool, "Text");
      }
    }
  }
});

test("metadata shape tools are all supported by incoming and stored validation", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const shapeTools = MessageToolMetadata.SHAPE_TOOL_TYPES;
  const shapeEntries = Object.entries(shapeTools);
  for (let index = 0; index < shapeEntries.length; index++) {
    const entry = shapeEntries[index];
    if (!entry) continue;
    const [toolName, typeNameMaybe] = entry;
    if (typeof typeNameMaybe !== "string") continue;
    const typeName = typeNameMaybe;
    const id = `shape-${index}`;
    const normalizedIncoming = messageValidation.normalizeIncomingMessage({
      tool: toolName,
      type: typeName,
      id,
      color: "#123456",
      size: 4,
      x: 1,
      y: 2,
    });
    assert.equal(normalizedIncoming.ok, true);

    const normalizedUpdate = messageValidation.normalizeIncomingMessage({
      tool: toolName,
      type: "update",
      id,
      x: 3,
      y: 4,
      x2: 12,
      y2: 18,
    });
    assert.equal(normalizedUpdate.ok, true);

    const normalizedStored = messageValidation.normalizeStoredItem(
      {
        tool: toolName,
        color: "#123456",
        size: 4,
        x: 10,
        y: 20,
      },
      `stored-${index}`,
    );
    assert.equal(normalizedStored.ok, true);
  }
});

test("normalizeStoredItem supports every stored tool", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);

  /**
   * @type {{[tool: string]: any}}
   */
  const items = {
    Pencil: {
      tool: "Pencil",
      id: "line-1",
      color: "#123456",
      size: 4,
      _children: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    "Straight line": {
      tool: "Straight line",
      color: "#123456",
      size: 4,
      x: 10,
      y: 20,
      x2: 11,
      y2: 21,
    },
    Rectangle: {
      tool: "Rectangle",
      color: "#123456",
      size: 4,
      x: 10,
      y: 20,
      x2: 30,
      y2: 40,
    },
    Ellipse: {
      tool: "Ellipse",
      color: "#123456",
      size: 4,
      x: 10,
      y: 20,
      x2: 30,
      y2: 40,
    },
    Text: {
      tool: "Text",
      color: "#123456",
      size: 4,
      x: 10,
      y: 20,
    },
  };

  for (const sample of Object.values(items)) {
    const normalized = messageValidation.normalizeStoredItem(
      sample,
      sample.id || "item",
    );
    assert.equal(normalized.ok, true);
  }
});

test("normalizeIncomingMessage defaults shape end coordinates from the starting point", () => {
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

test("normalizeIncomingMessage defaults x2 and y2 from distinct axes", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: "Rectangle",
    type: "rect",
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

test("normalizeIncomingMessage rejects messages without a tool", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    type: "rect",
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
    tool: "Rectangle",
    type: "rect",
    id: "rect-big",
    color: "#123456",
    size: 4,
    x: 0,
    y: 0,
    x2: 4000,
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
    tool: "Text",
    type: "update",
    id: "text-1",
    txt: longText,
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.txt.length, 280); // MAX_TEXT_LENGTH
});

test("normalizeIncomingMessage preserves clientMutationId for persistent messages", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const normalized = messageValidation.normalizeIncomingMessage({
    tool: "Rectangle",
    type: "rect",
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
    tool: "Text",
    type: "update",
    id: "text-1",
    txt: "hello",
    clientMutationId: "",
  });
  assert.deepEqual(rejected, {
    ok: false,
    reason: "invalid clientMutationId",
  });

  const cursor = messageValidation.normalizeIncomingMessage({
    tool: "Cursor",
    type: "update",
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
      tool: "Text",
      color: "#000000",
      size: 50,
      x: 0,
      y: 0,
      txt: "A".repeat(100), // Width = 50 * 100 = 5000 > 3200 limit
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
      tool: "Pencil",
      color: "#000000",
      size: 4,
      _children: [
        { x: 0, y: 0 },
        { x: 4000, y: 4000 },
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
      tool: "Rectangle",
      color: "#123456",
      size: 4,
      x: 0,
      y: 0,
      x2: 1000,
      y2: 1000,
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
