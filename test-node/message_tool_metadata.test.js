const test = require("node:test");
const assert = require("node:assert/strict");

const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");

test("shape-tool metadata helpers remain consistent", () => {
  const shapeTools = Object.keys(MessageToolMetadata.SHAPE_TOOL_TYPES);

  assert.deepEqual(
    MessageToolMetadata.getShapeToolNames().sort(),
    shapeTools.sort(),
  );

  for (const tool of shapeTools) {
    assert.equal(MessageToolMetadata.isShapeTool(tool), true);
  }

  assert.equal(MessageToolMetadata.isShapeTool("Pencil"), false);
});

test("unknown tool names have no updatable fields", () => {
  const unknownToolData = { x: 1, y: 2, txt: "keep" };

  assert.deepEqual(
    MessageToolMetadata.getUpdatableFieldNames("Unknown tool"),
    [],
  );

  assert.deepEqual(
    MessageToolMetadata.getUpdatableFields("Unknown tool", unknownToolData),
    {},
  );

  assert.deepEqual(
    MessageToolMetadata.getUpdatableFields(undefined, unknownToolData),
    {},
  );

  assert.deepEqual(MessageToolMetadata.getUpdatableFieldNames("__proto__"), []);
  assert.deepEqual(MessageToolMetadata.getUpdatableFieldNames("toString"), []);
  assert.deepEqual(
    MessageToolMetadata.getUpdatableFields("__proto__", unknownToolData),
    {},
  );
});
