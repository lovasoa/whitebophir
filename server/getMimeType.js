const magicNumbers = {
  'ffd8ffe0': 'image/jpeg',
  '89504e47': 'image/png',
  '47494638': 'image/gif',
};

function getMimeType(buffer) {
  return magicNumbers[buffer.toString('hex', 0, 4)] || 'text/plain';
}

module.exports = getMimeType;
