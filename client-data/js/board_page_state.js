/** @typedef {{readonly: boolean, canWrite: boolean}} BoardState */

/**
 * @param {string} elementId
 * @returns {HTMLElement}
 */
function getRequiredElement(elementId) {
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
function parseEmbeddedJson(elementId, fallback) {
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
 * @param {unknown} value
 * @returns {BoardState}
 */
function normalizeBoardState(value) {
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
function resolveBoardName(pathname) {
  const path = pathname.split("/");
  const encodedName = path[path.length - 1] || "";
  return decodeURIComponent(encodedName);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeRecentBoards(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((name) => typeof name === "string" && name !== "");
}

/**
 * @param {unknown} storedBoards
 * @param {string} boardName
 * @returns {string[]}
 */
function updateRecentBoards(storedBoards, boardName) {
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
  const pending = pendingMessages[toolName];
  if (!pending) return [];
  delete pendingMessages[toolName];
  return pending;
}

export const bootstrap = {
  getRequiredElement: getRequiredElement,
  parseEmbeddedJson: parseEmbeddedJson,
};

export const state = {
  parseBoardStateText: parseBoardStateText,
  normalizeBoardState: normalizeBoardState,
  resolveBoardName: resolveBoardName,
  normalizeRecentBoards: normalizeRecentBoards,
  updateRecentBoards: updateRecentBoards,
};

export const tools = {
  isBlockedToolName: isBlockedToolName,
  shouldDisplayTool: shouldDisplayTool,
  drainPendingMessages: drainPendingMessages,
};

const boardPageState = {
  bootstrap,
  state,
  tools,
};
export default boardPageState;
