import { TOOL_BY_STORED_TAG_NAME } from "../../client-data/tools/index.js";
import { unescapeHtml } from "./xml_escape.mjs";

const AMPERSAND = 38;
const DOUBLE_QUOTE = 34;
const GREATER_THAN = 62;
const HYPHEN = 45;
const SLASH = 47;
const SPACE = 32;
const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const UPPER_M = 77;
const LOWER_L = 108;
const ZERO = 48;
const NINE = 57;

/** @type {Buffer} */
const EMPTY_BUFFER = Buffer.alloc(0);
const DRAWING_AREA_ID = "drawingArea";
const DRAWING_AREA_CLOSE = Buffer.from("</g>");
const GROUP_OPEN = Buffer.from("<g");
const EMPTY_PERSISTED_PENCIL_SCAN = {
  childCount: 0,
  localBounds: null,
  lastPoint: null,
};
const ID_ATTR = Buffer.from(' id="');
/** @type {Map<string, Buffer>} */
const ATTRIBUTE_TOKENS = new Map();
const OPTIONAL_ATTRIBUTE_NAMES = new Set(["opacity", "transform"]);
let lastCanonicalPathFirstInteger = 0;
let lastCanonicalPathSecondInteger = 0;

/**
 * @param {string} name
 * @returns {Buffer}
 */
function attributeToken(name) {
  let token = ATTRIBUTE_TOKENS.get(name);
  if (!token) {
    token = Buffer.from(` ${name}="`);
    ATTRIBUTE_TOKENS.set(name, token);
  }
  return token;
}

/**
 * @param {string} name
 * @returns {{name: string, token: Buffer, optional: boolean}}
 */
function orderedAttribute(name) {
  return {
    name,
    token: Buffer.from(`${name}="`),
    optional: OPTIONAL_ATTRIBUTE_NAMES.has(name),
  };
}

/**
 * @param {readonly string[]} names
 * @returns {{attributes: ReadonlyArray<{name: string, token: Buffer, optional: boolean}>, indexes: {[name: string]: number}}}
 */
function attributeLayout(names) {
  /** @type {{[name: string]: number}} */
  const indexes = Object.create(null);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (name) indexes[name] = index;
  }
  return {
    attributes: names.map(orderedAttribute),
    indexes,
  };
}

/**
 * @param {keyof typeof TOOL_BY_STORED_TAG_NAME} storedTagName
 * @returns {{attributes: ReadonlyArray<{name: string, token: Buffer, optional: boolean}>, indexes: {[name: string]: number}}}
 */
function contractAttributeLayout(storedTagName) {
  const names = TOOL_BY_STORED_TAG_NAME[storedTagName]?.storedAttributeNames;
  if (!names) {
    throw new Error(
      `Missing stored attribute order for ${String(storedTagName)}`,
    );
  }
  return attributeLayout(names);
}

/**
 * @param {number} byte
 * @returns {boolean}
 */
function isAttributeBoundary(byte) {
  return (
    byte === SPACE ||
    byte === TAB ||
    byte === LINE_FEED ||
    byte === CARRIAGE_RETURN
  );
}

/**
 * @param {Buffer} buffer
 * @param {number} start
 * @param {Buffer} token
 * @returns {boolean}
 */
function bufferStartsWith(buffer, start, token) {
  return (
    start >= 0 &&
    start + token.length <= buffer.length &&
    buffer.compare(token, 0, token.length, start, start + token.length) === 0
  );
}

/**
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number} openTagEnd
 * @param {(typeof STORED_TAGS)[number]} tag
 * @returns {boolean}
 */
function matchesStoredTag(buffer, offset, openTagEnd, tag) {
  const boundaryIndex = offset + tag.open.length;
  if (boundaryIndex > openTagEnd || buffer[offset + 1] !== tag.open[1]) {
    return false;
  }
  for (let index = 2; index < tag.open.length; index += 1) {
    if (buffer[offset + index] !== tag.open[index]) return false;
  }
  return (
    boundaryIndex === openTagEnd ||
    isAttributeBoundary(buffer[boundaryIndex] ?? 0) ||
    (buffer[boundaryIndex] ?? 0) === GREATER_THAN
  );
}

