import MessageCommon from "../../client-data/js/message_common.js";
import {
  hasMessageChildren,
  hasMessageTool,
} from "../../client-data/js/message_shape.js";
import {
  getMutationType,
  getTool,
  getUpdatableFields,
  isShapeTool,
  MutationType,
} from "../../client-data/js/message_tool_metadata.js";
import { Eraser } from "../../client-data/tools/index.js";
import observability from "../observability/index.mjs";
import { getCanonicalItem, removeCanonicalItem } from "./canonical_index.mjs";
import {
  canonicalItemFromItem,
  cloneBounds,
  cloneCanonicalItem,
  copyCanonicalItem,
  currentText,
  effectiveChildCount,
  publicItemFromCanonicalItem,
} from "./canonical_items.mjs";
import { createDefaultSvgExtent } from "./svg_extent.mjs";

/** @import { BoardData, CanonicalBoardItem, Bounds, ValidationFailure, BoardMutationResult } from "./data.mjs" */
/** @import { BoardMessage, ToolOwnedChildMessage } from "../../types/app-runtime" */
/** @typedef {Pick<BoardData, "itemsById" | "nextPaintOrder" | "persistedItemIds" | "maxBoardSize" | "maxChildren">} MutationState */
/** @typedef {(state: MutationState, id: string) => CanonicalBoardItem | undefined} ReadItem */
/** @typedef {{ok: true, id: string, item: CanonicalBoardItem | undefined} | {ok: true, clear: true} | ValidationFailure} PreparedMutation */

const { tracing } = observability;
const STANDALONE_BOARD_BATCH_CHILD_COUNT_THRESHOLD = 64;

/** @type {ReadItem} */
function readItem(state, id) {
  return state.itemsById.get(id);
}

/** @param {string} id */
function eraserDeleteMutation(id) {
  return { tool: Eraser.id, type: MutationType.DELETE, id };
}

/**
 * Prepares a replacement without changing board state. A batch supplies its
 * own lookup so every operation sees previous operations in that transaction.
 * @param {MutationState} state
 * @param {BoardMessage | ToolOwnedChildMessage} message
 * @param {ReadItem} [read]
 * @returns {PreparedMutation}
 */
function prepareMutation(state, message, read = readItem) {
  const type = getMutationType(message);
  if (type === MutationType.CLEAR) return { ok: true, clear: true };
  const id =
    type === MutationType.APPEND
      ? "parent" in message
        ? message.parent
        : undefined
      : "id" in message
        ? message.id
        : undefined;
  if (typeof id !== "string" || !id) {
    return {
      ok: false,
      reason:
        type === MutationType.APPEND
          ? "invalid parent for child"
          : "missing id",
    };
  }
  const existing = read(state, id);
  const current = existing?.deleted === true ? undefined : existing;
  switch (type) {
    case MutationType.DELETE:
      return {
        ok: true,
        id,
        item: current ? { ...current, deleted: true, dirty: true } : existing,
      };
    case MutationType.UPDATE:
      if (!current) return { ok: false, reason: "object not found" };
      return prepareUpdate(state, current, message);
    case MutationType.COPY: {
      if (!("newid" in message) || typeof message.newid !== "string") {
        return { ok: false, reason: "missing id" };
      }
      if (!current)
        return { ok: false, reason: "copied object does not exist" };
      const newId = MessageCommon.normalizeId(message.newid);
      if (newId === null) return { ok: false, reason: "invalid id" };
      const item = copyCanonicalItem(
        current,
        newId,
        read(state, newId)?.paintOrder ?? state.nextPaintOrder,
      );
      const sourceId =
        current.copySource?.sourceId ??
        (state.persistedItemIds.has(current.id) ? current.id : undefined);
      if (
        sourceId &&
        (item.payload.kind === "children" ||
          (item.payload.kind === "text" && currentText(item) === undefined))
      ) {
        item.copySource = { sourceId };
      }
      return { ok: true, id: newId, item };
    }
    case MutationType.APPEND:
      return prepareAppend(state, current, message);
    default: {
      const tool = getTool("tool" in message ? message.tool : undefined);
      const candidate = {
        ...message,
        time: Date.now(),
        ...(type === MutationType.CREATE && tool?.storedTagName
          ? { tool: tool.toolId, type: tool.storedTagName }
          : {}),
      };
      const item = canonicalItemFromItem(
        candidate,
        existing?.paintOrder ?? state.nextPaintOrder,
        { persisted: false },
      );
      if (!item) return { ok: false, reason: "invalid message" };
      if (item.id !== id) return { ok: false, reason: "invalid id" };
      if (invalidBounds(state, item.bounds, item.transform))
        return { ok: false, reason: "shape too large" };
      return { ok: true, id, item };
    }
  }
}

