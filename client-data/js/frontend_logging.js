const FRONTEND_LOG_PREFIX = "[wbo]";

/**
 * @returns {import("../../types/app-runtime").AppToolsState | null}
 */
function getRuntimeTools() {
  if (typeof window === "undefined") return null;
  const tools = /** @type {unknown} */ (window.Tools);
  if (!tools || typeof tools !== "object") return null;
  return /** @type {import("../../types/app-runtime").AppToolsState} */ (tools);
}

/**
 * @param {unknown} error
 * @returns {{errorName?: string, errorMessage: string}}
 */
export function errorLogFields(error) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return {
    errorMessage: String(error),
  };
}

/**
 * @param {{[key: string]: unknown}=} [fields]
 * @returns {{[key: string]: unknown}}
 */
export function frontendLogFields(fields) {
  const tools = getRuntimeTools();
  return {
    board: typeof tools?.boardName === "string" ? tools.boardName : null,
    socketId: tools?.socket?.id || null,
    authoritativeSeq:
      typeof tools?.authoritativeSeq === "number"
        ? tools.authoritativeSeq
        : null,
    connectionState:
      typeof tools?.connectionState === "string" ? tools.connectionState : null,
    pendingProtectedWrites: Array.isArray(tools?.turnstilePendingWrites)
      ? tools.turnstilePendingWrites.length
      : null,
    turnstilePending:
      typeof tools?.turnstilePending === "boolean"
        ? tools.turnstilePending
        : null,
    turnstileWidgetId:
      typeof tools?.turnstileWidgetId === "string"
        ? tools.turnstileWidgetId
        : null,
    ...(fields || {}),
  };
}

/**
 * @param {"log" | "warn" | "error"} level
 * @param {string} event
 * @param {{[key: string]: unknown}=} [fields]
 * @returns {void}
 */
export function logFrontendEvent(level, event, fields) {
  console[level](FRONTEND_LOG_PREFIX, event, frontendLogFields(fields));
}