/**
 * @param {Buffer} buffer
 * @param {number} from
 * @returns {number}
 */
function indexOfTagEnd(buffer, from) {
  return buffer.indexOf(GREATER_THAN, from);
}

/**
 * @param {Buffer} buffer
 * @param {number} byte
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
function byteExistsInRange(buffer, byte, from, to) {
  const index = buffer.indexOf(byte, from);
  return index !== -1 && index < to;
}

/**
 * @param {Buffer} buffer
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
function plainAsciiXmlTextLength(buffer, from, to) {
  let length = 0;
  for (let index = from; index < to; index += 1) {
    const byte = buffer[index] ?? 0;
    if (byte === AMPERSAND || byte > 127) return -1;
    length += 1;
  }
  return length;
}

/** @param {Buffer} source @param {string} name */
function findAttributeValueRange(source, name) {
  const token = attributeToken(name);
  const start = source.indexOf(token);
  if (start === -1) return null;
  const valueStart = start + token.length;
  const valueEnd = source.indexOf(DOUBLE_QUOTE, valueStart);
  return valueEnd === -1 ? null : { start: valueStart, end: valueEnd };
}

/** @param {Buffer} source */
function readLeadingIdAttribute(source) {
  if (source.indexOf(ID_ATTR) !== 0) return undefined;
  const start = ID_ATTR.length;
  return source.toString("ascii", start, source.indexOf(DOUBLE_QUOTE, start));
}

/**
 * @param {Buffer} source
 * @param {number} offset
 * @returns {string | undefined}
 */
function readLeadingIdAttributeAt(source, offset) {
  if (source.indexOf(ID_ATTR, offset) !== offset) return undefined;
  const start = offset + ID_ATTR.length;
  return source.toString("ascii", start, source.indexOf(DOUBLE_QUOTE, start));
}

/**
 * @param {Buffer} source
 * @param {string} name
 * @returns {string | undefined}
 */
function readBufferAttribute(source, name) {
  if (name === "id") {
    const leadingId = readLeadingIdAttribute(source);
    if (leadingId !== undefined) return leadingId;
  }
  const range = findAttributeValueRange(source, name);
  if (!range) return undefined;
  return source.toString("utf8", range.start, range.end);
}

/**
 * @param {Buffer} source
 * @param {number} index
 * @param {number} to
 * @param {{token: Buffer}} attribute
 * @param {number[]} ranges
 * @param {number} rangeIndex
 * @returns {number}
 */
function readOrderedAttributeNext(
  source,
  index,
  to,
  attribute,
  ranges,
  rangeIndex,
) {
  const token = attribute.token;
  if (index + token.length > to) return -1;
  for (let tokenIndex = 0; tokenIndex < token.length; tokenIndex += 1) {
    if (source[index + tokenIndex] !== token[tokenIndex]) return -1;
  }
  const start = index + token.length;
  for (let end = start; end < to; end += 1) {
    if (source[end] === DOUBLE_QUOTE) {
      ranges[rangeIndex] = start;
      ranges[rangeIndex + 1] = end;
      return end + 1;
    }
  }
  return -1;
}

/**
 * @param {Buffer} source
 * @param {number} from
 * @param {number} to
 * @param {{attributes: ReadonlyArray<{name: string, token: Buffer, optional: boolean}>}} layout
 * @returns {number[] | null}
 */
function readOrderedAttributeRanges(source, from, to, layout) {
  const attributes = layout.attributes;
  const ranges = new Array(attributes.length * 2);
  let index = from;
  for (
    let attributeIndex = 0;
    attributeIndex < attributes.length;
    attributeIndex += 1
  ) {
    const attribute = attributes[attributeIndex];
    if (!attribute) return null;
    while (index < to && isAttributeBoundary(source[index] ?? 0)) {
      index += 1;
    }
    const rangeIndex = attributeIndex * 2;
    const next = readOrderedAttributeNext(
      source,
      index,
      to,
      attribute,
      ranges,
      rangeIndex,
    );
    if (next === -1) {
      if (attribute.optional) {
        ranges[rangeIndex] = -1;
        ranges[rangeIndex + 1] = -1;
        continue;
      }
      return null;
    }
    index = next;
  }
  return ranges;
}

