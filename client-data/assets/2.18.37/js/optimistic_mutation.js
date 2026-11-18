import { MutationType } from "./message_tool_metadata.js";

/** @import { BoardMessage, ToolMessageFields, ToolOwnedChildMessage } from "../../types/app-runtime" */
/** @typedef {BoardMessage | (ToolOwnedChildMessage & ToolMessageFields)} OptimisticMessage */

/**
 * @param {Set<string>} ids
 * @param {OptimisticMessage} message
 * @returns {void}
 */
function addOptimisticAffectedIds(ids, message) {
  if ("_children" in message) {
    for (const child of message._children) {
      addOptimisticAffectedIds(ids, {
        ...child,
        tool: message.tool,
      });
    }
    return;
  }
  switch (message.type) {
    case MutationType.COPY:
      ids.add(message.newid);
      return;
    case MutationType.APPEND:
      ids.add(message.parent);
      return;
    case MutationType.CLEAR:
      return;
    default:
      if ("id" in message) ids.add(message.id);
  }
}

/**
 * @param {Set<string>} ids
 * @param {OptimisticMessage} message
 * @returns {void}
 */
function addOptimisticDependencyIds(ids, message) {
  if ("_children" in message) {
    for (const child of message._children) {
      addOptimisticDependencyIds(ids, {
        ...child,
        tool: message.tool,
      });
    }
    return;
  }
  switch (message.type) {
    case MutationType.COPY:
    case MutationType.DELETE:
    case MutationType.UPDATE:
      if ("id" in message) ids.add(message.id);
      return;
    case MutationType.APPEND:
      ids.add(message.parent);
  }
}

/**
 * @param {OptimisticMessage} message
 * @returns {Set<string>}
 */
export function collectOptimisticAffectedIds(message) {
  const ids = new Set();
  addOptimisticAffectedIds(ids, message);
  return ids;
}

/**
 * @param {OptimisticMessage} message
 * @returns {Set<string>}
 */
export function collectOptimisticDependencyIds(message) {
  const ids = new Set();
  addOptimisticDependencyIds(ids, message);
  return ids;
}
