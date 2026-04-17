/**
 * @param {unknown} markup
 * @returns {string}
 */
function normalizeMarkup(markup) {
  return typeof markup === "string" ? markup : "";
}

/**
 * @param {{
 *   previousMarkup?: unknown,
 *   currentMarkup?: unknown,
 *   isPersistentEnvelope?: boolean,
 *   isSnapshotMessage?: boolean,
 * }} state
 * @returns {string}
 */
export function evolveAuthoritativeDrawingMarkup(state) {
  if (state?.isPersistentEnvelope === true || state?.isSnapshotMessage === true)
    return normalizeMarkup(state.currentMarkup);
  return normalizeMarkup(state?.previousMarkup);
}

/**
 * @param {{
 *   authoritativeMarkup?: unknown,
 *   useSeqSyncProtocol?: boolean,
 *   hasAuthoritativeBoardSnapshot?: boolean,
 * }} state
 * @returns {string | null}
 */
export function markupForAuthoritativeResync(state) {
  if (
    state?.useSeqSyncProtocol === true &&
    state?.hasAuthoritativeBoardSnapshot === true
  ) {
    return normalizeMarkup(state.authoritativeMarkup);
  }
  return null;
}

export default {
  evolveAuthoritativeDrawingMarkup,
  markupForAuthoritativeResync,
};
