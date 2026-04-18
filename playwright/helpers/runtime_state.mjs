/**
 * @param {{tool?: unknown, currentTool?: unknown} | null | undefined} state
 * @param {string} toolName
 * @returns {boolean}
 */
function hasStableActiveToolState(state, toolName) {
  return (
    !!state &&
    typeof state === "object" &&
    state.tool === toolName &&
    state.currentTool === toolName
  );
}

/**
 * @param {{
 *   bufferedWrites?: unknown,
 *   awaitingBoardSnapshot?: unknown,
 *   connectionState?: unknown,
 * } | null | undefined} state
 * @returns {boolean}
 */
function isBufferedWriteDrainComplete(state) {
  return (
    !!state &&
    typeof state === "object" &&
    state.bufferedWrites === 0 &&
    state.awaitingBoardSnapshot === false &&
    state.connectionState === "connected"
  );
}

/**
 * @param {{
 *   connected?: unknown,
 *   bufferedWrites?: unknown,
 *   awaitingBoardSnapshot?: unknown,
 *   awaitingSyncReplay?: unknown,
 *   connectionState?: unknown,
 * } | null | undefined} state
 * @returns {boolean}
 */
function isAuthoritativeResyncComplete(state) {
  return (
    !!state &&
    typeof state === "object" &&
    state.connected === true &&
    state.awaitingBoardSnapshot === false &&
    state.awaitingSyncReplay === false &&
    state.bufferedWrites === 0 &&
    state.connectionState === "connected"
  );
}

export {
  hasStableActiveToolState,
  isAuthoritativeResyncComplete,
  isBufferedWriteDrainComplete,
};
