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
 * }} state
 * @returns {string}
 */
export function evolveAuthoritativeDrawingMarkup(state) {
  if (state?.isPersistentEnvelope === true)
    return normalizeMarkup(state.currentMarkup);
  return normalizeMarkup(state?.previousMarkup);
}

/**
 * @param {{
 *   authoritativeMarkup?: unknown,
 *   hasAuthoritativeBoardSnapshot?: boolean,
 * }} state
 * @returns {string | null}
 */
export function markupForAuthoritativeResync(state) {
  if (state?.hasAuthoritativeBoardSnapshot === true) {
    return normalizeMarkup(state.authoritativeMarkup);
  }
  return null;
}

export default {
  evolveAuthoritativeDrawingMarkup,
  markupForAuthoritativeResync,
};