/**
 * @param {number} byte
 * @returns {boolean}
 */
function isDigit(byte) {
  return byte >= ZERO && byte <= NINE;
}

/**
 * @param {Buffer} source
 * @param {number} start
 * @param {number} end
 * @returns {number | undefined}
 */
function parseSmallPositiveIntegerRange(source, start, end) {
  const length = end - start;
  if (length <= 0 || length > 5) return undefined;
  const first = (source[start] ?? 0) - ZERO;
  if (first < 0 || first > 9) return undefined;
  if (length === 1) return first;
  const second = (source[start + 1] ?? 0) - ZERO;
  if (second < 0 || second > 9) return undefined;
  if (length === 2) return first * 10 + second;
  const third = (source[start + 2] ?? 0) - ZERO;
  if (third < 0 || third > 9) return undefined;
  if (length === 3) return (first * 10 + second) * 10 + third;
  const fourth = (source[start + 3] ?? 0) - ZERO;
  if (fourth < 0 || fourth > 9) return undefined;
  if (length === 4) return ((first * 10 + second) * 10 + third) * 10 + fourth;
  const fifth = (source[start + 4] ?? 0) - ZERO;
  if (fifth < 0 || fifth > 9) return undefined;
  return (((first * 10 + second) * 10 + third) * 10 + fourth) * 10 + fifth;
}

/**
 * @param {Buffer} source
 * @param {number} start
 * @param {number} end
 * @returns {number | undefined}
 */
