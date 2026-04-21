const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const { MESSAGE_VALIDATION_PATH, withEnv } = require("./test_helpers.js");
const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");
const { TOOL_CATALOG } = require("../client-data/js/tool_catalog.js");
const {
  TOOL_CONTRACTS_BY_NAME,
} = require("../client-data/tools/tool_contracts.js");

const SHAPE_CREATE_FIELDS = {
  id: "id",
  color: "color",
  size: "size",
  opacity: "opacity?",
  x: "coord",
  y: "coord",
};
const SHAPE_STORED_SAMPLE = {
  color: "#123456",
  size: 4,
  x: 10,
  y: 20,
  x2: 30,
  y2: 40,
};

/**
 * @param {string} type
 * @returns {string}
 */
function fieldType(type) {
  return type.endsWith("?") ? type.slice(0, -1) : type;
}

/**
 * @param {string} type
 * @param {string} key
 * @returns {any}
 */
function sampleFieldValue(type, key) {
  switch (fieldType(type)) {
    case "id":
      return key === "parent" ? "parent-1" : `${key}-1`;
    case "coord":
      return key === "y" || key === "y2" ? 20 : 10;
    case "color":
      return "#123456";
    case "size":
      return 4;
    case "opacity":
      return 0.6;
    case "text":
      return "hello";
    case "transform":
      return { a: 1, b: 0, c: 0, d: 1, e: 5, f: 6 };
    case "time":
      return 1234;
  }
}

/**
 * @param {{[field: string]: string} | undefined} fields
 * @returns {{[field: string]: any}}
 */
function sampleFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, type]) => [
      key,
      sampleFieldValue(type, key),
    ]),
  );
}

/**
 * @returns {Array<{tool: string, type: string, sample: any}>}
 */
function liveValidationSamples() {
  /** @type {Array<{tool: string, type: string, sample: any}>} */
  const samples = [
    {
      tool: "Cursor",
      type: "update",
      sample: {
        tool: "Cursor",
        type: "update",
        ...sampleFields({
          color: "color",
          size: "size",
          x: "coord",
          y: "coord",
        }),
      },
    },
  ];
  for (const contract of Object.values(TOOL_CONTRACTS_BY_NAME)) {
    for (const [type, fields] of Object.entries(
      contract.liveMessageFields || {},
    )) {
      samples.push({
        tool: contract.toolName,
        type,
        sample: {
          tool: contract.toolName,
          type,
          ...sampleFields(fields),
        },
      });
    }
    if (contract.shapeType) {
      if (typeof contract.liveCreateType !== "string") continue;
      samples.push({
        tool: contract.toolName,
        type: contract.liveCreateType,
        sample: {
          tool: contract.toolName,
          type: contract.liveCreateType,
          ...sampleFields(SHAPE_CREATE_FIELDS),
        },
      });
      /** @type {{[field: string]: any}} */
      const updateSample = {
        tool: contract.toolName,
        type: "update",
        id: "shape-1",
      };
      Object.assign(
        updateSample,
        Object.fromEntries(
          (contract.updatableFields || []).map((field) => [field, 10]),
        ),
      );
      samples.push({
        tool: contract.toolName,
        type: "update",
        sample: updateSample,
      });
    }
  }
  for (const entry of TOOL_CATALOG) {
    for (const [type, fields] of Object.entries(
      entry.liveMessageFields || {},
    )) {
      samples.push({
        tool: entry.name,
        type,
        sample: {
          tool: entry.name,
          type,
          ...sampleFields(fields),
        },
      });
    }
  }
  return samples;
}

/**
 * @returns {Array<{tool: string, sample: any}>}
 */
function storedValidationSamples() {
  const samples = [];
  for (const contract of Object.values(TOOL_CONTRACTS_BY_NAME)) {
    if (contract.shapeType) {
      samples.push({
        tool: contract.toolName,
        sample: { tool: contract.toolName, ...SHAPE_STORED_SAMPLE },
      });
      continue;
    }
    if (contract.storedFields) {
      samples.push({
        tool: contract.toolName,
        sample: {
          tool: contract.toolName,
          ...sampleFields(contract.storedFields),
        },
      });
    }
  }
  return samples;
}

test("normalizeIncomingMessage supports every live tool/type pair", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  for (const { tool, type, sample } of liveValidationSamples()) {
    const normalized = messageValidation.normalizeIncomingMessage(sample);
    assert.equal(
      normalized.ok,
      true,
      `expected valid ${tool}/${type} to normalize`,
    );
    if (tool === "Text") {
      assert.equal(normalized.value.tool, "Text");
    }
  }
});

test("metadata shape tools are all supported by incoming and stored validation", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  const shapeEntries = Object.entries(MessageToolMetadata.SHAPE_TOOL_TYPES);
  for (let index = 0; index < shapeEntries.length; index += 1) {
    const [toolName, typeName] = shapeEntries[index] || [];
    if (typeof toolName !== "string" || typeof typeName !== "string") continue;
    const contract = TOOL_CONTRACTS_BY_NAME[toolName];
    const id = `shape-${index}`;
    const normalizedIncoming = messageValidation.normalizeIncomingMessage({
      tool: toolName,
      type: typeName,
      id,
      ...sampleFields(SHAPE_CREATE_FIELDS),
    });
    assert.equal(normalizedIncoming.ok, true);

    const normalizedUpdate = messageValidation.normalizeIncomingMessage({
      tool: toolName,
      type: "update",
      id,
      ...Object.fromEntries(
        (contract?.updatableFields || []).map((field) => [field, 12]),
      ),
    });
    assert.equal(normalizedUpdate.ok, true);

    const normalizedStored = messageValidation.normalizeStoredItem(
      { tool: toolName, ...SHAPE_STORED_SAMPLE },
      `stored-${index}`,
    );
    assert.equal(normalizedStored.ok, true);
  }
});

test("normalizeStoredItem supports every stored tool", () => {
  const messageValidation = require(MESSAGE_VALIDATION_PATH);
  for (const { sample } of storedValidationSamples()) {
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
      tool: "Pencil",
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
      tool: "Rectangle",
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
        size: 10,
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
        size: 10,
        _children: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    });
  });
});
