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
