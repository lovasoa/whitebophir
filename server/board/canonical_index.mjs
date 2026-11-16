import { cloneBounds, effectiveChildCount } from "./canonical_items.mjs";

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
 * @param {{itemsById: Map<string, any>, liveItemCount: number}} state
 * @returns {void}
 */
function rebuildLiveItemCount(state) {
  let liveItemCount = 0;
  for (const item of state.itemsById.values()) {
    if (item?.deleted !== true) liveItemCount += 1;
  }
  state.liveItemCount = liveItemCount;
}

/**
 * @param {{liveItemCount: number}} state
 * @returns {number}
 */
function authoritativeItemCount(state) {
  return state.liveItemCount;
}

/**
 * @param {{
 *   itemsById: Map<string, any>,
 *   paintOrder: string[],
 *   nextPaintOrder: number,
 *   liveItemCount: number,
 * }} state
 * @param {any} item
 * @returns {void}
 */
function upsertCanonicalItem(state, item) {
  if (!item || typeof item.id !== "string") return;
  const existing = state.itemsById.get(item.id);
  const hadItem = existing !== undefined;
  state.itemsById.set(item.id, item);
  if (!hadItem) {
    state.paintOrder.push(item.id);
  }
  const hadLiveItem = existing !== undefined && existing.deleted !== true;
  const hasLiveItem = item.deleted !== true;
  if (!hadLiveItem && hasLiveItem) state.liveItemCount += 1;
  if (hadLiveItem && !hasLiveItem) state.liveItemCount -= 1;
  state.nextPaintOrder = Math.max(state.nextPaintOrder, item.paintOrder + 1);
}

/**
 * @param {{itemsById: Map<string, any>, liveItemCount: number}} state
 * @param {string} id
 * @returns {void}
 */
function removeCanonicalItem(state, id) {
  const existing = state.itemsById.get(id);
  if (!existing || existing.deleted === true) return;
  const next = {
    ...existing,
    deleted: true,
    dirty: true,
  };
  state.itemsById.set(id, next);
  state.liveItemCount -= 1;
}

/**
 * @param {{
 *   itemsById: Map<string, any>,
 *   paintOrder: string[],
 *   nextPaintOrder: number,
 *   liveItemCount: number,
 *   trimPaintOrderIndex: number,
 * }} state
 * @param {Map<string, any>} [persistedSnapshot]
 * @param {Set<string>} [persistedIds]
 * @returns {void}
 */
function finalizePersistedCanonicalItems(
  state,
  persistedSnapshot = state.itemsById,
  persistedIds = new Set(persistedSnapshot.keys()),
) {
  let removedItems = false;
  for (const [id, item] of state.itemsById.entries()) {
    const persistedItem = persistedSnapshot.get(id);
    if (!persistedItem) continue;
    if (persistedItem !== item) {
      if (persistedItem.deleted === true) continue;
      if (!persistedIds.has(id)) continue;
      const next = { ...item };
      delete next.copySource;
      if (
        item.payload?.kind === "children" &&
        persistedItem.payload?.kind === "children"
      ) {
        next.payload = {
          ...item.payload,
          persistedChildCount: effectiveChildCount(persistedItem),
          appendedChildren: item.payload.appendedChildren.slice(
            persistedItem.payload.appendedChildren.length,
          ),
        };
      }
      state.itemsById.set(id, next);
      continue;
    }
    if (item.deleted === true) {
      state.itemsById.delete(id);
      removedItems = true;
      continue;
    }
    if (!persistedIds.has(id)) continue;
    if (item.dirty !== true && !item.copySource) continue;
    const next = { ...item, dirty: false };
    if (next.payload?.kind === "children") {
      next.payload = {
        kind: "children",
        persistedChildCount: effectiveChildCount(next),
        appendedChildren: [],
      };
    } else if (next.payload?.kind === "text") {
      next.payload = { kind: "text" };
    }
    delete next.copySource;
    state.itemsById.set(id, next);
  }
  if (removedItems) {
    const paintOrder = state.paintOrder.filter((id) => state.itemsById.has(id));
    const nextPaintOrder = paintOrder.reduce((max, id) => {
      const item = state.itemsById.get(id);
      return item ? Math.max(max, item.paintOrder + 1) : max;
    }, 0);
    state.paintOrder = paintOrder;
    state.nextPaintOrder = nextPaintOrder;
    rebuildLiveItemCount(state);
    state.trimPaintOrderIndex = 0;
  }
}

export {
  authoritativeItemCount,
  cloneBounds,
  finalizePersistedCanonicalItems,
  getCanonicalItem,
  rebuildLiveItemCount,
  removeCanonicalItem,
  upsertCanonicalItem,
};
