import {
  renderPencilPath,
  scanPathSummary,
} from "../../client-data/tools/pencil/index.js";
import {
  TOOL_BY_ID,
  TOOL_BY_STORED_TAG_NAME,
} from "../../client-data/tools/index.js";
import { readRawAttribute } from "./svg_envelope.mjs";
import { decodedTextLength, escapeHtml, unescapeHtml } from "./xml_escape.mjs";

/** @typedef {import("../../client-data/tools/shape_contract.js").ToolContract} StoredSvgContract */

/**
 * @param {unknown} value
 * @returns {number}
 */
function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * @param {any} transform
 * @returns {string}
 */
function renderTransformAttribute(transform) {
  if (
    !transform ||
    typeof transform !== "object" ||
    !["a", "b", "c", "d", "e", "f"].every(
      (key) => typeof transform[key] === "number",
    )
  ) {
    return "";
  }
  return ` transform="matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})"`;
}

/**
 * @param {string | undefined} transform
 * @returns {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined}
 */
function parseTransformAttribute(transform) {
  if (!transform) return undefined;
  const match = transform.match(
    /^matrix\(\s*([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)\s*\)$/,
  );
  if (!match) return undefined;
  /** @type {number[]} */
  const values = match.slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
  return { a, b, c, d, e, f };
}

/**
 * @param {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined} transform
 * @returns {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined}
 */
function cloneTransform(transform) {
  return transform ? { ...transform } : undefined;
}

/**
 * @param {{attributes?: {[name: string]: string}, rawAttributes?: string, readStringAttr?: (name: string) => string | undefined}} entry
 * @param {string} name
 * @returns {string | undefined}
 */
function readStoredSvgAttribute(entry, name) {
  if (typeof entry?.readStringAttr === "function") {
    return entry.readStringAttr(name);
  }
  const value = entry?.attributes?.[name];
  if (typeof value === "string") return value;
  return readRawAttribute(entry?.rawAttributes, name);
}

/**
 * @param {{attributes?: {[name: string]: string}, rawAttributes?: string, readNumberAttr?: (name: string) => number | undefined, readStringAttr?: (name: string) => string | undefined}} entry
 * @param {string} name
 * @returns {number | undefined}
 */
function readStoredSvgNumberAttribute(entry, name) {
  if (typeof entry?.readNumberAttr === "function") {
    return entry.readNumberAttr(name);
  }
  return parseNumber(readStoredSvgAttribute(entry, name));
}

/**
 * @param {{attributes?: {[name: string]: string}, rawAttributes?: string, id?: string, readNumberAttr?: (name: string) => number | undefined, readStringAttr?: (name: string) => string | undefined}} entry
 * @returns {{id: string | undefined, opacity: number | undefined, transform: {a: number, b: number, c: number, d: number, e: number, f: number} | undefined}}
 */
function readStoredSvgBase(entry) {
  const id =
    typeof entry?.id === "string"
      ? entry.id
      : readStoredSvgAttribute(entry, "id");
  return {
    id,
    opacity: readStoredSvgNumberAttribute(entry, "opacity"),
    transform: parseTransformAttribute(
      readStoredSvgAttribute(entry, "transform"),
    ),
  };
}

const storedSvgSerializeHelpers = {
  escapeHtml,
  numberOrZero,
  renderTransformAttribute,
};

/**
 * @param {object} data
 * @param {number | undefined} opacity
 * @param {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined} transform
 * @returns {object}
 */
function decorateStoredItemData(data, opacity, transform) {
  return {
    ...data,
    ...(opacity !== undefined ? { opacity } : {}),
    ...(transform !== undefined
      ? { transform: cloneTransform(transform) }
      : {}),
  };
}

/**
 * @param {{content?: string, readTextContent?: () => string | undefined}} entry
 * @returns {string}
 */
function readStoredSvgTextContent(entry) {
  if (typeof entry?.readTextContent === "function") {
    return entry.readTextContent() || "";
  }
  return unescapeHtml(entry?.content || "");
}

/**
 * @param {{content?: string, readDecodedTextLength?: () => number}} entry
 * @returns {number}
 */
function readStoredSvgDecodedTextLength(entry) {
  if (typeof entry?.readDecodedTextLength === "function") {
    return entry.readDecodedTextLength();
  }
  return decodedTextLength(entry?.content || "");
}

/**
 * @param {{attributes?: {[name: string]: string}, rawAttributes?: string, readStringAttr?: (name: string) => string | undefined, scanSvgPathAttr?: () => {childCount: number, localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null}}} entry
 * @returns {{childCount: number, localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null}}
 */
function readStoredSvgPathSummary(entry) {
  if (typeof entry?.scanSvgPathAttr === "function") {
    return entry.scanSvgPathAttr();
  }
  return scanPathSummary(readStoredSvgAttribute(entry, "d"));
}

/**
 * @param {{tagName?: string, toolContract?: StoredSvgContract, attributes?: {[name: string]: string}, rawAttributes?: string, content?: string, id?: string, readStringAttr?: (name: string) => string | undefined, readNumberAttr?: (name: string) => number | undefined}} entry
 * @returns {any | null}
 */
function parseStoredSvgItem(entry) {
  const summary = summarizeStoredSvgItem(entry);
  if (!summary) return null;
  const contract = TOOL_BY_ID[summary.tool];
  if (contract && typeof contract.parseStoredSvgItem === "function") {
    return contract.parseStoredSvgItem(summary, entry, {
      readStoredSvgAttribute,
      readStoredSvgTextContent,
    });
  }
  return {
    id: summary.id,
    tool: summary.tool,
    ...summary.data,
  };
}

/**
 * @param {{tagName?: string, toolContract?: StoredSvgContract, attributes?: {[name: string]: string}, rawAttributes?: string, content?: string, id?: string, readStringAttr?: (name: string) => string | undefined, readNumberAttr?: (name: string) => number | undefined, scanSvgPathAttr?: () => any, readDecodedTextLength?: () => number}} entry
 * @param {number} [paintOrder]
 * @returns {any | null}
 */
function summarizeStoredSvgItem(entry, paintOrder) {
  if (!entry) return null;
  const { id, opacity, transform } = readStoredSvgBase(entry);
  if (!id) return null;
  const contract =
    entry.toolContract ||
    (typeof entry.tagName === "string"
      ? TOOL_BY_STORED_TAG_NAME[entry.tagName]
      : undefined);
  if (contract) {
    return contract.summarizeStoredSvgItem(entry, paintOrder, {
      id,
      opacity,
      transform,
      decorateStoredItemData,
      parseNumber,
      readStoredSvgAttribute,
      readStoredSvgDecodedTextLength,
      readStoredSvgNumberAttribute,
      readStoredSvgPathSummary,
    });
  }
  return null;
}

/**
 * @param {any} item
 * @returns {string}
 */
function serializeStoredSvgItem(item) {
  if (!item || typeof item !== "object" || typeof item.tool !== "string") {
    return "";
  }
  const contract = TOOL_BY_ID[item.tool];
  if (contract && typeof contract.serializeStoredSvgItem === "function") {
    return contract.serializeStoredSvgItem(item, {
      escapeHtml,
      numberOrZero,
      renderTransformAttribute,
    });
  }
  return "";
}

export {
  parseStoredSvgItem,
  scanPathSummary,
  parseTransformAttribute,
  renderPencilPath,
  renderTransformAttribute,
  serializeStoredSvgItem,
  storedSvgSerializeHelpers,
  summarizeStoredSvgItem,
};
