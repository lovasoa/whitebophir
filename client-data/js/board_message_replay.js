/** @type {{[toolName: string]: true}} */
var TOOL_OWNED_BATCH_TOOLS = {
  Hand: true,
};

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeRevision(value) {
  var revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

/**
 * @param {{_children?: unknown}} message
 * @returns {boolean}
 */
function hasArrayChildren(message) {
  return !!(message && Array.isArray(message._children));
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {boolean}
 */
function isSnapshotMessage(message) {
  return hasArrayChildren(message) && !message.tool;
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {boolean}
 */
function isToolOwnedBatchMessage(message) {
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
function shouldReplayChildrenIndividually(message) {
  return hasArrayChildren(message) && !isToolOwnedBatchMessage(message);
}

/**
 * @template T
 * @param {{id?: unknown, tool?: unknown, _children?: unknown}} parent
 * @param {T} child
 * @param {(parent: any, child: T) => T} normalizeChildMessage
 * @returns {T}
 */
function prepareReplayChild(parent, child, normalizeChildMessage) {
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
function shouldBufferLiveMessage(message, awaitingBoardSnapshot) {
  return awaitingBoardSnapshot === true && !isSnapshotMessage(message || {});
}

/**
 * @template {{revision?: unknown}} T
 * @param {T[]} messages
 * @param {unknown} snapshotRevision
 * @returns {T[]}
 */
function filterBufferedMessagesAfterSnapshot(messages, snapshotRevision) {
  var normalizedSnapshotRevision = normalizeRevision(snapshotRevision);
  return messages.filter(function (message) {
    var messageRevision = normalizeRevision(message && message.revision);
    return (
      messageRevision === 0 || messageRevision > normalizedSnapshotRevision
    );
  });
}

var boardMessageReplay = {
  TOOL_OWNED_BATCH_TOOLS: TOOL_OWNED_BATCH_TOOLS,
  filterBufferedMessagesAfterSnapshot: filterBufferedMessagesAfterSnapshot,
  isSnapshotMessage: isSnapshotMessage,
  isToolOwnedBatchMessage: isToolOwnedBatchMessage,
  normalizeRevision: normalizeRevision,
  prepareReplayChild: prepareReplayChild,
  shouldBufferLiveMessage: shouldBufferLiveMessage,
  shouldReplayChildrenIndividually: shouldReplayChildrenIndividually,
};

var root = /** @type {typeof globalThis & {
    WBOBoardMessageReplay?: typeof boardMessageReplay,
  }} */ (typeof globalThis === "object" ? globalThis : window);

root.WBOBoardMessageReplay = boardMessageReplay;

if ("object" === typeof module && module.exports) {
  module.exports = boardMessageReplay;
}
