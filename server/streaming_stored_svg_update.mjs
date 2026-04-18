import {
  parseStoredSvgItem,
  serializeStoredSvgItem,
} from "./stored_svg_item_codec.mjs";
import { parseAttributes, updateRootMetadata } from "./svg_envelope.mjs";

const STORED_ITEM_TAG_NAMES = new Set([
  "rect",
  "ellipse",
  "line",
  "text",
  "path",
]);

/**
 * @param {any[]} mutations
 * @returns {any[]}
 */
function flattenMutations(mutations) {
  /** @type {any[]} */
  const flat = [];
  for (const mutation of mutations || []) {
    if (!mutation || typeof mutation !== "object") continue;
    if (Array.isArray(mutation._children)) {
      for (const child of mutation._children) {
        flat.push({ ...child, tool: mutation.tool });
      }
      continue;
    }
    flat.push(mutation);
  }
  return flat;
}

/**
 * @param {any} mutation
 * @returns {boolean}
 */
function isCreateMutation(mutation) {
  return !!(
    mutation &&
    typeof mutation === "object" &&
    typeof mutation.id === "string" &&
    !["update", "child", "copy", "delete", "clear"].includes(mutation.type)
  );
}

/**
 * @param {Map<string, any[]>} map
 * @param {string} id
 * @param {any} mutation
 * @returns {void}
 */
function appendById(map, id, mutation) {
  const existing = map.get(id);
  if (existing) {
    existing.push(structuredClone(mutation));
    return;
  }
  map.set(id, [structuredClone(mutation)]);
}

/**
 * @param {any[]} mutations
 * @returns {{
 *   clearExisting: boolean,
 *   opsById: Map<string, any[]>,
 *   appendOrder: string[],
 *   appendSourcesById: Map<string, {kind: "create", item: any} | {kind: "copy", sourceId: string}>,
 * } | null}
 */
function planStreamingMutations(mutations) {
  let clearExisting = false;
  const opsById = new Map();
  /** @type {string[]} */
  let appendOrder = [];
  /** @type {Map<string, {kind: "create", item: any} | {kind: "copy", sourceId: string}>} */
  let appendSourcesById = new Map();

  for (const mutation of flattenMutations(mutations)) {
    if (!mutation || typeof mutation !== "object") return null;
    if (mutation.type === "clear") {
      clearExisting = true;
      opsById.clear();
      appendOrder = [];
      appendSourcesById = new Map();
      continue;
    }

    if (isCreateMutation(mutation)) {
      if (typeof mutation.id !== "string") return null;
      appendSourcesById.set(mutation.id, {
        kind: "create",
        item: structuredClone(mutation),
      });
      if (!appendOrder.includes(mutation.id)) {
        appendOrder.push(mutation.id);
      }
      continue;
    }

    if (mutation.type === "copy") {
      if (
        typeof mutation.id !== "string" ||
        typeof mutation.newid !== "string"
      ) {
        return null;
      }
      appendSourcesById.set(mutation.newid, {
        kind: "copy",
        sourceId: mutation.id,
      });
      if (!appendOrder.includes(mutation.newid)) {
        appendOrder.push(mutation.newid);
      }
      appendById(opsById, mutation.id, mutation);
      continue;
    }

    const id = mutation.type === "child" ? mutation.parent : mutation.id;
    if (typeof id !== "string") {
      return null;
    }
    appendById(opsById, id, mutation);
  }

  return {
    clearExisting,
    opsById,
    appendOrder,
    appendSourcesById,
  };
}

/**
 * @param {any} item
 * @param {any[]} ops
 * @returns {{item: any | null, copies: Map<string, any>}}
 */