function parseAsciiNumberRange(source, start, end) {
  if (start >= end) return undefined;
  const smallInteger = parseSmallPositiveIntegerRange(source, start, end);
  if (smallInteger !== undefined) return smallInteger;

  const parsed = Number(source.toString("utf8", start, end));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Fast path for the dominant persisted pencil delta shape, e.g. `1 3`.
 * Falls back for signed values and values wider than two digits.
 *
 * @param {Buffer} d
 * @param {number} index
 * @param {number} end
 * @returns {number}
 */
function readTinyPositivePathIntegerPairEnd(d, index, end) {
  if (index + 2 >= end) return -1;
  let next = index;
  let first = (d[next] ?? 0) - ZERO;
  if (first < 0 || first > 9) return -1;
  next += 1;
  if (d[next] !== SPACE) {
    const firstSecondDigit = (d[next] ?? 0) - ZERO;
    if (firstSecondDigit < 0 || firstSecondDigit > 9) return -1;
    first = first * 10 + firstSecondDigit;
    next += 1;
    if (d[next] !== SPACE) return -1;
  }
  next += 1;
  if (next >= end) return -1;

  let second = (d[next] ?? 0) - ZERO;
  if (second < 0 || second > 9) return -1;
  next += 1;
  if (next < end) {
    const secondSecondDigit = (d[next] ?? 0) - ZERO;
    if (secondSecondDigit >= 0 && secondSecondDigit <= 9) {
      second = second * 10 + secondSecondDigit;
      next += 1;
      if (next < end && isDigit(d[next] ?? 0)) return -1;
    }
  }

  lastCanonicalPathFirstInteger = first;
  lastCanonicalPathSecondInteger = second;
  return next;
}

/**
 * @param {Buffer} d
 * @param {number} index
 * @param {number} end
 * @returns {number}
 */
function readCanonicalPathIntegerPairEnd(d, index, end) {
  const tinyEnd = readTinyPositivePathIntegerPairEnd(d, index, end);
  if (tinyEnd !== -1) return tinyEnd;

  let next = index;
  let sign = 1;
  if (next < end && d[next] === HYPHEN) {
    sign = -1;
    next += 1;
  }
  if (next >= end) return -1;
  let byte = d[next];
  if (byte === undefined) return -1;
  let code = byte - ZERO;
  if (code < 0 || code > 9) return -1;
  let first = 0;
  while (next < end && code >= 0 && code <= 9) {
    first = first * 10 + code;
    next += 1;
    if (next >= end) break;
    byte = d[next];
    if (byte === undefined) break;
    code = byte - ZERO;
  }
  lastCanonicalPathFirstInteger = sign * first;
  if (next >= end || d[next] !== SPACE) return -1;
  next += 1;

  sign = 1;
  if (next < end && d[next] === HYPHEN) {
    sign = -1;
    next += 1;
  }
  if (next >= end) return -1;
  byte = d[next];
  if (byte === undefined) return -1;
  code = byte - ZERO;
  if (code < 0 || code > 9) return -1;
  let second = 0;
  while (next < end && code >= 0 && code <= 9) {
    second = second * 10 + code;
    next += 1;
    if (next >= end) break;
    byte = d[next];
    if (byte === undefined) break;
    code = byte - ZERO;
  }
  lastCanonicalPathSecondInteger = sign * second;
  return next;
}

/**
 * @param {Buffer} d
 * @param {number} start
 * @param {number} end
 * @returns {{
 *   childCount: number,
 *   localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null,
 *   lastPoint: {x: number, y: number} | null,
 * }}
 */
function scanCanonicalPathRange(d, start, end) {
  if (end - start < 5 || d[start] !== UPPER_M || d[start + 1] !== SPACE) {
    return EMPTY_PERSISTED_PENCIL_SCAN;
  }

  let index = start + 2;
  index = readCanonicalPathIntegerPairEnd(d, index, end);
  if (index === -1) return EMPTY_PERSISTED_PENCIL_SCAN;
  const firstX = lastCanonicalPathFirstInteger;
  const firstY = lastCanonicalPathSecondInteger;

  let currentX = firstX;
  let currentY = firstY;
  let minX = currentX;
  let minY = currentY;
  let maxX = currentX;
  let maxY = currentY;
  let childCount = 1;
  let previousDistinctX = currentX;
  let previousDistinctY = currentY;

  while (index < end) {
    if (
      index + 2 >= end ||
      d[index] !== SPACE ||
      d[index + 1] !== LOWER_L ||
      d[index + 2] !== SPACE
    ) {
      return EMPTY_PERSISTED_PENCIL_SCAN;
    }
    index += 3;
    index = readCanonicalPathIntegerPairEnd(d, index, end);
    if (index === -1) return EMPTY_PERSISTED_PENCIL_SCAN;
    currentX += lastCanonicalPathFirstInteger;
    currentY += lastCanonicalPathSecondInteger;
    if (previousDistinctX === currentX && previousDistinctY === currentY) {
      continue;
    }
    previousDistinctX = currentX;
    previousDistinctY = currentY;
    childCount += 1;
    if (currentX < minX) minX = currentX;
    else if (currentX > maxX) maxX = currentX;
    if (currentY < minY) minY = currentY;
    else if (currentY > maxY) maxY = currentY;
  }

  return {
    childCount,
    localBounds: { minX, minY, maxX, maxY },
    lastPoint: { x: currentX, y: currentY },
  };
}

/**
 * @param {Buffer} d
 * @param {number} start
 * @param {number} end
 * @returns {IterableIterator<{x: number, y: number}>}
 */
function* iterateCanonicalPathRange(d, start, end) {
  if (end - start < 5 || d[start] !== UPPER_M || d[start + 1] !== SPACE) {
    return;
  }

  let index = start + 2;
  index = readCanonicalPathIntegerPairEnd(d, index, end);
  if (index === -1) return;
  let currentX = lastCanonicalPathFirstInteger;
  let currentY = lastCanonicalPathSecondInteger;
  yield { x: currentX, y: currentY };

  while (index < end) {
    if (
      index + 2 >= end ||
      d[index] !== SPACE ||
      d[index + 1] !== LOWER_L ||
      d[index + 2] !== SPACE
    ) {
      return;
    }
    index += 3;
    index = readCanonicalPathIntegerPairEnd(d, index, end);
    if (index === -1) return;
    currentX += lastCanonicalPathFirstInteger;
    currentY += lastCanonicalPathSecondInteger;
    yield { x: currentX, y: currentY };
  }
}

class StoredSvgElement {
  /**
   * @param {Buffer} sourceBuffer
   * @param {number} leadingByteLength
   */
  constructor(sourceBuffer, leadingByteLength) {
    /** @type {"item"} */
    this.type = "item";
    this.sourceBuffer = sourceBuffer;
    this._leadingByteLength = leadingByteLength;
    this.consumedBytes = sourceBuffer.length;

    const openTagEnd = indexOfTagEnd(sourceBuffer, leadingByteLength + 1);
    const tag =
      openTagEnd === -1
        ? undefined
        : matchStoredTag(sourceBuffer, leadingByteLength, openTagEnd);
    if (!tag || openTagEnd === -1) {
      throw new Error("Invalid stored SVG element");
    }
    const closeTagStart = sourceBuffer.length - tag.close.length;

    this.tagName = tag.tagName;
    this.toolContract = tag.toolContract;
    this._attributeStart = leadingByteLength + tag.attributeOffset;
    this._attributeEnd = openTagEnd;
    /** @type {Buffer | undefined} */
    this._attributeBuffer = undefined;
    this._contentStart = openTagEnd + 1;
    this._contentEnd = closeTagStart;
    this._attributeLayout = tag.attributeLayout;
    /** @type {number[] | null | undefined} */
    this._orderedAttributeRanges = undefined;
    this._rangeStart = -1;
    this._rangeEnd = -1;
    this.id = readLeadingIdAttributeAt(sourceBuffer, this._attributeStart);
  }

  /**
   * @returns {Buffer}
   */
  get attributeBuffer() {
    if (!this._attributeBuffer) {
      this._attributeBuffer = this.sourceBuffer.subarray(
        this._attributeStart,
        this._attributeEnd,
      );
    }
    return this._attributeBuffer;
  }

  /**
   * @returns {Buffer}
   */
  get leadingBuffer() {
    return this._leadingByteLength === 0
      ? EMPTY_BUFFER
      : this.sourceBuffer.subarray(0, this._leadingByteLength);
  }

  /**
   * @returns {Buffer}
   */
  get contentBuffer() {
    return this._contentStart === this._contentEnd
      ? EMPTY_BUFFER
      : this.sourceBuffer.subarray(this._contentStart, this._contentEnd);
  }

  /**
   * @returns {number[] | null}
   */
  _orderedRanges() {
    if (this._orderedAttributeRanges !== undefined) {
      return this._orderedAttributeRanges;
    }
    this._orderedAttributeRanges =
      readOrderedAttributeRanges(
        this.attributeBuffer,
        0,
        this.attributeBuffer.length,
        this._attributeLayout,
      ) || null;
    return this._orderedAttributeRanges;
  }

  /**
   * @param {string} attrName
   * @returns {boolean}
   */
  _findAttributeRange(attrName) {
    const attributeIndex = this._attributeLayout.indexes[attrName];
    if (attributeIndex !== undefined) {
      const ranges = this._orderedRanges();
      if (ranges) {
        const start = ranges[attributeIndex * 2];
        const end = ranges[attributeIndex * 2 + 1];
        if (
          typeof start !== "number" ||
          typeof end !== "number" ||
          start < 0 ||
          end < start
        ) {
          return false;
        }
        this._rangeStart = start;
        this._rangeEnd = end;
        return true;
      }
    }
    const range = findAttributeValueRange(this.attributeBuffer, attrName);
    if (!range) return false;
    this._rangeStart = range.start;
    this._rangeEnd = range.end;
    return true;
  }

  /**
   * @param {string} attrName
   * @returns {string | undefined}
   */
  readStringAttr(attrName) {
    if (attrName === "id") return this.id;
    if (!this._findAttributeRange(attrName)) return undefined;
    return this.attributeBuffer.toString(
      "utf8",
      this._rangeStart,
      this._rangeEnd,
    );
  }

  /**
   * @param {string} attrName
   * @returns {number | undefined}
   */
  readNumberAttr(attrName) {
    return this._findAttributeRange(attrName)
      ? parseAsciiNumberRange(
          this.attributeBuffer,
          this._rangeStart,
          this._rangeEnd,
        )
      : undefined;
  }

  /**
   * @returns {IterableIterator<{x: number, y: number}>}
   */
  *readSvgPathAttr() {
    if (!this._findAttributeRange("d")) return;
    yield* iterateCanonicalPathRange(
      this.attributeBuffer,
      this._rangeStart,
      this._rangeEnd,
    );
  }

  /**
   * @returns {{
   *   childCount: number,
   *   localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null,
   *   lastPoint: {x: number, y: number} | null,
   * }}
   */
  scanSvgPathAttr() {
    return this._findAttributeRange("d")
      ? scanCanonicalPathRange(
          this.attributeBuffer,
          this._rangeStart,
          this._rangeEnd,
        )
      : EMPTY_PERSISTED_PENCIL_SCAN;
  }

  /**
   * @returns {string | undefined}
   */
  readTextContent() {
    const contentBuffer = this.contentBuffer;
    if (contentBuffer.length === 0) return "";
    const content = contentBuffer.toString("utf8");
    return byteExistsInRange(contentBuffer, AMPERSAND, 0, contentBuffer.length)
      ? unescapeHtml(content)
      : content;
  }

  /**
   * @returns {number}
   */
  readDecodedTextLength() {
    const contentBuffer = this.contentBuffer;
    const plainLength = plainAsciiXmlTextLength(
      contentBuffer,
      0,
      contentBuffer.length,
    );
    if (plainLength !== -1) return plainLength;
    return this.readTextContent()?.length || 0;
  }
}

/**
 * @typedef {{type: "suffix", sourceBuffer: Buffer, leadingBuffer: Buffer, suffixBuffer: Buffer, consumedBytes: number}} StoredSvgSuffix
 */

/**
 * @param {Buffer} source
 * @param {Buffer} leading
 * @param {Buffer} suffix
 * @returns {StoredSvgSuffix}
 */
function storedSvgSuffix(source, leading, suffix) {
  return {
    type: "suffix",
    sourceBuffer: source,
    leadingBuffer: leading,
    suffixBuffer: suffix,
    consumedBytes: source.length,
  };
}

const STORED_TAGS = Object.entries(TOOL_BY_STORED_TAG_NAME).map(
  ([tagName, toolContract]) => ({
    tagName,
    toolContract,
    open: Buffer.from(`<${tagName}`),
    close: Buffer.from(`</${tagName}>`),
    attributeOffset: tagName.length + 1,
    attributeLayout: contractAttributeLayout(
      /** @type {keyof typeof TOOL_BY_STORED_TAG_NAME} */ (tagName),
    ),
  }),
);

/**
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number} openTagEnd
 * @returns {(typeof STORED_TAGS)[number] | undefined}
 */
function matchStoredTag(buffer, offset, openTagEnd) {
  for (const tag of STORED_TAGS) {
    if (matchesStoredTag(buffer, offset, openTagEnd, tag)) {
      return tag;
    }
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {Buffer}
 */
function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
}

/**
 * @param {Buffer} current
 * @param {Buffer} chunk
 * @returns {Buffer}
 */
function appendChunk(current, chunk) {
  if (chunk.length === 0) return current;
  if (current.length === 0) return chunk;
  return Buffer.concat([current, chunk], current.length + chunk.length);
}

/**
 * @param {Buffer} buffer
 * @returns {{prefix: Buffer, consumed: number} | null}
 */
function tryExtractPrefix(buffer) {
  let searchIndex = 0;
  while (true) {
    const start = buffer.indexOf(GROUP_OPEN, searchIndex);
    if (start === -1) return null;
    const end = indexOfTagEnd(buffer, start + GROUP_OPEN.length);
    if (end === -1) return null;
    if (
      readBufferAttribute(
        buffer.subarray(start + GROUP_OPEN.length, end),
        "id",
      ) === DRAWING_AREA_ID
    ) {
      return {
        prefix: buffer.subarray(0, end + 1),
        consumed: end + 1,
      };
    }
    searchIndex = end + 1;
  }
}

/**
 * @param {Buffer} buffer
 * @returns {StoredSvgElement | StoredSvgSuffix | null}
 */
function tryExtractItemOrSuffix(buffer) {
  let offset = 0;
  while (offset < buffer.length && buffer[offset] !== 60) {
    offset += 1;
  }
  if (offset === buffer.length) return null;

  if (buffer[offset + 1] === SLASH) {
    const closeTagEnd = indexOfTagEnd(buffer, offset + 2);
    if (closeTagEnd === -1) return null;
    if (bufferStartsWith(buffer, offset, DRAWING_AREA_CLOSE)) {
      return storedSvgSuffix(
        buffer,
        buffer.subarray(0, offset),
        buffer.subarray(offset),
      );
    }
    throw new Error("Unexpected closing tag inside drawingArea");
  }

  const openTagEnd = indexOfTagEnd(buffer, offset + 1);
  if (openTagEnd === -1) return null;
  const tag = matchStoredTag(buffer, offset, openTagEnd);
  if (!tag) {
    throw new Error(
      `Unexpected direct child start tag ${JSON.stringify(
        buffer.toString("utf8", offset, Math.min(openTagEnd + 1, offset + 32)),
      )} inside drawingArea`,
    );
  }

  const closeTagStart = buffer.indexOf(tag.close, openTagEnd + 1);
  if (closeTagStart === -1) return null;
  const closeTagEnd = closeTagStart + tag.close.length;
  return new StoredSvgElement(buffer.subarray(0, closeTagEnd), offset);
}

/**
 * @param {AsyncIterable<string | Buffer>} input
 * @returns {AsyncIterable<
 *   | {type: "prefix", prefix: Buffer}
 *   | StoredSvgElement
 *   | StoredSvgSuffix
 *   | {type: "tail", chunk: Buffer}
 * >}
 */
async function* streamStoredSvgStructure(input) {
  /** @type {Buffer} */
  let pending = EMPTY_BUFFER;
  let prefixDone = false;
  const iterator = input[Symbol.asyncIterator]();

  while (true) {
    const step = await iterator.next();
    if (step.done) break;
    const chunk = asBuffer(step.value);
    let pendingLength = pending.length;
    let buffer = pendingLength === 0 ? chunk : appendChunk(pending, chunk);
    pending = EMPTY_BUFFER;

    if (!prefixDone) {
      const extractedPrefix = tryExtractPrefix(buffer);
      if (!extractedPrefix) {
        pending = buffer;
        continue;
      }
      prefixDone = true;
      buffer =
        pendingLength === 0
          ? buffer.subarray(extractedPrefix.consumed)
          : chunk.subarray(extractedPrefix.consumed - pendingLength);
      pendingLength = 0;
      yield { type: "prefix", prefix: extractedPrefix.prefix };
    }

    if (prefixDone && pendingLength > 0) {
      const extracted = tryExtractItemOrSuffix(buffer);
      if (!extracted) {
        pending = buffer;
        continue;
      }
      buffer = chunk.subarray(extracted.consumedBytes - pendingLength);
      pendingLength = 0;
      if (extracted.type === "suffix") {
        yield extracted;
        while (true) {
          const remaining = await iterator.next();
          if (remaining.done) return;
          yield { type: "tail", chunk: asBuffer(remaining.value) };
        }
      }
      yield extracted;
    }

    while (prefixDone) {
      const extracted = tryExtractItemOrSuffix(buffer);
      if (!extracted) {
        pending = buffer;
        break;
      }
      buffer = buffer.subarray(extracted.consumedBytes);
      if (extracted.type === "suffix") {
        yield extracted;
        while (true) {
          const remaining = await iterator.next();
          if (remaining.done) return;
          yield { type: "tail", chunk: asBuffer(remaining.value) };
        }
      }
      yield extracted;
    }
  }

  if (!prefixDone) {
    throw new Error("Missing drawingArea group");
  }
  throw new Error("Unterminated drawingArea group");
}

/**
 * @param {AsyncIterable<string | Buffer>} input
 * @returns {AsyncIterable<StoredSvgElement>}
 */
async function* streamStoredSvgElements(input) {
  for await (const part of streamStoredSvgStructure(input)) {
    if (part.type === "item") yield part;
  }
}

export {
  StoredSvgElement,
  readBufferAttribute,
  streamStoredSvgElements,
  streamStoredSvgStructure,
};
