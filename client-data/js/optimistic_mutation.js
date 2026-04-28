import { MutationType } from "./message_tool_metadata.js";

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
  if (!("type" in message)) return [];
  switch (message.type) {
    case MutationType.COPY:
      return uniqueIds([message.newid]);
    case MutationType.APPEND:
      return uniqueIds([message.parent]);
    case MutationType.CLEAR:
      return [];
    default:
      return "id" in message ? uniqueIds([message.id]) : [];
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
  if (!("type" in message)) return [];
  switch (message.type) {
    case MutationType.COPY:
    case MutationType.DELETE:
    case MutationType.UPDATE:
      return "id" in message ? uniqueIds([message.id]) : [];
    case MutationType.APPEND:
      return uniqueIds([message.parent]);
    default:
      return [];
  }
}