function applyOpsToItem(item, ops) {
  let current = structuredClone(item);
  const copies = new Map();
  let deleted = false;

  for (const op of ops || []) {
    if (deleted || !current) break;
    switch (op.type) {
      case "update": {
        const patch = { ...op };
        delete patch.tool;
        delete patch.type;
        delete patch.clientMutationId;
        current = { ...current, ...patch };
        break;
      }
      case "child": {
        if (current.tool !== "Pencil") break;
        const nextChildren = Array.isArray(current._children)
          ? current._children.slice()
          : [];
        nextChildren.push({ x: op.x, y: op.y });
        current = { ...current, _children: nextChildren };
        break;
      }
      case "copy": {
        const copied = structuredClone(current);
        copied.id = op.newid;
        copies.set(op.newid, copied);
        break;
      }
      case "delete":
        deleted = true;
        current = null;
        break;
      default:
        break;
    }
  }

  return {
    item: current,
    copies,
  };
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
    const attributes = parseAttributes(buffer.slice(start + 2, end));
    if (attributes.id === "drawingArea") {
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
 * @returns {{type: "suffix", leadingText: string, suffix: string, consumed: number} | {type: "item", leadingText: string, entry: {raw: string, tagName: string, content: string, attributes: {[name: string]: string}}, consumed: number} | null}
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
  const tagNameMatch = startTag.match(/^<(rect|ellipse|line|text|path)\b/);
  if (!tagNameMatch) {
    throw new Error(
      `Unexpected direct child start tag ${JSON.stringify(startTag.slice(0, 32))} inside drawingArea`,
    );
  }
  const tagName = tagNameMatch[1];
  if (!tagName) return null;
  if (!STORED_ITEM_TAG_NAMES.has(tagName)) {
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
      content: buffer.slice(openTagEnd + 1, closeTagStart),
      attributes: parseAttributes(
        buffer.slice(offset + 1 + tagName.length, openTagEnd),
      ),
    },
    consumed: closeTagEnd,
  };
}

/**
 * @param {AsyncIterable<string | Buffer>} input
 * @param {any[]} mutations
 * @param {{metadata?: {readonly: boolean}, toSeqInclusive?: number, stats?: {[name: string]: number}}=} [options]
 * @returns {AsyncIterable<string>}
 */
async function* streamingUpdate(input, mutations, options) {
  const plan = planStreamingMutations(mutations);
  if (!plan) {
    throw new Error("Streaming rewrite does not support this mutation set");
  }

  const stats = options?.stats;
  if (stats && stats.parsedExistingItems === undefined) {
    stats.parsedExistingItems = 0;
  }
  let buffer = "";
  let prefixDone = false;
  const resolvedCopies = new Map();
  const appendedItems = new Map();
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
      yield options?.metadata
        ? updateRootMetadata(
            extractedPrefix.prefix,
            options.metadata,
            options.toSeqInclusive || 0,
          )
        : extractedPrefix.prefix;
    }

    while (prefixDone) {
      const extracted = tryExtractItemOrSuffix(buffer);
      if (!extracted) break;
      buffer = buffer.slice(extracted.consumed);

      if (extracted.type === "suffix") {
        for (const id of plan.appendOrder) {
          const source = plan.appendSourcesById.get(id);
          if (!source) continue;

          /** @type {any | undefined} */
          let baseItem;
          if (source.kind === "create") {
            baseItem = structuredClone(source.item);
          } else if (appendedItems.has(source.sourceId)) {
            baseItem = structuredClone(appendedItems.get(source.sourceId));
            baseItem.id = id;
          } else if (resolvedCopies.has(id)) {
            baseItem = structuredClone(resolvedCopies.get(id));
          }
          if (!baseItem) continue;

          const applied = applyOpsToItem(baseItem, plan.opsById.get(id) || []);
          for (const [copyId, copied] of applied.copies.entries()) {
            resolvedCopies.set(copyId, copied);
          }
          if (!applied.item) continue;
          appendedItems.set(id, applied.item);
          yield serializeStoredSvgItem(applied.item);
        }
        yield extracted.leadingText + extracted.suffix;
        while (true) {
          const remaining = await iterator.next();
          if (remaining.done) return;
          yield String(remaining.value);
        }
      }

      const id = extracted.entry.attributes.id;
      const ops = typeof id === "string" ? plan.opsById.get(id) : undefined;
      if (plan.clearExisting) {
        continue;
      }
      if (!ops || ops.length === 0) {
        yield extracted.leadingText + extracted.entry.raw;
        continue;
      }

      if (stats) {
        stats.parsedExistingItems = (stats.parsedExistingItems || 0) + 1;
      }
      const parsedItem = parseStoredSvgItem(extracted.entry);
      if (!parsedItem) {
        yield extracted.leadingText + extracted.entry.raw;
        continue;
      }
      const applied = applyOpsToItem(parsedItem, ops);
      for (const [copyId, copied] of applied.copies.entries()) {
        resolvedCopies.set(copyId, copied);
      }
      if (applied.item) {
        yield extracted.leadingText + serializeStoredSvgItem(applied.item);
      }
    }
  }

  if (!prefixDone) {
    throw new Error("Missing drawingArea group");
  }
  throw new Error("Unterminated drawingArea group");
}

export { streamingUpdate };
