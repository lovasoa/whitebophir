import { wboPencilPoint } from "../client-data/tools/pencil/wbo_pencil_point.js";
import {
  parseStoredSvgEnvelope,
  parseStoredSvgItems,
  serializeStoredSvgEnvelope,
  updateRootMetadata,
} from "./svg_envelope.mjs";
import {
  parseStoredSvgItem,
  serializeStoredSvgItem,
} from "./stored_svg_item_codec.mjs";

/**
 * @param {any} item
 * @returns {string}
 */
function serializeStoredItemTag(item) {
  return serializeStoredSvgItem(item);
}

/**
 * @param {string} svg
 * @returns {{prefix: string, suffix: string, order: string[], items: Map<string, any>}}
 */
function parseStoredSvgState(svg) {
  const envelope = parseStoredSvgEnvelope(svg);
  /** @type {string[]} */
  const order = [];
  const items = new Map();
  for (const itemEntry of parseStoredSvgItems(envelope.drawingAreaContent)) {
    const item = parseStoredSvgItem(itemEntry);
    const id = item?.id;
    if (!id) continue;
    order.push(id);
    items.set(id, item);
  }
  return {
    prefix: envelope.prefix,
    suffix: envelope.suffix,
    order,
    items,
  };
}

/**
 * @param {string[]} order
 * @param {string} id
 * @returns {void}
 */
function removeOrderedId(order, id) {
  const index = order.indexOf(id);
  if (index !== -1) {
    order.splice(index, 1);
  }
}

/**
 * @param {string} pathData
 * @returns {number[]}
 */
function findPathCommandPositions(pathData) {
  /** @type {number[]} */
  const positions = [];
  for (let index = 0; index < pathData.length; index++) {
    const char = pathData[index];
    if (char === "M" || char === "L" || char === "C") {
      positions.push(index);
    }
  }
  return positions;
}

/**
 * @param {string} segmentText
 * @returns {{type: string, values: number[]}}
 */
function parsePathSegment(segmentText) {
  const type = segmentText[0] || "";
  const values = segmentText
    .slice(1)
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  return { type, values };
}

/**
 * @param {{type: string, values: number[]}} segment
 * @returns {string}
 */
function renderPathSegment(segment) {
  return `${segment.type} ${segment.values.join(" ")}`;
}

/**
 * @param {{raw: string, attributes: {[name: string]: string}}} entry
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function appendPencilChildToRawEntry(entry, x, y) {
  const pathData = entry.attributes?.d;
  if (typeof pathData !== "string" || pathData.length === 0) return false;
  const positions = findPathCommandPositions(pathData);
  if (positions.length < 2) return false;
  const lastIndex = positions[positions.length - 1];
  if (lastIndex === undefined) return false;

  if (positions.length === 2) {
    const firstIndex = positions[0];
    const secondIndex = positions[1];
    if (firstIndex === undefined || secondIndex === undefined) return false;
    /** @type {{type: string, values: number[]}[]} */
    const tail = [
      parsePathSegment(pathData.slice(firstIndex, secondIndex).trim()),
      parsePathSegment(pathData.slice(secondIndex).trim()),
    ];
    wboPencilPoint(tail, x, y);
    const appended = tail[tail.length - 1];
    if (!appended) return false;
    const nextPathData = `${pathData} ${renderPathSegment(appended)}`;
    entry.attributes.d = nextPathData;
    entry.raw = entry.raw.replace(`d="${pathData}"`, `d="${nextPathData}"`);
    return true;
  }

  const secondLastIndex = positions[positions.length - 2];
  if (secondLastIndex === undefined) return false;
  const lastSegment = parsePathSegment(pathData.slice(lastIndex).trim());
  const secondLastSegment = parsePathSegment(
    pathData.slice(secondLastIndex, lastIndex).trim(),
  );
  /** @type {{type: string, values: number[]}[]} */
  const tail = [{ type: "M", values: [0, 0] }, secondLastSegment, lastSegment];
  wboPencilPoint(tail, x, y);
  const updatedLast = tail[2];
  const appended = tail[3];
  if (!updatedLast || !appended) return false;
  const prefix = pathData.slice(0, lastIndex).trimEnd();
  const nextPathData = `${prefix} ${renderPathSegment(updatedLast)} ${renderPathSegment(appended)}`;
  entry.attributes.d = nextPathData;
  entry.raw = entry.raw.replace(`d="${pathData}"`, `d="${nextPathData}"`);
  return true;
}

