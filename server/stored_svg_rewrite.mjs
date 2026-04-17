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
  const state = parseStoredSvgState(svg);
  mutations.forEach((envelope) => {
    applyStoredSvgMutation(state, envelope?.mutation);
  });
  const prefix = updateRootMetadata(state.prefix, metadata, toSeqInclusive);
  return serializeStoredSvgEnvelope(
    prefix,
    state.order
      .filter((id) => state.items.has(id))
      .map((id) => serializeStoredItemTag(state.items.get(id))),
    state.suffix,
  );
}

export {
  applyStoredSvgMutation,
  parseStoredSvgState,
  rewriteStoredSvg,
  serializeStoredItemTag,
};
