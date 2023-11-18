const fs = require('node:fs/promises');
const { mimeTypeMagicNumbers } = require('./constants');

async function ensureIsImage(image) {
  // Load the first 4 bytes of the image so we can check the "magic number"
  // against a list of supported file types.
  const imageFileBuffer = Buffer.alloc(4);
  const imageFileHandle = await fs.open(image.path, 'r');
  await imageFileHandle.read(imageFileBuffer, 0, 4, 0);
  imageFileHandle.close();

  // Check to see if the first 4 bytes match the magic number for any of the
  // supported image types.
  const imageBufferAsString = imageFileBuffer.toString('hex', 0, 4);
  const mimeType = mimeTypeMagicNumbers[imageBufferAsString];

  if (!mimeType) {
    throw new Error('Invalid image');
  }
  return mimeType;
}

module.exports = ensureIsImage;
