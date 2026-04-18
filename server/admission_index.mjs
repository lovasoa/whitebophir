import MessageCommon from "../client-data/js/message_common.js";
import MessageToolMetadata from "../client-data/js/message_tool_metadata.js";
import { readConfiguration } from "./configuration.mjs";
import { normalizeStoredChildPoint } from "./message_validation.mjs";

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
 * @param {any} transform
 * @returns {any}
 */
function cloneTransform(transform) {
  return transform ? { ...transform } : undefined;
}

/**
 * @param {any} item
 * @returns {Array<{x: number, y: number}>}
 */
function readPencilPoints(item) {
  if (Array.isArray(item?._children)) return item._children;
  if (Array.isArray(item?.points)) return item.points;
  return [];
}

/**
 * @param {any} summary
 * @returns {any}
 */
function cloneSummary(summary) {
  if (!summary || typeof summary !== "object") return summary;
  /** @type {any} */
  const cloned = {
    ...summary,
    localBounds: cloneBounds(summary.localBounds),
  };
  if (summary.transform !== undefined) {
    cloned.transform = cloneTransform(summary.transform);
  } else {
    delete cloned.transform;
  }
  if (summary.tool === "Pencil") {
    delete cloned.points;
    delete cloned._children;
  }
  return cloned;
}

/**
 * @param {any} summaryOrItem
 * @param {number} fallbackPaintOrder
 * @returns {any}
 */
function normalizeSeedSummary(summaryOrItem, fallbackPaintOrder) {
  if (!summaryOrItem || typeof summaryOrItem !== "object") return null;
  const paintOrder =
    typeof summaryOrItem.paintOrder === "number"
      ? summaryOrItem.paintOrder
      : fallbackPaintOrder;
  const summarized =
    summaryOrItem.localBounds === undefined ||
    (summaryOrItem.tool === "Pencil" &&
      (Array.isArray(summaryOrItem.points) ||
        Array.isArray(summaryOrItem._children)))
      ? summarizeBoardItem(summaryOrItem, paintOrder)
      : cloneSummary(summaryOrItem);
  if (!summarized) return null;
  if (typeof summarized.paintOrder !== "number") {
    summarized.paintOrder = paintOrder;
  }
  if (summarized.localBounds === undefined) {
    summarized.localBounds = computeLocalBounds(summaryToItem(summarized));
  } else {
    summarized.localBounds = cloneBounds(summarized.localBounds);
  }
  return summarized;
}

/**
 * @param {any} summary
 * @returns {any}
 */
function summaryToItem(summary) {
  if (!summary || typeof summary !== "object") return null;
  switch (summary.tool) {
    case "Rectangle":
    case "Ellipse":
    case "Straight line":
      return {
        id: summary.id,
        tool: summary.tool,
        x: summary.x,
        y: summary.y,
        x2: summary.x2,
        y2: summary.y2,
        transform: cloneTransform(summary.transform),
      };
    case "Text":
      return {
        id: summary.id,
        tool: "Text",
        x: summary.x,
        y: summary.y,
        size: summary.size,
        txt: summary.txt,
        transform: cloneTransform(summary.transform),
      };
    case "Pencil":
      return {
        id: summary.id,
        tool: "Pencil",
        ...(summary.transform !== undefined
          ? { transform: cloneTransform(summary.transform) }
          : {}),
      };
    default:
      return null;
  }
}

/**
 * @param {any} item
 * @returns {any}
 */
function computeLocalBounds(item) {
  return MessageCommon.getLocalGeometryBounds(item);
}

/**
 * @param {any} item
 * @param {any} localBounds
 * @returns {boolean}
 */
function isTooLarge(item, localBounds) {
  return MessageCommon.isBoundsTooLarge(
    MessageCommon.applyTransformToBounds(localBounds, item?.transform),
  );
}

/**
 * @param {any} mutation
 * @param {number} paintOrder
 * @returns {any | null}
 */
function summarizeCreateMutation(mutation, paintOrder) {
  if (!mutation || typeof mutation.id !== "string") return null;
  switch (mutation.tool) {
    case "Rectangle":
    case "Ellipse":
    case "Straight line": {
      const item = {
        id: mutation.id,
        tool: mutation.tool,
        x: mutation.x,
        y: mutation.y,
        x2: mutation.x2,
        y2: mutation.y2,
        transform: cloneTransform(mutation.transform),
      };
      return {
        ...item,
        paintOrder,
        localBounds: computeLocalBounds(item),
      };
    }
    case "Text": {
      const item = {
        id: mutation.id,
        tool: "Text",
        x: mutation.x,
        y: mutation.y,
        size: mutation.size,
        txt: typeof mutation.txt === "string" ? mutation.txt : "",
        transform: cloneTransform(mutation.transform),
      };
      return {
        ...item,
        paintOrder,
        localBounds: computeLocalBounds(item),
      };
    }
    case "Pencil": {
      const item = {
        id: mutation.id,
        tool: "Pencil",
        _children: [],
        ...(mutation.transform !== undefined
          ? { transform: cloneTransform(mutation.transform) }
          : {}),
      };
      return {
        id: mutation.id,
        tool: "Pencil",
        childCount: 0,
        paintOrder,
        ...(mutation.transform !== undefined
          ? { transform: cloneTransform(mutation.transform) }
          : {}),
        localBounds: computeLocalBounds(item),
      };
    }
    default:
      return null;
  }
}

