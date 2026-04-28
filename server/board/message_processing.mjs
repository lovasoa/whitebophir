import {
  hasMessageChildren,
  hasMessageId,
  hasMessageNewId,
  hasMessageTool,
} from "../../client-data/js/message_shape.js";
import {
  getMutationType,
  getUpdatableFields,
  MutationType,
} from "../../client-data/js/message_tool_metadata.js";
import { Eraser } from "../../client-data/tools/index.js";
import { getCanonicalItem, removeCanonicalItem } from "./canonical_index.mjs";
import { createDefaultSvgExtent } from "./svg_extent.mjs";
import observability from "../observability/index.mjs";

const { logger, tracing } = observability;

const STANDALONE_BOARD_BATCH_CHILD_COUNT_THRESHOLD = 64;

/** @import { BoardData } from "./data.mjs" */
/** @typedef {import("../../types/app-runtime.d.ts").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime.d.ts").ToolOwnedChildMessage} ToolOwnedChildMessage */
/** @typedef {{ok: false, reason: string}} ValidationFailure */
/** @typedef {{ok: true}} ValidationSuccess */
/** @typedef {ValidationSuccess | ValidationFailure} BoardMutationResult */

/**
 * @param {string} boardName
 * @param {string} operation
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardTraceAttributes(boardName, operation, extras) {
  return {
    "wbo.board": boardName,
    "wbo.board.operation": operation,
    ...extras,
  };
}

/** @param {string} id */
function eraserDeleteMutation(id) {
  return { tool: Eraser.id, type: MutationType.DELETE, id };
}

/**
 * @param {BoardData} board
 * @returns {import("./data.mjs").PendingMutationEffect[]}
 */
function trimOverflowItems(board) {
  /** @type {import("./data.mjs").PendingMutationEffect[]} */
  const followup = [];
  while (
    board.liveItemCount > board.maxItemCount &&
    board.trimPaintOrderIndex < board.paintOrder.length
  ) {
    const id = board.paintOrder[board.trimPaintOrderIndex];
    board.trimPaintOrderIndex += 1;
    if (id === undefined) continue;
    const item = board.itemsById.get(id);
    if (!item || item.deleted === true) continue;
    removeCanonicalItem(board, id);
    followup.push({
      mutation: eraserDeleteMutation(id),
    });
  }
  return followup;
}

/**
 * @param {BoardData} board
 * @returns {{ok: true}}
 */
function commitMutation(board) {
  board.pendingAcceptedMutationEffects.push(...trimOverflowItems(board));
  return { ok: true };
}

/**
 * @param {BoardData} board
 * @param {BoardMessage | ToolOwnedChildMessage} message
 * @returns {Set<string>}
 */
function collectReferencedMutationIds(board, message) {
  const ids = new Set();
  if (!message || typeof message !== "object") return ids;
  if (hasMessageChildren(message)) {
    message._children.forEach((child) => {
      collectReferencedMutationIds(board, child).forEach((id) => ids.add(id));
    });
    return ids;
  }
  if (hasMessageId(message)) {
    ids.add(message.id);
  }
  if ("parent" in message && typeof message.parent === "string") {
    ids.add(message.parent);
  }
  return ids;
}

/**
 * @param {BoardData} board
 * @param {BoardMessage | ToolOwnedChildMessage} message
 * @returns {Set<string>}
 */
function collectHydrationIds(board, message) {
  const ids = new Set();
  if (!message || typeof message !== "object") return ids;
  if (hasMessageChildren(message)) {
    message._children.forEach((child) => {
      collectHydrationIds(board, child).forEach((id) => ids.add(id));
    });
    return ids;
  }
  switch (getMutationType(message)) {
    case MutationType.UPDATE:
    case MutationType.COPY:
      if (hasMessageId(message)) ids.add(message.id);
      break;
    case MutationType.APPEND:
      if ("parent" in message && typeof message.parent === "string") {
        ids.add(message.parent);
      }
      break;
  }
  return ids;
}

/**
 * @param {BoardData} board
 * @param {import("../../types/server-runtime.d.ts").NormalizedMessageData} message
 * @returns {Promise<{ok: true, mutation: import("../../types/server-runtime.d.ts").NormalizedMessageData} | {ok: false, reason: string}>}
 */