/**
 * @param {{order: string[], items: Map<string, any>}} state
 * @param {any} item
 * @param {{appendOnExisting?: boolean}=} [options]
 * @returns {void}
 */
function upsertItem(state, item, options) {
  if (!item || typeof item.id !== "string" || item.id.length === 0) return;
  const appendOnExisting = options?.appendOnExisting === true;
  const alreadyExists = state.items.has(item.id);
  state.items.set(item.id, structuredClone(item));
  if (!alreadyExists) {
    state.order.push(item.id);
    return;
  }
  if (appendOnExisting) {
    removeOrderedId(state.order, item.id);
    state.order.push(item.id);
  }
}

/**
 * @param {{order: string[], items: Map<string, any>}} state
 * @param {any} mutation
 * @returns {void}
 */
function applyStoredSvgMutation(state, mutation) {
  if (!mutation || typeof mutation !== "object") return;
  if (Array.isArray(mutation._children)) {
    mutation._children.forEach((/** @type {any} */ child) => {
      applyStoredSvgMutation(state, { ...child, tool: mutation.tool });
    });
    return;
  }
  if (mutation.type === "clear") {
    state.items.clear();
    state.order.length = 0;
    return;
  }
  if (mutation.type === "delete") {
    if (typeof mutation.id !== "string") return;
    state.items.delete(mutation.id);
    removeOrderedId(state.order, mutation.id);
    return;
  }
  if (mutation.type === "copy") {
    if (
      typeof mutation.id !== "string" ||
      typeof mutation.newid !== "string" ||
      !state.items.has(mutation.id)
    ) {
      return;
    }
    const source = structuredClone(state.items.get(mutation.id));
    source.id = mutation.newid;
    upsertItem(state, source, { appendOnExisting: true });
    return;
  }
  if (mutation.type === "child") {
    if (typeof mutation.parent !== "string") return;
    const parent = state.items.get(mutation.parent);
    if (!parent || parent.tool !== "Pencil") return;
    const nextChildren = Array.isArray(parent._children)
      ? parent._children.slice()
      : [];
    nextChildren.push({ x: mutation.x, y: mutation.y });
    parent._children = nextChildren;
    state.items.set(mutation.parent, parent);
    return;
  }
  if (mutation.type === "update") {
    if (typeof mutation.id !== "string") return;
    const existing = state.items.get(mutation.id);
    if (!existing) return;
    const patch = { ...mutation };
    delete patch.tool;
    delete patch.type;
    delete patch.clientMutationId;
    state.items.set(mutation.id, { ...existing, ...patch });
    return;
  }
  if (typeof mutation.id !== "string") return;
  upsertItem(state, mutation);
}

/**
 * @param {string} svg
 * @param {{readonly: boolean}} metadata
 * @param {number} toSeqInclusive
 * @param {Array<{mutation: any}>} mutations
 * @returns {string}
 */