/**
 * @param {MutationState} state
 * @param {Bounds | null} bounds
 * @param {unknown} transform
 */
function invalidBounds(state, bounds, transform) {
  return MessageCommon.isBoundsInvalid(
    MessageCommon.applyTransformToBounds(bounds, transform),
    state.maxBoardSize,
  );
}

/**
 * @param {MutationState} state
 * @param {CanonicalBoardItem} current
 * @param {BoardMessage | ToolOwnedChildMessage} message
 * @returns {PreparedMutation}
 */
function prepareUpdate(state, current, message) {
  const update = getUpdatableFields(
    "tool" in message ? message.tool : undefined,
    message,
  );
  const keys = Object.keys(update);
  const transformOnly =
    update.transform !== undefined && keys.every((key) => key === "transform");
  const candidate = transformOnly
    ? { transform: update.transform }
    : { ...publicItemFromCanonicalItem(current), ...update };
  const bounds =
    transformOnly ||
    (current.payload.kind === "children" && update.transform !== undefined)
      ? cloneBounds(current.bounds)
      : MessageCommon.getLocalGeometryBounds(candidate);
  const effectiveBounds = MessageCommon.applyTransformToBounds(
    bounds,
    candidate.transform,
  );
  const textOnly =
    current.payload.kind === "text" &&
    typeof update.txt === "string" &&
    keys.every((key) => key === "txt");
  if (
    textOnly
      ? MessageCommon.isBoundsTooLarge(effectiveBounds)
      : MessageCommon.isBoundsInvalid(effectiveBounds, state.maxBoardSize)
  ) {
    return { ok: false, reason: "shape too large" };
  }
  const item = transformOnly
    ? { ...current, attrs: { ...current.attrs } }
    : cloneCanonicalItem(current);
  for (const key of keys) {
    if (update[key] === undefined) continue;
    if (key === "transform") item.transform = structuredClone(update[key]);
    else item.attrs[key] = update[key];
  }
  if (item.payload.kind === "text" && typeof update.txt === "string") {
    item.payload.modifiedText = update.txt;
    item.textLength = update.txt.length;
  }
  item.bounds = cloneBounds(bounds);
  item.dirty = true;
  item.time = Date.now();
  item.attrs.time = item.time;
  return { ok: true, id: current.id, item };
}

/**
 * @param {MutationState} state
 * @param {CanonicalBoardItem | undefined} current
 * @param {BoardMessage | ToolOwnedChildMessage} message
 * @returns {PreparedMutation}
 */
function prepareAppend(state, current, message) {
  if (current?.payload.kind !== "children")
    return { ok: false, reason: "invalid parent for child" };
  const x = MessageCommon.normalizeBoardCoord(
    "x" in message ? message.x : undefined,
    state.maxBoardSize,
  );
  const y = MessageCommon.normalizeBoardCoord(
    "y" in message ? message.y : undefined,
    state.maxBoardSize,
  );
  if (x === null || y === null) return { ok: false, reason: "invalid coord" };
  if (effectiveChildCount(current) >= state.maxChildren)
    return { ok: false, reason: "too many children" };
  const bounds = MessageCommon.extendBoundsWithPoint(current.bounds, x, y);
  if (invalidBounds(state, bounds, current.transform))
    return { ok: false, reason: "shape too large" };
  const item = cloneCanonicalItem(current);
  item.payload.appendedChildren = (item.payload.appendedChildren || []).concat({
    x,
    y,
  });
  item.bounds = cloneBounds(bounds);
  item.dirty = true;
  item.time = Date.now();
  item.attrs.time = item.time;
  return { ok: true, id: current.id, item };
}

