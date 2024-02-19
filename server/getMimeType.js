const { mimeTypeMagicNumbers } = require('./constants');

function getMimeType(buffer) {
  return mimeTypeMagicNumbers[buffer.toString('hex', 0, 4)] || 'text/plain';
}

module.exports = getMimeType;
