import { isValidBoardName } from "./board_name.js";
import { errorLogFields, logFrontendEvent } from "./frontend_logging.js";

/** @typedef {import("../../types/app-runtime").AppBoardState} BoardState */

export const DEFAULT_BOARD_STATE = /** @type {BoardState} */ (
  Object.freeze({
    readonly: false,
    canEdit: true,
    canClear: false,
    canBan: false,
    canGrantTemporaryModerator: false,
    canReport: true,
    canWrite: true,
  })
);

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
    return /** @type {T} */ (JSON.parse(text));
  } catch (error) {
    logFrontendEvent("warn", "boot.embedded_json_invalid", {
      elementId,
      ...errorLogFields(error),
    });
    return fallback;
  }
}

/**
 * @param {unknown} value
 * @returns {BoardState}
 */
export function normalizeBoardState(value) {
  if (!value || typeof value !== "object") {
    return DEFAULT_BOARD_STATE;
  }
  const state =
    /** @type {{readonly?: boolean, canEdit?: boolean, canClear?: boolean, canBan?: boolean, canGrantTemporaryModerator?: boolean, canReport?: boolean, canWrite?: boolean, accessRefreshAfterMs?: number, temporaryModeratorExpiresAt?: number, temporaryModeratorGrants?: unknown}} */ (
      value
    );
  const canEdit = state.canEdit === true || state.canWrite === true;
  const accessRefreshAfterMs =
    typeof state.accessRefreshAfterMs === "number" &&
    Number.isFinite(state.accessRefreshAfterMs) &&
    state.accessRefreshAfterMs >= 0
      ? Math.floor(state.accessRefreshAfterMs)
      : undefined;
  const temporaryModeratorExpiresAt =
    typeof state.temporaryModeratorExpiresAt === "number" &&
    Number.isFinite(state.temporaryModeratorExpiresAt) &&
    state.temporaryModeratorExpiresAt > 0
      ? Math.floor(state.temporaryModeratorExpiresAt)
      : undefined;
  const temporaryModeratorGrants = Array.isArray(state.temporaryModeratorGrants)
    ? state.temporaryModeratorGrants.filter(isTemporaryModeratorGrant)
    : undefined;
  return {
    readonly: state.readonly === true,
    canEdit,
    canClear: state.canClear === true,
    canBan: state.canBan === true,
    canGrantTemporaryModerator: state.canGrantTemporaryModerator === true,
    canReport: state.canReport !== false,
    canWrite: canEdit,
    ...(accessRefreshAfterMs === undefined ? {} : { accessRefreshAfterMs }),
    ...(temporaryModeratorExpiresAt === undefined
      ? {}
      : { temporaryModeratorExpiresAt }),
    ...(temporaryModeratorGrants === undefined
      ? {}
      : { temporaryModeratorGrants }),
  };
}

/** @param {unknown} value */
function isTemporaryModeratorGrant(value) {
  if (!value || typeof value !== "object") return false;
  const grant =
    /** @type {{id?: unknown, expiresAt?: unknown, user?: unknown}} */ (value);
  if (
    typeof grant.id !== "string" ||
    grant.id.length === 0 ||
    typeof grant.expiresAt !== "number" ||
    !Number.isFinite(grant.expiresAt) ||
    grant.expiresAt <= 0
  ) {
    return false;
  }
  if (!grant.user || typeof grant.user !== "object") return false;
  const user =
    /** @type {{socketId?: unknown, userId?: unknown, name?: unknown}} */ (
      grant.user
    );
  return (
    typeof user.socketId === "string" &&
    typeof user.userId === "string" &&
    typeof user.name === "string"
  );
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
  /** @type {Set<string>} */
  const seen = new Set();
  const recentBoards = normalizeRecentBoards(storedBoards).filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
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
