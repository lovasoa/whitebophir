/** @import { AuthoritativeReplayBatch, BoardMessage, IncomingBroadcast, SequencedMutationBroadcast } from "../../types/app-runtime" */

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
