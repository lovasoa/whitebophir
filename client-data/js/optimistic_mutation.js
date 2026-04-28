import { MutationType } from "./message_tool_metadata.js";

/** @import { BoardMessage, ToolMessageFields, ToolOwnedChildMessage } from "../../types/app-runtime" */
/** @typedef {BoardMessage | (ToolOwnedChildMessage & ToolMessageFields)} OptimisticMessage */

/**
 * @param {ReadonlyArray<string | undefined>} ids
 * @returns {string[]}
 */
function uniqueIds(ids) {
  const unique = new Set();
  for (const id of ids) {
    if (id) unique.add(id);
  }
  return [...unique];
}

/**
 * @param {OptimisticMessage} message
 * @returns {string[]}
 */
export function collectOptimisticAffectedIds(message) {
  if ("_children" in message) {
    return uniqueIds(
      message._children.flatMap((child) =>
        collectOptimisticAffectedIds({
          ...child,
          tool: message.tool,
        }),
      ),
    );
  }
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
  if ("_children" in message) {
    return uniqueIds(
      message._children.flatMap((child) =>
        collectOptimisticDependencyIds({
          ...child,
          tool: message.tool,
        }),
      ),
    );
  }
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
