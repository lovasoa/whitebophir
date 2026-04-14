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
 * @param {{_children?: unknown}} message
 * @returns {boolean}
 */
export function hasArrayChildren(message) {
  return !!(message && Array.isArray(message._children));
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {boolean}
 */
export function isSnapshotMessage(message) {
  return hasArrayChildren(message) && !message.tool;
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {boolean}
 */
export function isToolOwnedBatchMessage(message) {
  return !!(
    hasArrayChildren(message) &&
    typeof message.tool === "string" &&
    TOOL_OWNED_BATCH_TOOLS[message.tool] === true
  );
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {boolean}
 */
export function shouldReplayChildrenIndividually(message) {
  return hasArrayChildren(message) && !isToolOwnedBatchMessage(message);
}

/**
 * @template T
 * @param {{id?: unknown, tool?: unknown, _children?: unknown}} parent
 * @param {T} child
 * @param {(parent: any, child: T) => T} normalizeChildMessage
 * @returns {T}
 */
export function prepareReplayChild(parent, child, normalizeChildMessage) {
  if (parent && typeof parent.id === "string" && parent.id !== "") {
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
    const messageRevision = normalizeRevision(message?.revision);
    return (
      messageRevision === 0 || messageRevision > normalizedSnapshotRevision
    );
  });
}