/**
 * @param {any} item
 * @param {number} paintOrder
 * @returns {any | null}
 */
function summarizeBoardItem(item, paintOrder) {
  if (!item || typeof item !== "object") return null;
  switch (item.tool) {
    case "Rectangle":
    case "Ellipse":
    case "Straight line":
      return summarizeCreateMutation(item, paintOrder);
    case "Text":
      return summarizeCreateMutation(
        {
          ...item,
          tool: "Text",
          type: "new",
        },
        paintOrder,
      );
    case "Pencil":
      return {
        id: item.id,
        tool: "Pencil",
        childCount: readPencilPoints(item).length,
        paintOrder,
        ...(item.transform !== undefined
          ? { transform: cloneTransform(item.transform) }
          : {}),
        localBounds: computeLocalBounds({
          id: item.id,
          tool: "Pencil",
          _children: readPencilPoints(item),
          ...(item.transform !== undefined
            ? { transform: cloneTransform(item.transform) }
            : {}),
        }),
      };
    default:
      return null;
  }
}

/**
 * @param {any} summary
 * @param {any} mutation
 * @returns {{summary: any, localBounds: any} | null}
 */
function buildUpdatedSummary(summary, mutation) {
  const item = summaryToItem(summary);
  if (!item) return null;
  const tool = mutation.tool || summary.tool;
  const updateData = MessageToolMetadata.getUpdatableFields(tool, mutation);
  const candidate = { ...item, ...updateData };
  const localBounds =
    summary.tool === "Pencil" && updateData.transform !== undefined
      ? cloneBounds(summary.localBounds)
      : computeLocalBounds(candidate);
  if (summary.tool === "Pencil") {
    return {
      summary: {
        ...summary,
        transform: cloneTransform(candidate.transform),
        localBounds: cloneBounds(localBounds),
      },
      localBounds,
    };
  }
  if (summary.tool === "Text") {
    return {
      summary: {
        ...summary,
        x: candidate.x,
        y: candidate.y,
        size: candidate.size,
        txt: candidate.txt,
        transform: cloneTransform(candidate.transform),
        localBounds: cloneBounds(localBounds),
      },
      localBounds,
    };
  }
  return {
    summary: {
      ...summary,
      x: candidate.x,
      y: candidate.y,
      x2: candidate.x2,
      y2: candidate.y2,
      transform: cloneTransform(candidate.transform),
      localBounds: cloneBounds(localBounds),
    },
    localBounds,
  };
}

/**
 * @param {any} sourceSummary
 * @param {string} newid
 * @param {number} paintOrder
 * @returns {any | null}
 */
function buildCopiedSummary(sourceSummary, newid, paintOrder) {
  const normalizedId = MessageCommon.normalizeId(newid);
  if (!normalizedId || !sourceSummary) return null;
  const copied = cloneSummary(sourceSummary);
  copied.id = normalizedId;
  copied.paintOrder = paintOrder;
  return copied;
}

/**
 * @param {any} summary
 * @param {any} mutation
 * @param {number} maxChildren
 * @returns {{summary: any, localBounds: any} | null | {ok: false, reason: string}}
 */
function buildChildSummary(summary, mutation, maxChildren) {
  if (!summary || summary.tool !== "Pencil") {
    return { ok: false, reason: "invalid parent for child" };
  }
  const normalizedChild = normalizeStoredChildPoint(mutation);
  if (!normalizedChild.ok) return normalizedChild;
  if (summary.childCount >= maxChildren) {
    return { ok: false, reason: "too many children" };
  }
  const nextBounds = MessageCommon.extendBoundsWithPoint(
    cloneBounds(summary.localBounds),
    normalizedChild.value.x,
    normalizedChild.value.y,
  );
  if (
    isTooLarge(
      {
        tool: "Pencil",
        transform: cloneTransform(summary.transform),
      },
      nextBounds,
    )
  ) {
    return { ok: false, reason: "shape too large" };
  }
  return {
    summary: {
      ...summary,
      childCount: summary.childCount + 1,
      localBounds: cloneBounds(nextBounds),
    },
    localBounds: nextBounds,
  };
}

/**
 * @param {unknown} result
 * @returns {result is {ok: false, reason: string}}
 */
function isFailureResult(result) {
  return (
    !!result &&
    typeof result === "object" &&
    "ok" in result &&
    /** @type {{ok?: unknown}} */ (result).ok === false
  );
}

