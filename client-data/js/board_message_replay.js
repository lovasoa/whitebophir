/** @typedef {import("../../types/app-runtime").IdentifiedBoardMessage} IdentifiedBoardMessage */
/** @typedef {import("../../types/app-runtime").ToolOwnedBatchMessage} ToolOwnedBatchMessage */
import {
  hasMessageChildren,
  hasMessageId,
  hasMessageTool,
} from "./message_shape.js";

/** @type {{[toolName: string]: true}} */
export const TOOL_OWNED_BATCH_TOOLS = {
  Hand: true,
};

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {boolean}
 */
export function isSnapshotMessage(message) {
  return hasMessageChildren(message) && !message.tool;
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {message is ToolOwnedBatchMessage}
 */
export function isToolOwnedBatchMessage(message) {
  return (
    !!(hasMessageChildren(message) && hasMessageTool(message)) &&
    TOOL_OWNED_BATCH_TOOLS[message.tool] === true
  );
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {boolean}
 */
export function shouldReplayChildrenIndividually(message) {
  return hasMessageChildren(message) && !isToolOwnedBatchMessage(message);
}

/**
 * @template T
 * @param {{id?: unknown, tool?: unknown, _children?: unknown}} parent
 * @param {T} child
 * @param {(parent: IdentifiedBoardMessage, child: T) => T} normalizeChildMessage
 * @returns {T}
 */
export function prepareReplayChild(parent, child, normalizeChildMessage) {
  if (parent && hasMessageId(parent)) {
    return normalizeChildMessage(parent, child);
  }
  return child;
}

/**
 * @param {{tool?: unknown, _children?: unknown} | null | undefined} message
 * @param {boolean} awaitingBoardSnapshot
 * @returns {boolean}
 */
export function shouldBufferLiveMessage(message, awaitingBoardSnapshot) {
  return awaitingBoardSnapshot === true && !isSnapshotMessage(message || {});
}

/**
 * @template {{revision?: unknown}} T
 * @param {T[]} messages
 * @param {unknown} snapshotRevision
 * @returns {T[]}
 */
export function filterBufferedMessagesAfterSnapshot(
  messages,
  snapshotRevision,
) {
  const normalizedSnapshotRevision = normalizeRevision(snapshotRevision);
  return messages.filter((message) => {
    const messageRevision = normalizeRevision(message && message.revision);
    return (
      messageRevision === 0 || messageRevision > normalizedSnapshotRevision
    );
  });
}

const boardMessageReplay = {
  TOOL_OWNED_BATCH_TOOLS,
  filterBufferedMessagesAfterSnapshot,
  isSnapshotMessage,
  isToolOwnedBatchMessage,
  normalizeRevision,
  prepareReplayChild,
  shouldBufferLiveMessage,
  shouldReplayChildrenIndividually,
};
export default boardMessageReplay;
