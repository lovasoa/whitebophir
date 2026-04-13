(function (global) {
  "use strict";

  /** @typedef {{readonly: boolean, canWrite: boolean}} BoardState */

  /**
   * @param {string} toolName
   * @param {string[]} blockedTools
   * @returns {boolean}
   */
  function isBlockedToolName(toolName, blockedTools) {
    if (toolName.includes(",")) {
      throw new Error("Tool Names must not contain a comma");
    }
    return blockedTools.includes(toolName);
  }

  /**
   * @param {string} toolName
   * @param {BoardState} boardState
   * @param {Set<string>} readOnlyToolNames
   * @returns {boolean}
   */
  function shouldDisplayTool(toolName, boardState, readOnlyToolNames) {
    return (
      !boardState.readonly ||
      boardState.canWrite ||
      readOnlyToolNames.has(toolName)
    );
  }

  /**
   * @template T
   * @param {{[name: string]: T[]}} pendingMessages
   * @param {string} toolName
   * @returns {T[]}
   */
  function drainPendingMessages(pendingMessages, toolName) {
    var pending = pendingMessages[toolName];
    if (!pending) return [];
    delete pendingMessages[toolName];
    return pending;
  }

  var exports = {
    isBlockedToolName: isBlockedToolName,
    shouldDisplayTool: shouldDisplayTool,
    drainPendingMessages: drainPendingMessages,
  };
  var root = /** @type {typeof globalThis & {WBOBoardTools?: typeof exports}} */ (global);
  root.WBOBoardTools = exports;

  if ("object" === typeof module && module.exports) {
    module.exports = exports;
  }
})(typeof globalThis === "object" ? globalThis : window);
