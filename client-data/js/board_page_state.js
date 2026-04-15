import { isValidBoardName } from "./board_name.js";

/** @typedef {{readonly: boolean, canWrite: boolean}} BoardState */

/**
 * @param {string} elementId
 * @returns {HTMLElement}
 */
export function getRequiredElement(elementId) {
  const element = document.getElementById(elementId);
  if (!element) throw new Error(`Missing required element: #${elementId}`);
  return element;
}

/**
 * @template T
 * @param {string} elementId
 * @param {T} fallback
 * @returns {T}
 */
export function parseEmbeddedJson(elementId, fallback) {
  const element = document.getElementById(elementId);
  const text =
    element?.textContent ??
    /** @type {{text?: string} | null} */ (element)?.text;
  if (!text) return fallback;
  try {
    return /** @type {any} */ (JSON.parse(text));
  } catch (error) {
    console.warn(`Invalid embedded JSON in #${elementId}`, error);
    return fallback;
  }
}

/**
 * @param {string | null | undefined} text
 * @returns {BoardState}
 */
export function parseBoardStateText(text) {
  if (!text) return { readonly: false, canWrite: true };
  try {
    return normalizeBoardState(JSON.parse(text));
  } catch (error) {
    console.warn("Invalid embedded board state", error);
    return { readonly: false, canWrite: true };
  }
}

/**
 * @param {unknown} value
 * @returns {BoardState}
 */
export function normalizeBoardState(value) {
  if (!value || typeof value !== "object") {
    return { readonly: false, canWrite: true };
  }
  const state = /** @type {{readonly?: boolean, canWrite?: boolean}} */ (value);
  return {
    readonly: state.readonly === true,
    canWrite: state.canWrite === true,
  };
}

/**
 * @param {string} pathname
 * @returns {string}
 */
export function resolveBoardName(pathname) {
  const path = pathname.split("/");
  const encodedName = path[path.length - 1] || "";
  return decodeURIComponent(encodedName);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeRecentBoards(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (name) => typeof name === "string" && name !== "" && isValidBoardName(name),
  );
}

/**
 * @param {unknown} storedBoards
 * @param {string} boardName
 * @returns {string[]}
 */
export function updateRecentBoards(storedBoards, boardName) {
  if (boardName.toLowerCase() === "anonymous")
    return normalizeRecentBoards(storedBoards);
  /** @type {{[name: string]: boolean}} */
  const seen = {};
  const recentBoards = normalizeRecentBoards(storedBoards).filter((name) => {
    if (seen[name]) return false;
    seen[name] = true;
    return name !== boardName;
  });
  recentBoards.unshift(boardName);
  return recentBoards.slice(0, 20);
}

/**
 * @param {string} toolName
 * @param {string[]} blockedTools
 * @returns {boolean}
 */
export function isBlockedToolName(toolName, blockedTools) {
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
export function shouldDisplayTool(toolName, boardState, readOnlyToolNames) {
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
export function drainPendingMessages(pendingMessages, toolName) {
  const pending = pendingMessages[toolName];
  if (!pending) return [];
  delete pendingMessages[toolName];
  return pending;
}
