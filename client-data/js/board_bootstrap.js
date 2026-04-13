(function (global) {
  "use strict";

  /**
   * @param {string} elementId
   * @returns {HTMLElement}
   */
  function getRequiredElement(elementId) {
    var element = document.getElementById(elementId);
    if (!element) {
      throw new Error("Missing required element: #" + elementId);
    }
    return element;
  }

  /**
   * @template T
   * @param {string} elementId
   * @param {T} fallback
   * @returns {T}
   */
  function parseEmbeddedJson(elementId, fallback) {
    var element = document.getElementById(elementId);
    if (!element || !element.text) return fallback;
    try {
      return /** @type {T} */ (JSON.parse(element.text));
    } catch (error) {
      console.warn("Invalid embedded JSON in #" + elementId, error);
      return fallback;
    }
  }

  var exports = {
    getRequiredElement: getRequiredElement,
    parseEmbeddedJson: parseEmbeddedJson,
  };
  var root = /** @type {typeof globalThis & {WBOBoardBootstrap?: typeof exports}} */ (global);
  root.WBOBoardBootstrap = exports;

  if ("object" === typeof module && module.exports) {
    module.exports = exports;
  }
})(typeof globalThis === "object" ? globalThis : window);
