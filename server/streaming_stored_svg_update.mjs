import {
  getMutationType,
  MutationType,
} from "../client-data/js/message_tool_metadata.js";
import {
  parseStoredSvgItem,
  serializeStoredSvgItem,
} from "./stored_svg_item_codec.mjs";
import { streamStoredSvgStructure } from "./streaming_stored_svg_scan.mjs";
import { updateRootMetadata } from "./svg_envelope.mjs";

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
    const mutationType = getMutationType(mutation);
    if (mutationType === MutationType.CLEAR) {
      clearExisting = true;
      opsById.clear();
      appendOrder = [];
      appendSourcesById = new Map();
      continue;
    }

    if (mutationType === MutationType.CREATE) {
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

    if (mutationType === MutationType.COPY) {
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

    const id =
      mutationType === MutationType.APPEND ? mutation.parent : mutation.id;
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
    switch (getMutationType(op)) {
      case MutationType.UPDATE: {
        const patch = { ...op };
        delete patch.tool;
        delete patch.type;
        delete patch.clientMutationId;
        current = { ...current, ...patch };
        break;
      }
      case MutationType.APPEND: {
        if (current.tool !== "Pencil") break;
        const nextChildren = Array.isArray(current._children)
          ? current._children.slice()
          : [];
        nextChildren.push({ x: op.x, y: op.y });
        current = { ...current, _children: nextChildren };
        break;
      }
      case MutationType.COPY: {
        const copied = structuredClone(current);
        copied.id = op.newid;
        copies.set(op.newid, copied);
        break;
      }
      case MutationType.DELETE:
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
  const resolvedCopies = new Map();
  const appendedItems = new Map();

  for await (const event of streamStoredSvgStructure(input)) {
    if (event.type === "prefix") {
      yield options?.metadata
        ? updateRootMetadata(
            event.prefix,
            options.metadata,
            options.toSeqInclusive || 0,
          )
        : event.prefix;
      continue;
    }

    if (event.type === "tail") {
      yield event.chunk;
      continue;
    }

    if (event.type === "suffix") {
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
      yield event.leadingText + event.suffix;
      continue;
    }

    const id = event.entry.id;
    const ops = typeof id === "string" ? plan.opsById.get(id) : undefined;
    if (plan.clearExisting) {
      continue;
    }
    if (!ops || ops.length === 0) {
      yield event.leadingText + event.entry.raw;
      continue;
    }

    if (stats) {
      stats.parsedExistingItems = (stats.parsedExistingItems || 0) + 1;
    }
    const parsedItem = parseStoredSvgItem(event.entry);
    if (!parsedItem) {
      yield event.leadingText + event.entry.raw;
      continue;
    }
    const applied = applyOpsToItem(parsedItem, ops);
    for (const [copyId, copied] of applied.copies.entries()) {
      resolvedCopies.set(copyId, copied);
    }
    if (applied.item) {
      yield event.leadingText + serializeStoredSvgItem(applied.item);
    }
  }
}

export { streamingUpdate };
