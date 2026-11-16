import { TOOL_CONTRACT_BY_STORED_TAG_NAME as TOOL_BY_STORED_TAG_NAME } from "../../client-data/tools/contracts.js";
import {
  readRawAttribute,
  readRawAttributeFromRange,
} from "./svg_envelope.mjs";

/**
 * @typedef {{raw: string, tagName: string, rawAttributes?: string, id: string | undefined, content?: string}} StoredSvgStreamEntry
 */

/**
 * @param {string} buffer
 * @returns {{prefix: string, rest: string} | null}
 */
function tryExtractPrefix(buffer) {
  let searchIndex = 0;
  while (true) {
    const start = buffer.indexOf("<g", searchIndex);
    if (start === -1) return null;
    const end = buffer.indexOf(">", start);
    if (end === -1) return null;
    if (
      readRawAttribute(buffer.slice(start + 2, end), "id") === "drawingArea"
    ) {
      return {
        prefix: buffer.slice(0, end + 1),
        rest: buffer.slice(end + 1),
      };
    }
    searchIndex = end + 1;
  }
}

/**
 * Reads a direct child tag name from an already located SVG start tag.
 *
 * @param {string} buffer
 * @param {number} offset
 * @param {number} openTagEnd
 * @returns {string | undefined}
 */
function readStartTagName(buffer, offset, openTagEnd) {
  let end = offset + 1;
  while (end < openTagEnd) {
    const char = buffer[end];
    if (char !== undefined && (char <= " " || char === "/")) break;
    end += 1;
  }
  return end > offset + 1 ? buffer.slice(offset + 1, end) : undefined;
}

/**
 * Splits a direct child without decoding its geometry. Rewrites need only its
 * id and raw bytes; loads also request attributes and content for summaries.
 *
 * @param {string} buffer
 * @param {boolean} materializeEntryDetails
 * @returns {{type: "suffix", leadingText: string, suffix: string, consumed: number} | {type: "item", leadingText: string, entry: StoredSvgStreamEntry, consumed: number} | null}
 */
function tryExtractItemOrSuffix(buffer, materializeEntryDetails) {
  let offset = 0;
  while (offset < buffer.length && buffer[offset] !== "<") {
    offset += 1;
  }
  const leadingText = buffer.slice(0, offset);
  if (offset === buffer.length) return null;
  if (buffer[offset + 1] === "/") {
    const closeTagEnd = buffer.indexOf(">", offset + 2);
    if (closeTagEnd === -1) return null;
    if (buffer.slice(offset, closeTagEnd + 1) === "</g>") {
      return {
        type: "suffix",
        leadingText,
        suffix: buffer.slice(offset),
        consumed: buffer.length,
      };
    }
    throw new Error("Unexpected closing tag inside drawingArea");
  }

  const openTagEnd = buffer.indexOf(">", offset + 1);
  if (openTagEnd === -1) return null;
  const tagName = readStartTagName(buffer, offset, openTagEnd);
  if (
    !tagName ||
    !Object.prototype.hasOwnProperty.call(TOOL_BY_STORED_TAG_NAME, tagName)
  ) {
    throw new Error(`Unexpected direct child <${tagName}> inside drawingArea`);
  }
  const closeToken = `</${tagName}>`;
  const closeTagStart = buffer.indexOf(closeToken, openTagEnd + 1);
  if (closeTagStart === -1) return null;
  const closeTagEnd = closeTagStart + closeToken.length;
  const rawAttributesStart = offset + 1 + tagName.length;
  /** @type {StoredSvgStreamEntry} */
  const entry = {
    raw: buffer.slice(offset, closeTagEnd),
    tagName,
    id: readRawAttributeFromRange(buffer, "id", rawAttributesStart, openTagEnd),
  };
  if (materializeEntryDetails) {
    entry.rawAttributes = buffer.slice(rawAttributesStart, openTagEnd);
    entry.content = buffer.slice(openTagEnd + 1, closeTagStart);
  }
  return {
    type: "item",
    leadingText,
    entry,
    consumed: closeTagEnd,
  };
}

/**
 * @param {AsyncIterable<string | Buffer>} input
 * @param {{materializeEntryDetails?: boolean}=} [options]
 * @returns {AsyncIterable<
 *   | {type: "prefix", prefix: string}
 *   | {type: "item", leadingText: string, entry: StoredSvgStreamEntry}
 *   | {type: "suffix", leadingText: string, suffix: string}
 *   | {type: "tail", chunk: string}
 * >}
 */
async function* streamStoredSvgStructure(input, options) {
  let buffer = "";
  let prefixDone = false;
  const materializeEntryDetails = options?.materializeEntryDetails !== false;
  const iterator = input[Symbol.asyncIterator]();

  while (true) {
    const step = await iterator.next();
    if (step.done) break;
    buffer += String(step.value);

    if (!prefixDone) {
      const extractedPrefix = tryExtractPrefix(buffer);
      if (!extractedPrefix) {
        continue;
      }
      prefixDone = true;
      buffer = extractedPrefix.rest;
      yield { type: "prefix", prefix: extractedPrefix.prefix };
    }

    while (prefixDone) {
      const extracted = tryExtractItemOrSuffix(buffer, materializeEntryDetails);
      if (!extracted) break;
      buffer = buffer.slice(extracted.consumed);
      if (extracted.type === "suffix") {
        yield {
          type: "suffix",
          leadingText: extracted.leadingText,
          suffix: extracted.suffix,
        };
        while (true) {
          const remaining = await iterator.next();
          if (remaining.done) return;
          yield { type: "tail", chunk: String(remaining.value) };
        }
      }
      yield {
        type: "item",
        leadingText: extracted.leadingText,
        entry: extracted.entry,
      };
    }
  }

  if (!prefixDone) {
    throw new Error("Missing drawingArea group");
  }
  throw new Error("Unterminated drawingArea group");
}

export { streamStoredSvgStructure };
