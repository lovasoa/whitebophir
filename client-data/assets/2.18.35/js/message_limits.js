export const LIMITS = {
  MIN_SIZE: 10,
  MAX_SIZE: 500,
  MIN_OPACITY: 0.1,
  MAX_OPACITY: 1,
  MIN_DRAW_ZOOM: 0.04,
  GIANT_SHAPE_VIEWPORT_WIDTH: 1280,
  GIANT_SHAPE_VIEWPORT_HEIGHT: 720,
  DEFAULT_MAX_BOARD_SIZE: 655360,
  MAX_TEXT_LENGTH: 280,
  DEFAULT_MAX_CHILDREN: 192,
  MAX_ID_LENGTH: 128,
};

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {number} number
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

/**
 * @param {unknown} maxBoardSize
 * @returns {number}
 */
export function resolveMaxBoardSize(maxBoardSize) {
  const resolved = toFiniteNumber(maxBoardSize);
  return resolved === null ? LIMITS.DEFAULT_MAX_BOARD_SIZE : resolved;
}

/**
 * @param {number} size
 * @returns {number}
 */
export function clampSize(size) {
  if (!Number.isFinite(size)) size = LIMITS.MIN_SIZE;
  return clamp(Math.round(size), LIMITS.MIN_SIZE, LIMITS.MAX_SIZE);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function clampOpacity(value) {
  let opacity = toFiniteNumber(value);
  if (opacity === null) opacity = LIMITS.MAX_OPACITY;
  return clamp(opacity, LIMITS.MIN_OPACITY, LIMITS.MAX_OPACITY);
}

/**
 * @param {unknown} value
 * @param {unknown} maxBoardSize
 * @returns {number}
 */
export function clampCoord(value, maxBoardSize) {
  let coord = toFiniteNumber(value);
  if (coord === null) coord = 0;
  const resolvedMaxBoardSize =
    typeof maxBoardSize === "number"
      ? maxBoardSize
      : resolveMaxBoardSize(maxBoardSize);
  const clamped = clamp(coord, 0, resolvedMaxBoardSize);
  return Math.round(clamped);
}

/**
 * @param {unknown} value
 * @param {unknown} maxBoardSize
 * @returns {number | null}
 */
export function normalizeBoardCoord(value, maxBoardSize) {
  const coord = toFiniteNumber(value);
  if (coord === null || !Number.isInteger(coord)) return null;
  const resolvedMaxBoardSize =
    typeof maxBoardSize === "number"
      ? maxBoardSize
      : resolveMaxBoardSize(maxBoardSize);
  return coord >= 0 && coord <= resolvedMaxBoardSize ? coord : null;
}