async function preparePersistentMutation(board, message) {
  if (hasMessageChildren(message)) {
    return { ok: true, mutation: message };
  }
  switch (getMutationType(message)) {
    case MutationType.COPY:
      if (!hasMessageId(message) || !getCanonicalItem(board, message.id)) {
        return { ok: false, reason: "copied object does not exist" };
      }
      return { ok: true, mutation: message };
    case MutationType.APPEND:
      if (
        !("parent" in message) ||
        typeof message.parent !== "string" ||
        !getCanonicalItem(board, message.parent)
      ) {
        return { ok: false, reason: "invalid parent for child" };
      }
      return board.canAddChild(message.parent, message)
        ? { ok: true, mutation: message }
        : { ok: false, reason: "shape too large" };
    case MutationType.UPDATE:
      if (!hasMessageId(message) || !getCanonicalItem(board, message.id)) {
        return { ok: false, reason: "object not found" };
      }
      if (
        board.canUpdate(message.id, getUpdatableFields(message.tool, message))
      ) {
        return { ok: true, mutation: message };
      }
      if (board.shouldDeferSeedDropRejectionToMutationEngine(message)) {
        return { ok: true, mutation: message };
      }
      return { ok: false, reason: "shape too large" };
    default:
      return { ok: true, mutation: message };
  }
}

/**
 * @param {BoardData} board
 * @param {string} id
 * @param {any} data
 * @returns {boolean}
 */
function canStore(board, id, data) {
  return board.validateStoredCandidate(id, data).ok;
}

/**
 * @param {BoardData} board
 * @param {string} id
 * @param {any} updateData
 * @returns {boolean}
 */
function canUpdate(board, id, updateData) {
  const obj = getCanonicalItem(board, id);
  if (typeof obj !== "object") return false;

  const candidate = board.makeUpdateCandidate(id, obj, updateData);
  if (!candidate) return false;

  return !board.isUpdateCandidateTooLarge(obj, updateData, candidate);
}

/**
 * @param {BoardData} board
 * @param {string} parentId
 * @param {any} child
 * @returns {boolean}
 */
function canAddChild(board, parentId, child) {
  return board.makeAppendCandidate(parentId, child).ok;
}

/**
 * @param {BoardData} board
 * @param {string} id
 * @param {any} data
 * @returns {boolean}
 */
function canCopy(board, id, data) {
  const obj = getCanonicalItem(board, id);
  if (!obj) return false;
  return board.makeCopyCandidate(data.newid, obj).ok;
}

/**
 * @param {BoardData} board
 * @param {BoardMessage} message
 * @returns {boolean}
 */
function canProcessMessage(board, message) {
  const id = hasMessageId(message) ? message.id : "";
  switch (getMutationType(message)) {
    case MutationType.DELETE:
    case MutationType.CLEAR:
      return true;
    case MutationType.UPDATE:
      return id
        ? canUpdate(board, id, getUpdatableFields(message.tool, message))
        : false;
    case MutationType.COPY:
      return id ? canCopy(board, id, message) : false;
    case MutationType.APPEND:
      return "parent" in message && typeof message.parent === "string"
        ? canAddChild(board, message.parent, message)
        : false;
    default:
      return id ? canStore(board, id, message) : false;
  }
}

/** Process a batch of messages
 * @param {BoardData} board
 * @param {(BoardMessage | ToolOwnedChildMessage)[]} children array of messages to be delegated to the other methods
 * @param {BoardMessage} [parentMessage]
 * @returns {BoardMutationResult | ValidationFailure}
 */
