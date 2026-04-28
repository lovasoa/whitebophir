import { getMutationType, MutationType } from "./message_tool_metadata.js";

/** @import { BoardMessage, ToolMessageFields, ToolOwnedChildMessage } from "../../types/app-runtime" */
/** @typedef {BoardMessage | (ToolOwnedChildMessage & ToolMessageFields)} OptimisticMessage */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function uniqueIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item))];
}

/**
 * @param {OptimisticMessage} message
 * @returns {string | undefined}
 */
function getMessageId(message) {
  return "id" in message ? message.id : undefined;
}

/**
 * @param {OptimisticMessage} message
 * @returns {string | undefined}
 */
function getMessageNewId(message) {
  return "newid" in message ? message.newid : undefined;
}

/**
 * @param {OptimisticMessage} message
 * @returns {string | undefined}
 */
function getMessageParent(message) {
  return "parent" in message ? message.parent : undefined;
}

/**
 * @param {OptimisticMessage} message
 * @returns {string[]}
 */
export function collectOptimisticAffectedIds(message) {
  if ("_children" in message && Array.isArray(message._children)) {
    return uniqueIds(
      message._children.flatMap((child) =>
        collectOptimisticAffectedIds({
          ...child,
          tool: message.tool,
        }),
      ),
    );
  }
  switch (getMutationType(message)) {
    case MutationType.COPY:
      return uniqueIds([getMessageNewId(message)]);
    case MutationType.APPEND:
      return uniqueIds([getMessageParent(message)]);
    case MutationType.CLEAR:
      return [];
    default:
      return uniqueIds([getMessageId(message)]);
  }
}

/**
 * @param {OptimisticMessage} message
 * @returns {string[]}
 */
export function collectOptimisticDependencyIds(message) {
  if ("_children" in message && Array.isArray(message._children)) {
    return uniqueIds(
      message._children.flatMap((child) =>
        collectOptimisticDependencyIds({
          ...child,
          tool: message.tool,
        }),
      ),
    );
  }
  switch (getMutationType(message)) {
    case MutationType.COPY:
    case MutationType.DELETE:
    case MutationType.UPDATE:
      return uniqueIds([getMessageId(message)]);
    case MutationType.APPEND:
      return uniqueIds([getMessageParent(message)]);
    default:
      return [];
  }
}
