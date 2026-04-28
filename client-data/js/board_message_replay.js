/** @import { AuthoritativeReplayBatch, BoardMessage, IncomingBroadcast, PencilChildPoint, PencilReplayParent, SequencedMutationBroadcast, ToolOwnedBatchMessage } from "../../types/app-runtime" */
import { isToolOwnedBatchTool } from "./message_tool_metadata.js";
import {
  hasMessageChildren,
  hasMessageId,
  hasMessagePoint,
  hasMessageTool,
} from "./message_shape.js";
import { TOOL_CODE_BY_ID } from "../tools/tool-order.js";

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
}

/**
 * @param {number} messageSeq
 * @param {number} authoritativeSeq
 * @returns {"stale" | "next" | "gap"}
 */
export function classifySequencedMutationSeq(messageSeq, authoritativeSeq) {
  if (messageSeq <= authoritativeSeq) return "stale";
  if (messageSeq === authoritativeSeq + 1) return "next";
  return "gap";
}

/**
 * @param {unknown} message
 * @returns {message is ToolOwnedBatchMessage}
 */
export function isToolOwnedBatchMessage(message) {
  return (
    !!(hasMessageChildren(message) && hasMessageTool(message)) &&
    isToolOwnedBatchTool(message.tool)
  );
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
export function shouldReplayChildrenIndividually(message) {
  return hasMessageChildren(message) && !isToolOwnedBatchMessage(message);
}

/**
 * @param {unknown} message
 * @returns {message is PencilReplayParent}
 */
function isPencilReplayParent(message) {
  return (
    hasMessageId(message) &&
    hasMessageTool(message) &&
    message.tool === TOOL_CODE_BY_ID.pencil
  );
}

/**
 * @template TChild
 * @template TResult
 * @param {unknown} parent
 * @param {TChild} child
 * @param {(parent: PencilReplayParent, child: PencilChildPoint) => TResult} normalizeChildMessage
 * @returns {TResult | TChild}
 */
export function prepareReplayChild(parent, child, normalizeChildMessage) {
  if (isPencilReplayParent(parent) && hasMessagePoint(child)) {
    return normalizeChildMessage(parent, child);
  }
  return child;
}

/**
 * @param {IncomingBroadcast} message
 * @param {boolean} awaitingBoardSnapshot
 * @returns {boolean}
 */
export function shouldBufferLiveMessage(message, awaitingBoardSnapshot) {
  if (awaitingBoardSnapshot !== true) return false;
  if (isSequencedMutationBroadcast(message)) return false;
  return true;
}

/**
 * @param {IncomingBroadcast} message
 * @returns {message is SequencedMutationBroadcast}
 */
export function isSequencedMutationBroadcast(message) {
  return "mutation" in message;
}

/**
 * @param {IncomingBroadcast} message
 * @returns {message is AuthoritativeReplayBatch}
 */
export function isAuthoritativeReplayBatch(message) {
  return "fromSeq" in message;
}

/**
 * @param {Exclude<IncomingBroadcast, AuthoritativeReplayBatch>} message
 * @returns {BoardMessage}
 */
export function unwrapSequencedMutationBroadcast(message) {
  return isSequencedMutationBroadcast(message) ? message.mutation : message;
}

/**
 * @param {IncomingBroadcast[]} messages
 * @param {number} replayedToSeq
 * @returns {IncomingBroadcast[]}
 */
export function filterBufferedMessagesAfterSeqReplay(messages, replayedToSeq) {
  return messages.filter(
    (message) =>
      !isSequencedMutationBroadcast(message) || message.seq > replayedToSeq,
  );
}