function processMessageBatch(board, children, parentMessage) {
  return tracing.withExpensiveActiveSpan(
    "board.process_message_batch",
    {
      attributes: boardTraceAttributes(board.name, "process_message_batch", {
        "wbo.message.count": children.length,
        "wbo.message.tool": parentMessage?.tool,
      }),
      traceRoot:
        children.length >= STANDALONE_BOARD_BATCH_CHILD_COUNT_THRESHOLD,
    },
    () => {
      /** @type {BoardMessage[]} */
      const messages = children.map((childMessage) =>
        parentMessage && !hasMessageTool(childMessage)
          ? /** @type {BoardMessage} */ ({
              ...childMessage,
              tool: parentMessage.tool,
            })
          : /** @type {BoardMessage} */ (childMessage),
      );
      /** @type {Map<string, any | undefined>} */
      const overlay = new Map();
      let clearAll = false;

      /**
       * @param {string} id
       * @returns {any}
       */
      const readItem = (id) => {
        if (overlay.has(id)) return overlay.get(id);
        if (clearAll) return undefined;
        return getCanonicalItem(board, id);
      };

      for (const message of messages) {
        const id = hasMessageId(message) ? message.id : "";
        switch (getMutationType(message)) {
          case MutationType.CLEAR:
            clearAll = true;
            overlay.clear();
            break;
          case MutationType.DELETE:
            if (!id) return { ok: false, reason: "missing id" };
            overlay.set(id, undefined);
            break;
          case MutationType.UPDATE: {
            if (!id) return { ok: false, reason: "missing id" };
            const current = readItem(id);
            if (!current) return { ok: false, reason: "object not found" };
            const updateData = getUpdatableFields(message.tool, message);
            const candidate = board.makeUpdateCandidate(
              id,
              current,
              updateData,
            );
            if (!candidate) {
              return { ok: false, reason: "object not found" };
            }
            if (
              board.isUpdateCandidateTooLarge(current, updateData, candidate)
            ) {
              return { ok: false, reason: "shape too large" };
            }
            const next = board.applyUpdateToCanonicalItem(
              current,
              updateData,
              candidate.localBounds,
            );
            overlay.set(id, next);
            break;
          }
          case MutationType.COPY: {
            if (!id || !hasMessageNewId(message)) {
              return { ok: false, reason: "missing id" };
            }
            const current = readItem(id);
            if (!current) {
              return { ok: false, reason: "copied object does not exist" };
            }
            const existingTarget = readItem(message.newid);
            const validated = board.makeCopyCandidate(message.newid, current);
            if (!validated.ok) return validated;
            validated.value.paintOrder =
              existingTarget?.paintOrder ?? validated.value.paintOrder;
            overlay.set(message.newid, validated.value);
            break;
          }
          case MutationType.APPEND: {
            if (!("parent" in message) || typeof message.parent !== "string") {
              return { ok: false, reason: "invalid parent for child" };
            }
            const next = board.makeAppendCandidate(
              message.parent,
              message,
              readItem(message.parent),
            );
            if (!next.ok) return next;
            overlay.set(message.parent, next.value);
            break;
          }
          default: {
            if (!id) return { ok: false, reason: "missing id" };
            const validated = board.validateStoredCandidate(id, {
              ...message,
              time: Date.now(),
            });
            if (!validated.ok) return validated;
            const existing = readItem(id);
            const next = {
              ...validated.canonical,
              paintOrder: clearAll
                ? board.nextPaintOrder
                : (existing?.paintOrder ?? board.nextPaintOrder),
            };
            overlay.set(id, next);
            break;
          }
        }
      }

      if (clearAll) {
        for (const [id, item] of board.itemsById.entries()) {
          board.itemsById.set(id, {
            ...item,
            deleted: true,
            dirty: true,
          });
        }
        board.liveItemCount = 0;
        board.trimPaintOrderIndex = board.paintOrder.length;
        board.svgExtent = createDefaultSvgExtent();
      }
      for (const [id, item] of overlay.entries()) {
        if (item === undefined) {
          removeCanonicalItem(board, id);
        } else {
          board.upsertItem(item);
        }
      }
      if (clearAll || overlay.size > 0) board.delaySave();
      return board.commitMutation();
    },
  );
}

/** Process a single message
 * @param {BoardData} board
 * @param {BoardMessage} message instruction to apply to the board
 * @returns {BoardMutationResult | ValidationFailure}
 */
function processMessage(board, message) {
  board.pendingRejectedMutationEffects = [];
  board.pendingAcceptedMutationEffects = [];
  /** @type {BoardMutationResult | ValidationFailure} */
  let result;
  if (hasMessageChildren(message)) {
    result = board.processMessageBatch(message._children, message);
  } else {
    const id = hasMessageId(message) ? message.id : "";
    switch (getMutationType(message)) {
      case MutationType.DELETE:
        result = id ? board.delete(id) : { ok: false, reason: "missing id" };
        break;
      case MutationType.UPDATE:
        result = id
          ? board.update(id, message)
          : { ok: false, reason: "missing id" };
        break;
      case MutationType.COPY:
        result = id
          ? board.copy(id, message)
          : { ok: false, reason: "missing id" };
        break;
      case MutationType.APPEND: {
        if (!("parent" in message) || typeof message.parent !== "string") {
          result = { ok: false, reason: "invalid parent for child" };
          break;
        }
        // We don't need to store type, parent, and tool for each child. The
        // client rehydrates them from the parent.
        const { parent, type, tool, ...childData } = message;
        void type;
        void tool;
        result = board.addChild(parent, childData);
        break;
      }
      case MutationType.CLEAR:
        result = board.clear();
        break;
      default:
        if (id) {
          result = board.set(id, message);
          break;
        }
        logger.error("board.message_invalid", {
          message: message,
        });
        result = { ok: false, reason: "invalid message" };
        break;
    }
  }
  return result;
}

export {
  canAddChild,
  canCopy,
  canProcessMessage,
  canStore,
  canUpdate,
  collectHydrationIds,
  collectReferencedMutationIds,
  commitMutation,
  preparePersistentMutation,
  processMessage,
  processMessageBatch,
  trimOverflowItems,
};
