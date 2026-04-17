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
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
}

/**
 * @param {unknown} messageSeq
 * @param {unknown} authoritativeSeq
 * @returns {"invalid" | "stale" | "next" | "gap"}
 */
export function classifyPersistentEnvelopeSeq(messageSeq, authoritativeSeq) {
  const normalizedMessageSeq = normalizeSeq(messageSeq);
  const normalizedAuthoritativeSeq = normalizeSeq(authoritativeSeq);
  if (normalizedMessageSeq === 0) return "invalid";
  if (normalizedMessageSeq <= normalizedAuthoritativeSeq) return "stale";
  if (normalizedMessageSeq === normalizedAuthoritativeSeq + 1) return "next";
  return "gap";
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
 * @param {{tool?: unknown, _children?: unknown, seq?: unknown, mutation?: unknown, type?: unknown, [key: string]: unknown} | null | undefined} message
 * @param {boolean} awaitingBoardSnapshot
 * @returns {boolean}
 */
export function shouldBufferLiveMessage(message, awaitingBoardSnapshot) {
  if (awaitingBoardSnapshot !== true) return false;
  if (isSyncReplayControlMessage(message || {})) return false;
  if (isPersistentEnvelope(message || {})) return false;
  return !isSnapshotMessage(message || {});
}

/**
 * @param {{type?: unknown, [key: string]: unknown} | null | undefined} message
 * @returns {boolean}
 */
export function isSyncReplayControlMessage(message) {
  return (
    !!message &&
    typeof message === "object" &&
    typeof message.type === "string" &&
    [
      "sync_replay_start",
      "sync_replay_end",
      "resync_required",
      "mutation_rejected",
    ].includes(message.type)
  );
}

/**
 * @param {{seq?: unknown, mutation?: unknown} | null | undefined} message
 * @returns {boolean}
 */
export function isPersistentEnvelope(message) {
  return (
    !!message &&
    typeof message === "object" &&
    normalizeSeq(message.seq) > 0 &&
    typeof message.mutation === "object" &&
    message.mutation !== null
  );
}

/**
 * @param {unknown} message
 * @returns {unknown}
 */
export function unwrapReplayMessage(message) {
  const replayMessage = /** @type {{mutation?: unknown}} */ (message);
  return isPersistentEnvelope(replayMessage) ? replayMessage.mutation : message;
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

/**
 * @template {{seq?: unknown}} T
 * @param {T[]} messages
 * @param {unknown} replayedToSeq
 * @returns {T[]}
 */
export function filterBufferedMessagesAfterSeqReplay(messages, replayedToSeq) {
  const normalizedReplaySeq = normalizeSeq(replayedToSeq);
  return messages.filter((message) => {
    const messageSeq = normalizeSeq(message && message.seq);
    return messageSeq === 0 || messageSeq > normalizedReplaySeq;
  });
}

const boardMessageReplay = {
  classifyPersistentEnvelopeSeq,
  TOOL_OWNED_BATCH_TOOLS,
  filterBufferedMessagesAfterSeqReplay,
  filterBufferedMessagesAfterSnapshot,
  isPersistentEnvelope,
  isSnapshotMessage,
  isSyncReplayControlMessage,
  isToolOwnedBatchMessage,
  normalizeRevision,
  normalizeSeq,
  prepareReplayChild,
  shouldBufferLiveMessage,
  shouldReplayChildrenIndividually,
  unwrapReplayMessage,
};
export default boardMessageReplay;