/** @param {BoardData} board */
function clearItems(board) {
  for (const [id, item] of board.itemsById) {
    board.itemsById.set(id, { ...item, deleted: true, dirty: true });
  }
  board.liveItemCount = 0;
  board.trimPaintOrderIndex = board.paintOrder.length;
  board.svgExtent = createDefaultSvgExtent();
}

/** @param {BoardData} board
 * @returns {BoardMutationResult}
 */
function commitMutation(board) {
  /** @type {import("../../types/server-runtime.d.ts").NormalizedMessageData[] | undefined} */
  let effects;
  while (
    board.liveItemCount > board.maxItemCount &&
    board.trimPaintOrderIndex < board.paintOrder.length
  ) {
    const id = board.paintOrder[board.trimPaintOrderIndex++];
    if (id === undefined || !getCanonicalItem(board, id)) continue;
    removeCanonicalItem(board, id);
    effects ??= [];
    effects.push(eraserDeleteMutation(id));
  }
  return effects ? { ok: true, effects } : { ok: true };
}

/**
 * @param {BoardData} board
 * @param {(BoardMessage | ToolOwnedChildMessage)[]} children
 * @param {BoardMessage} [parent]
 * @returns {BoardMutationResult}
 */
export function processMessageBatch(board, children, parent) {
  return tracing.withExpensiveActiveSpan(
    "board.process_message_batch",
    {
      attributes: {
        "wbo.board": board.name,
        "wbo.board.operation": "process_message_batch",
        "wbo.message.count": children.length,
        "wbo.message.tool": parent?.tool,
      },
      traceRoot:
        children.length >= STANDALONE_BOARD_BATCH_CHILD_COUNT_THRESHOLD,
    },
    () => {
      /** @type {Map<string, CanonicalBoardItem | undefined>} */
      const overlay = new Map();
      const state = {
        itemsById: board.itemsById,
        nextPaintOrder: board.nextPaintOrder,
        persistedItemIds: board.persistedItemIds,
        maxBoardSize: board.maxBoardSize,
        maxChildren: board.maxChildren,
      };
      let clear = false;
      /** @type {ReadItem} */
      const read = (_, id) =>
        overlay.has(id)
          ? overlay.get(id)
          : clear
            ? undefined
            : board.itemsById.get(id);
      for (const child of children) {
        const message =
          parent && !hasMessageTool(child)
            ? { ...child, tool: parent.tool }
            : child;
        const prepared = prepareMutation(state, message, read);
        if (!prepared.ok) return prepared;
        if ("clear" in prepared) {
          clear = true;
          overlay.clear();
        } else {
          overlay.set(prepared.id, prepared.item);
          if (prepared.item)
            state.nextPaintOrder = Math.max(
              state.nextPaintOrder,
              prepared.item.paintOrder + 1,
            );
        }
      }
      if (clear) clearItems(board);
      for (const item of overlay.values()) {
        if (item) board.upsertItem(item);
      }
      if (clear || overlay.size > 0) board.delaySave();
      return commitMutation(board);
    },
  );
}

/**
 * @param {BoardData} board
 * @param {BoardMessage} message
 * @returns {BoardMutationResult}
 */
export function processMessage(board, message) {
  if (hasMessageChildren(message))
    return processMessageBatch(board, message._children, message);
  const prepared = prepareMutation(board, message);
  if (!prepared.ok) {
    // A rejected shape expansion removes its empty seed, but a rejected batch
    // must leave every original item intact.
    if (
      getMutationType(message) === MutationType.UPDATE &&
      prepared.reason === "shape too large" &&
      "id" in message
    ) {
      const current = getCanonicalItem(board, message.id);
      const bounds = current?.bounds;
      if (
        current &&
        isShapeTool(message.tool) &&
        getTool(current.tool)?.id === getTool(message.tool)?.id &&
        !current.transform &&
        bounds &&
        bounds.minX === bounds.maxX &&
        bounds.minY === bounds.maxY
      ) {
        removeCanonicalItem(board, message.id);
        board.delaySave();
        return {
          ok: false,
          reason: "update rejected: shape too large",
          effects: [eraserDeleteMutation(message.id)],
        };
      }
      return { ok: false, reason: "update rejected: shape too large" };
    }
    return prepared;
  }
  if ("clear" in prepared) clearItems(board);
  else if (prepared.item) board.upsertItem(prepared.item);
  board.delaySave();
  return commitMutation(board);
}
