(function (global) {
  "use strict";

  /** @typedef {{readonly: boolean, canWrite: boolean}} BoardState */

  /**
   * @param {unknown} value
   * @returns {BoardState}
   */
  function normalizeBoardState(value) {
    if (!value || typeof value !== "object") {
      return { readonly: false, canWrite: true };
    }
    var state = /** @type {{readonly?: boolean, canWrite?: boolean}} */ (value);
    return {
      readonly: state.readonly === true,
      canWrite: state.canWrite === true,
    };
  }

  /**
   * @param {string | null | undefined} text
   * @returns {BoardState}
   */
  function parseBoardStateText(text) {
    if (!text) return { readonly: false, canWrite: true };
    try {
      return normalizeBoardState(JSON.parse(text));
    } catch (error) {
      console.warn("Invalid embedded board state", error);
      return { readonly: false, canWrite: true };
    }
  }

  /**
   * @param {string} pathname
   * @returns {string}
   */
  function resolveBoardName(pathname) {
    var path = pathname.split("/");
    var encodedName = path[path.length - 1] || "";
    return decodeURIComponent(encodedName);
  }

  /**
   * @param {unknown} value
   * @returns {string[]}
   */
  function normalizeRecentBoards(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (name) {
      return typeof name === "string" && name !== "";
    });
  }

  /**
   * @param {unknown} storedBoards
   * @param {string} boardName
   * @returns {string[]}
   */
  function updateRecentBoards(storedBoards, boardName) {
    if (boardName.toLowerCase() === "anonymous") return normalizeRecentBoards(storedBoards);
    /** @type {{[name: string]: boolean}} */
    var seen = {};
    var recentBoards = normalizeRecentBoards(storedBoards).filter(function (name) {
      if (seen[name]) return false;
      seen[name] = true;
      return name !== boardName;
    });
    recentBoards.unshift(boardName);
    return recentBoards.slice(0, 20);
  }

  var exports = {
    normalizeBoardState: normalizeBoardState,
    parseBoardStateText: parseBoardStateText,
    resolveBoardName: resolveBoardName,
    normalizeRecentBoards: normalizeRecentBoards,
    updateRecentBoards: updateRecentBoards,
  };
  var root = /** @type {typeof globalThis & {WBOBoardState?: typeof exports}} */ (global);
  root.WBOBoardState = exports;

  if ("object" === typeof module && module.exports) {
    module.exports = exports;
  }
})(typeof globalThis === "object" ? globalThis : window);
