/** @import { BoardMessage, IdentifiedBoardMessage, IncomingBroadcast, SequencedMutationBroadcast, ToolOwnedBatchMessage } from "../../types/app-runtime" */
import { isToolOwnedBatchTool } from "./message_tool_metadata.js";
import {
  hasMessageChildren,
  hasMessageId,
  hasMessageTool,
} from "./message_shape.js";

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
export function classifySequencedMutationSeq(messageSeq, authoritativeSeq) {
  const normalizedMessageSeq = normalizeSeq(messageSeq);
  const normalizedAuthoritativeSeq = normalizeSeq(authoritativeSeq);
  if (normalizedMessageSeq === 0) return "invalid";
  if (normalizedMessageSeq <= normalizedAuthoritativeSeq) return "stale";
  if (normalizedMessageSeq === normalizedAuthoritativeSeq + 1) return "next";
  return "gap";
}

/**
 * @param {{tool?: unknown, _children?: unknown}} message
 * @returns {message is ToolOwnedBatchMessage}
 */
export function isToolOwnedBatchMessage(message) {
  return (
    !!(hasMessageChildren(message) && hasMessageTool(message)) &&
    isToolOwnedBatchTool(message.tool)
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
 * @param {IncomingBroadcast | null | undefined} message
 * @param {boolean} awaitingBoardSnapshot
 * @returns {boolean}
 */
export function shouldBufferLiveMessage(message, awaitingBoardSnapshot) {
  if (awaitingBoardSnapshot !== true) return false;
  if (isSequencedMutationBroadcast(message || {})) return false;
  return true;
}

/**
 * @param {{seq?: unknown, mutation?: unknown} | null | undefined} message
 * @returns {message is SequencedMutationBroadcast}
 */
export function isSequencedMutationBroadcast(message) {
  return (
    !!message &&
    typeof message === "object" &&
    normalizeSeq(message.seq) > 0 &&
    typeof message.mutation === "object" &&
    message.mutation !== null
  );
}

/**
 * @param {IncomingBroadcast} message
 * @returns {BoardMessage}
 */
export function unwrapSequencedMutationBroadcast(message) {
  return isSequencedMutationBroadcast(message) ? message.mutation : message;
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
