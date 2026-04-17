import {
  parseStoredSvgEnvelope,
  parseStoredSvgItems,
  serializeStoredSvgEnvelope,
  updateRootMetadata,
} from "./svg_envelope.mjs";

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

/**
 * @param {any} item
 * @returns {string}
 */
function encodeStoredItem(item) {
  return encodeURIComponent(JSON.stringify(item));
}

/**
 * @param {string} value
 * @returns {any}
 */
function decodeStoredItem(value) {
  return JSON.parse(decodeURIComponent(value));
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
 * @param {any} item
 * @returns {string}
 */
function serializeStoredItemTag(item) {
  const tool = item && typeof item.tool === "string" ? item.tool : "Unknown";
  const id = item && typeof item.id === "string" ? item.id : "";
  return (
    `<g id="${escapeHtml(id)}" data-wbo-tool="${escapeHtml(tool)}"` +
    ` data-wbo-item="${escapeHtml(encodeStoredItem(item))}"` +
    `${renderTransformAttribute(item && item.transform)}></g>`
  );
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
    const id = itemEntry.attributes.id;
    const encodedItem = itemEntry.attributes["data-wbo-item"];
    if (!id || !encodedItem) continue;
    const item = decodeStoredItem(encodedItem);
    if (!item.transform) {
      const parsedTransform = parseTransformAttribute(
        itemEntry.attributes.transform,
      );
      if (parsedTransform) item.transform = parsedTransform;
    }
    item.id = id;
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
