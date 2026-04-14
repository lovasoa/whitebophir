const test = require('node:test');
const assert = require('node:assert/strict');

const MessageToolMetadata = require('../client-data/js/message_tool_metadata.js');

test('shape-tool metadata helpers remain consistent', function () {
  const shapeTools = Object.keys(MessageToolMetadata.SHAPE_TOOL_TYPES);

  assert.deepEqual(
    MessageToolMetadata.getShapeToolNames().sort(),
    shapeTools.sort(),
  );

  for (const tool of shapeTools) {
    assert.equal(MessageToolMetadata.isShapeTool(tool), true);
  }

  assert.equal(MessageToolMetadata.isShapeTool('Pencil'), false);
});

test('unknown tool names have no updatable fields', function () {
  const unknownToolData = { x: 1, y: 2, txt: 'keep' };

  assert.deepEqual(
    MessageToolMetadata.getUpdatableFieldNames('Unknown tool'),
    [],
  );

  assert.deepEqual(
    MessageToolMetadata.getUpdatableFields('Unknown tool', unknownToolData),
    {},
  );

  assert.deepEqual(
    MessageToolMetadata.getUpdatableFields(undefined, unknownToolData),
    {},
  );
});