function rewriteStoredSvg(svg, metadata, toSeqInclusive, mutations) {
  const envelope = parseStoredSvgEnvelope(svg);
  /** @type {{order: string[], items: Map<string, {entry?: any, item?: any, deleted?: boolean, dirty?: boolean}>}} */
  const state = {
    order: [],
    items: new Map(),
  };
  for (const itemEntry of parseStoredSvgItems(envelope.drawingAreaContent)) {
    const id = itemEntry.attributes.id;
    if (!id) continue;
    state.order.push(id);
    state.items.set(id, {
      entry: itemEntry,
      deleted: false,
      dirty: false,
    });
  }

  /**
   * @param {string} id
   * @returns {any | undefined}
   */
  const ensureParsedItem = (id) => {
    const record = state.items.get(id);
    if (!record || record.deleted) return undefined;
    if (record.item === undefined && record.entry) {
      record.item = parseStoredSvgItem(record.entry);
    }
    return record.item;
  };

  /**
   * @param {string} id
   * @param {any} item
   * @param {{appendOnExisting?: boolean}=} [options]
   * @returns {void}
   */
  const upsertParsedItem = (id, item, options) => {
    const appendOnExisting = options?.appendOnExisting === true;
    const record = state.items.get(id);
    const alreadyExists = !!record && record.deleted !== true;
    state.items.set(id, {
      item,
      dirty: true,
      deleted: false,
    });
    if (!alreadyExists) {
      state.order.push(id);
      return;
    }
    if (appendOnExisting) {
      removeOrderedId(state.order, id);
      state.order.push(id);
    }
  };

  /**
   * @param {any} mutation
   * @returns {void}
   */
  const applyRewriteMutation = (mutation) => {
    if (!mutation || typeof mutation !== "object") return;
    if (Array.isArray(mutation._children)) {
      mutation._children.forEach((/** @type {any} */ child) => {
        applyRewriteMutation({ ...child, tool: mutation.tool });
      });
      return;
    }
    if (mutation.type === "clear") {
      state.order.length = 0;
      state.items.forEach((record) => {
        record.deleted = true;
      });
      return;
    }
    if (mutation.type === "delete") {
      if (typeof mutation.id !== "string") return;
      const record = state.items.get(mutation.id);
      if (record) record.deleted = true;
      removeOrderedId(state.order, mutation.id);
      return;
    }
    if (mutation.type === "copy") {
      if (
        typeof mutation.id !== "string" ||
        typeof mutation.newid !== "string"
      ) {
        return;
      }
      const source = ensureParsedItem(mutation.id);
      if (!source) return;
      const copied = structuredClone(source);
      copied.id = mutation.newid;
      upsertParsedItem(mutation.newid, copied, { appendOnExisting: true });
      return;
    }
    if (mutation.type === "child") {
      if (typeof mutation.parent !== "string") return;
      const record = state.items.get(mutation.parent);
      if (
        record?.dirty !== true &&
        record?.entry?.tagName === "path" &&
        appendPencilChildToRawEntry(record.entry, mutation.x, mutation.y)
      ) {
        return;
      }
      const parent = ensureParsedItem(mutation.parent);
      if (!parent || parent.tool !== "Pencil") return;
      const nextChildren = Array.isArray(parent._children)
        ? parent._children.slice()
        : [];
      nextChildren.push({ x: mutation.x, y: mutation.y });
      upsertParsedItem(mutation.parent, {
        ...parent,
        _children: nextChildren,
      });
      return;
    }
    if (mutation.type === "update") {
      if (typeof mutation.id !== "string") return;
      const existing = ensureParsedItem(mutation.id);
      if (!existing) return;
      const patch = { ...mutation };
      delete patch.tool;
      delete patch.type;
      delete patch.clientMutationId;
      upsertParsedItem(mutation.id, { ...existing, ...patch });
      return;
    }
    if (typeof mutation.id !== "string") return;
    upsertParsedItem(mutation.id, structuredClone(mutation));
  };

  mutations.forEach((envelopeEntry) => {
    applyRewriteMutation(envelopeEntry?.mutation);
  });

  const prefix = updateRootMetadata(envelope.prefix, metadata, toSeqInclusive);
  return serializeStoredSvgEnvelope(
    prefix,
    state.order
      .filter((id) => {
        const record = state.items.get(id);
        return record && record.deleted !== true;
      })
      .map((id) => {
        const record = state.items.get(id);
        if (!record) return "";
        if (!record.dirty && record.entry) return record.entry.raw;
        return serializeStoredItemTag(record.item);
      }),
    envelope.suffix,
  );
}

export {
  applyStoredSvgMutation,
  parseStoredSvgState,
  rewriteStoredSvg,
  serializeStoredItemTag,
};
