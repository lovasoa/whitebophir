import { TOOL_BY_STORED_TAG_NAME } from "../../client-data/tools/index.js";
import { readRawAttribute } from "./svg_envelope.mjs";

const STORED_ITEM_TAG_PATTERN = Object.keys(TOOL_BY_STORED_TAG_NAME).join("|");
const STORED_ITEM_TAG_REGEX = new RegExp(`^<(${STORED_ITEM_TAG_PATTERN})\\b`);

/**
 * Finds the root `<svg ...>` start tag in the currently buffered input.
 * This is intentionally narrower than structure scanning: callers that only
 * need root metadata should not wait for, or validate, the drawing area.
 *
 * @param {string} buffer
 * @returns {string | null}
 */
function tryExtractSvgRootTag(buffer) {
  const openTagStart = buffer.indexOf("<svg");
  if (openTagStart === -1) return null;
  const openTagEnd = buffer.indexOf(">", openTagStart);
  if (openTagEnd === -1) return null;
  return buffer.slice(openTagStart, openTagEnd + 1);
}

/**
 * Reads just enough of a stored SVG stream to return its root start tag.
 * The returned tag contains root metadata such as `data-wbo-seq`; item
 * structure and drawing-area validity are deliberately outside this function.
 *
 * @param {AsyncIterable<string>} input
 * @returns {Promise<string>}
 */
async function readStoredSvgRootTag(input) {
  let buffer = "";
  for await (const chunk of input) {
    buffer += chunk;
    const rootTag = tryExtractSvgRootTag(buffer);
    if (rootTag) return rootTag;
  }

  if (buffer.includes("<svg")) {
    throw new Error("Unterminated <svg> root");
  }
  throw new Error("Missing <svg> root");
}

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
 * @param {string} buffer
 * @returns {{type: "suffix", leadingText: string, suffix: string, consumed: number} | {type: "item", leadingText: string, entry: {raw: string, tagName: string, rawAttributes: string, id: string | undefined, content: string}, consumed: number} | null}
 */
function tryExtractItemOrSuffix(buffer) {
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
  const startTag = buffer.slice(offset, openTagEnd + 1);
  const tagNameMatch = startTag.match(STORED_ITEM_TAG_REGEX);
  if (!tagNameMatch) {
    throw new Error(
      `Unexpected direct child start tag ${JSON.stringify(startTag.slice(0, 32))} inside drawingArea`,
    );
  }
  const tagName = tagNameMatch[1];
  if (!tagName || !TOOL_BY_STORED_TAG_NAME[tagName]) {
    throw new Error(`Unexpected direct child <${tagName}> inside drawingArea`);
  }
  const closeToken = `</${tagName}>`;
  const closeTagStart = buffer.indexOf(closeToken, openTagEnd + 1);
  if (closeTagStart === -1) return null;
  const closeTagEnd = closeTagStart + closeToken.length;
  return {
    type: "item",
    leadingText,
    entry: {
      raw: buffer.slice(offset, closeTagEnd),
      tagName,
      rawAttributes: buffer.slice(offset + 1 + tagName.length, openTagEnd),
      id: readRawAttribute(
        buffer.slice(offset + 1 + tagName.length, openTagEnd),
        "id",
      ),
      content: buffer.slice(openTagEnd + 1, closeTagStart),
    },
    consumed: closeTagEnd,
  };
}

/**
 * @param {AsyncIterable<string | Buffer>} input
 * @returns {AsyncIterable<
 *   | {type: "prefix", prefix: string}
 *   | {type: "item", leadingText: string, entry: {raw: string, tagName: string, rawAttributes: string, id: string | undefined, content: string}}
 *   | {type: "suffix", leadingText: string, suffix: string}
 *   | {type: "tail", chunk: string}
 * >}
 */
async function* streamStoredSvgStructure(input) {
  let buffer = "";
  let prefixDone = false;
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
      const extracted = tryExtractItemOrSuffix(buffer);
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

export { readStoredSvgRootTag, streamStoredSvgStructure };
