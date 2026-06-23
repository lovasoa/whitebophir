/**
 * @param {unknown} x
 * @param {unknown} y
 * @returns {{x: number, y: number} | null}
 */
function getFinitePoint(x, y) {
  const pointX = Number(x);
  const pointY = Number(y);
  if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;
  return { x: pointX, y: pointY };
}

/**
 * Extracts the pointer-like activity point from a live board message.
 * Dragging shape tools report their current pointer endpoint as x2/y2.
 *
 * @param {Record<string, unknown>} message
 * @returns {{x: number, y: number} | null}
 */
export function getMessageActivityPoint(message) {
  if ("x2" in message || "y2" in message) {
    const endpoint = getFinitePoint(message.x2, message.y2);
    if (endpoint) return endpoint;
  }
  if ("x" in message || "y" in message) {
    return getFinitePoint(message.x, message.y);
  }
  return null;
}
