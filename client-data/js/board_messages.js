(function (global) {
  "use strict";

  /** @typedef {{tool?: string, id?: string, type?: string, parent?: string, _children?: unknown}} BoardMessage */
  /** @typedef {{[toolName: string]: BoardMessage[]}} PendingMessages */

  var BATCH_SIZE = 1024;

  /**
   * @template T
   * @param {(value: T) => void | Promise<void>} fn
   * @param {T[]} args
   * @param {number} [index]
   * @returns {Promise<void>}
   */
  function batchCall(fn, args, index) {
    index = (index || 0) | 0;
    if (index >= args.length) {
      return Promise.resolve();
    }
    var batch = args.slice(index, index + BATCH_SIZE);
    return Promise.all(batch.map(fn))
      .then(function () {
        return new Promise(requestAnimationFrame);
      })
      .then(function () {
        return batchCall(fn, args, index + BATCH_SIZE);
      });
  }

  /**
   * @param {PendingMessages} pendingMessages
   * @param {string} toolName
   * @param {BoardMessage} message
   * @returns {void}
   */
  function queuePendingMessage(pendingMessages, toolName, message) {
    if (!pendingMessages[toolName]) pendingMessages[toolName] = [message];
    else pendingMessages[toolName].push(message);
  }

  /**
   * @param {BoardMessage} message
   * @returns {message is BoardMessage & {_children: BoardMessage[]}}
   */
  function hasChildMessages(message) {
    return Array.isArray(message._children);
  }

  /**
   * @param {BoardMessage} parent
   * @param {BoardMessage} child
   * @returns {BoardMessage}
   */
  function normalizeChildMessage(parent, child) {
    child.parent = parent.id;
    child.tool = parent.tool;
    child.type = "child";
    return child;
  }

  var exports = {
    batchCall: batchCall,
    queuePendingMessage: queuePendingMessage,
    hasChildMessages: hasChildMessages,
    normalizeChildMessage: normalizeChildMessage,
  };
  var root = /** @type {typeof globalThis & {WBOBoardMessages?: typeof exports}} */ (global);
  root.WBOBoardMessages = exports;

  if ("object" === typeof module && module.exports) {
    module.exports = exports;
  }
})(typeof globalThis === "object" ? globalThis : window);