/**
 * @param {{summaries: Map<string, any>, nextPaintOrder: number, maxChildren: number}} state
 * @param {any} mutation
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function canApplyMutation(state, mutation) {
  if (!mutation || typeof mutation !== "object") {
    return { ok: false, reason: "invalid mutation" };
  }
  if (Array.isArray(mutation._children)) {
    const shadow = {
      summaries: new Map(
        [...state.summaries.entries()].map(([id, summary]) => [
          id,
          cloneSummary(summary),
        ]),
      ),
      nextPaintOrder: state.nextPaintOrder,
      maxChildren: state.maxChildren,
    };
    for (const child of mutation._children) {
      const normalizedChild = { ...child, tool: mutation.tool };
      const result = canApplyMutation(shadow, normalizedChild);
      if (result.ok === false) return result;
      applyMutation(shadow, normalizedChild);
    }
    return { ok: true };
  }
  if (mutation.type === "clear" || mutation.type === "delete") {
    return { ok: true };
  }
  if (mutation.type === "copy") {
    return state.summaries.has(mutation.id)
      ? { ok: true }
      : { ok: false, reason: "copied object does not exist" };
  }
  if (mutation.type === "child") {
    const result = buildChildSummary(
      state.summaries.get(mutation.parent),
      mutation,
      state.maxChildren,
    );
    return isFailureResult(result) ? result : { ok: true };
  }
  if (mutation.type === "update") {
    const existing = state.summaries.get(mutation.id);
    if (!existing) return { ok: false, reason: "object not found" };
    const candidate = buildUpdatedSummary(existing, mutation);
    if (!candidate) return { ok: false, reason: "object not found" };
    return isTooLarge(summaryToItem(candidate.summary), candidate.localBounds)
      ? { ok: false, reason: "shape too large" }
      : { ok: true };
  }
  const created = summarizeCreateMutation(mutation, state.nextPaintOrder);
  if (!created) return { ok: false, reason: "invalid message" };
  return isTooLarge(summaryToItem(created), created.localBounds)
    ? { ok: false, reason: "shape too large" }
    : { ok: true };
}

/**
 * @param {{summaries: Map<string, any>, nextPaintOrder: number}} state
 * @param {any} mutation
 * @returns {void}
 */
function applyMutation(state, mutation) {
  if (!mutation || typeof mutation !== "object") return;
  if (Array.isArray(mutation._children)) {
    mutation._children.forEach((/** @type {any} */ child) => {
      applyMutation(state, { ...child, tool: mutation.tool });
    });
    return;
  }
  if (mutation.type === "clear") {
    state.summaries.clear();
    return;
  }
  if (mutation.type === "delete") {
    state.summaries.delete(mutation.id);
    return;
  }
  if (mutation.type === "copy") {
    const copied = buildCopiedSummary(
      state.summaries.get(mutation.id),
      mutation.newid,
      state.nextPaintOrder,
    );
    if (!copied) return;
    state.summaries.set(copied.id, copied);
    state.nextPaintOrder += 1;
    return;
  }
  if (mutation.type === "child") {
    const next = buildChildSummary(
      state.summaries.get(mutation.parent),
      mutation,
      Number.POSITIVE_INFINITY,
    );
    if (!next || isFailureResult(next)) return;
    state.summaries.set(mutation.parent, next.summary);
    return;
  }
  if (mutation.type === "update") {
    const updated = buildUpdatedSummary(
      state.summaries.get(mutation.id),
      mutation,
    );
    if (!updated) return;
    state.summaries.set(mutation.id, updated.summary);
    return;
  }
  const created = summarizeCreateMutation(mutation, state.nextPaintOrder);
  if (!created) return;
  state.summaries.set(created.id, created);
  state.nextPaintOrder += 1;
}

/**
 * @param {{loadItems?: (ids: Set<string>) => Promise<Map<string, any>>}=} options
 * @returns {{
 *   get: (id: string) => any,
 *   seed: (summaries: any[]) => void,
 *   ensureLoaded: (ids: Set<string>) => Promise<void>,
 *   canApplyLoaded: (mutation: any) => {ok: true} | {ok: false, reason: string},
 *   applyAccepted: (mutation: any) => void,
 * }}
 */
function createAdmissionIndex(options) {
  const loadItems = options?.loadItems;
  const state = {
    summaries: new Map(),
    nextPaintOrder: 0,
    maxChildren: readConfiguration().MAX_CHILDREN,
  };

  return {
    get(id) {
      const summary = state.summaries.get(id);
      return summary ? cloneSummary(summary) : undefined;
    },
    seed(summaries) {
      (summaries || []).forEach((summary) => {
        const normalized = normalizeSeedSummary(summary, state.nextPaintOrder);
        if (!normalized?.id) return;
        state.summaries.set(normalized.id, normalized);
        state.nextPaintOrder = Math.max(
          state.nextPaintOrder,
          normalized.paintOrder + 1,
        );
      });
    },
    async ensureLoaded(ids) {
      if (typeof loadItems !== "function" || !(ids instanceof Set)) return;
      const missing = new Set(
        [...ids].filter(
          (id) => typeof id === "string" && !state.summaries.has(id),
        ),
      );
      if (missing.size === 0) return;
      const loaded = await loadItems(missing);
      if (!(loaded instanceof Map)) return;
      this.seed([...loaded.values()]);
    },
    canApplyLoaded(mutation) {
      return canApplyMutation(state, mutation);
    },
    applyAccepted(mutation) {
      applyMutation(state, mutation);
    },
  };
}

export { createAdmissionIndex, summarizeBoardItem };
