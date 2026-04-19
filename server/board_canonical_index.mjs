import {
  cloneCanonicalItem,
  effectiveChildCount,
} from "./canonical_board_items.mjs";

/**
 * @param {any} bounds
 * @returns {any}
 */
function cloneBounds(bounds) {
  return bounds
    ? {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      }
    : null;
}

/**
 * @param {{itemsById: Map<string, any>}} state
 * @param {string} id
 * @returns {any}
 */
function getCanonicalItem(state, id) {
  const item = state.itemsById.get(id);
  return item && item.deleted !== true ? item : undefined;
}

/**
 * @param {{dirtyCreatedIds: Set<string>}} state
 * @param {string} id
 * @param {any} item
 * @returns {void}
 */
function syncDirtyCreatedItem(state, id, item) {
  if (
    item &&
    item.deleted !== true &&
    item.dirty === true &&
    item.createdAfterPersistedSeq === true
  ) {
    state.dirtyCreatedIds.add(id);
  } else {
    state.dirtyCreatedIds.delete(id);
  }
}

/**
 * @param {{itemsById: Map<string, any>, dirtyCreatedIds: Set<string>}} state
 * @returns {void}
 */
function rebuildDirtyCreatedItems(state) {
  state.dirtyCreatedIds = new Set();
  for (const [id, item] of state.itemsById.entries()) {
    syncDirtyCreatedItem(state, id, item);
  }
}

/**
 * @param {{itemsById: Map<string, any>}} state
 * @returns {number}
 */
function authoritativeItemCount(state) {
  return [...state.itemsById.values()].filter((item) => item.deleted !== true)
    .length;
}

/**
 * @param {{
 *   itemsById: Map<string, any>,
 *   paintOrder: string[],
 *   dirtyCreatedIds: Set<string>,
 *   nextPaintOrder: number,
 * }} state
 * @param {any} item
 * @returns {void}
 */
function upsertCanonicalItem(state, item) {
  if (!item || typeof item.id !== "string") return;
  const hadItem = state.itemsById.has(item.id);
  state.itemsById.set(item.id, item);
  if (!hadItem) {
    state.paintOrder.push(item.id);
  }
  syncDirtyCreatedItem(state, item.id, item);
  state.nextPaintOrder = Math.max(state.nextPaintOrder, item.paintOrder + 1);
}

/**
 * @param {{itemsById: Map<string, any>, dirtyCreatedIds: Set<string>}} state
 * @param {string} id
 * @returns {void}
 */
function removeCanonicalItem(state, id) {
  const existing = state.itemsById.get(id);
  if (!existing) return;
  const next = {
    ...existing,
    deleted: true,
    dirty: true,
  };
  state.itemsById.set(id, next);
  syncDirtyCreatedItem(state, id, next);
}

/**
 * @param {{
 *   itemsById: Map<string, any>,
 *   paintOrder: string[],
 *   nextPaintOrder: number,
 *   dirtyCreatedIds: Set<string>,
 * }} state
 * @param {Map<string, any>} [persistedSnapshot]
 * @param {Set<string>} [persistedIds]
 * @returns {{paintOrder: string[], nextPaintOrder: number, dirtyCreatedIds: Set<string>}}
 */
function finalizePersistedCanonicalItems(
  state,
  persistedSnapshot = state.itemsById,
  persistedIds = new Set(persistedSnapshot.keys()),
) {
  for (const [id, item] of state.itemsById.entries()) {
    const persistedItem = persistedSnapshot.get(id);
    if (!persistedItem) continue;
    if (persistedItem !== item) {
      if (persistedItem.deleted === true) continue;
      if (!persistedIds.has(id)) continue;
      item.createdAfterPersistedSeq = false;
      delete item.copySource;
      if (
        item.payload?.kind === "children" &&
        persistedItem.payload?.kind === "children"
      ) {
        item.payload.persistedChildCount = effectiveChildCount(persistedItem);
        item.payload.appendedChildren = (
          item.payload.appendedChildren || []
        ).slice((persistedItem.payload.appendedChildren || []).length);
      }
      state.itemsById.set(id, item);
      continue;
    }
    if (item.deleted === true) {
      state.itemsById.delete(id);
      continue;
    }
    if (!persistedIds.has(id)) continue;
    const next = cloneCanonicalItem(item);
    next.dirty = false;
    next.createdAfterPersistedSeq = false;
    if (next.payload?.kind === "children") {
      next.payload.persistedChildCount = effectiveChildCount(next);
      next.payload.appendedChildren = [];
    } else if (next.payload?.kind === "text") {
      delete next.payload.modifiedText;
      delete next.copySource;
    }
    if (next.copySource && next.payload?.kind !== "text") {
      delete next.copySource;
    }
    state.itemsById.set(id, next);
  }
  const paintOrder = state.paintOrder.filter((id) => state.itemsById.has(id));
  const nextPaintOrder = paintOrder.reduce((max, id) => {
    const item = state.itemsById.get(id);
    return item ? Math.max(max, item.paintOrder + 1) : max;
  }, 0);
  state.paintOrder = paintOrder;
  state.nextPaintOrder = nextPaintOrder;
  rebuildDirtyCreatedItems(state);
  return {
    paintOrder: state.paintOrder,
    nextPaintOrder: state.nextPaintOrder,
    dirtyCreatedIds: state.dirtyCreatedIds,
  };
}

export {
  authoritativeItemCount,
  cloneBounds,
  finalizePersistedCanonicalItems,
  getCanonicalItem,
  rebuildDirtyCreatedItems,
  removeCanonicalItem,
  syncDirtyCreatedItem,
  upsertCanonicalItem,
};
