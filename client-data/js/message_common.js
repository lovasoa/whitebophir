/**
 * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ a: number, b: number, c: number, d: number, e: number, f: number }} Transform
 * @typedef {{ x?: unknown, y?: unknown }} ChildPoint
 * @typedef {{
 *   tool?: unknown,
 *   x?: unknown,
 *   y?: unknown,
 *   x2?: unknown,
 *   y2?: unknown,
 *   size?: unknown,
 *   txt?: string | null | undefined,
 *   textLength?: unknown,
 *   transform?: Transform | null | undefined,
 *   _children?: Array<ChildPoint | null | undefined>
 * }} GeometryItem
 */
import { DRAW_TOOL_IDS, TOOL_IDS } from "../tools/tool-order.js";
import {
  clampCoord,
  clampOpacity,
  clampSize,
  LIMITS,
  normalizeBoardCoord,
  resolveMaxBoardSize,
  toFiniteNumber,
} from "./message_limits.js";

const DRAW_TOOL_ID_SET = /** @type {ReadonlySet<string>} */ (
  new Set(DRAW_TOOL_IDS)
);

/**
 * @param {unknown} tool
 * @returns {string | undefined}
 */
function normalizeToolId(tool) {
  if (typeof tool === "string") return tool;
  if (
    typeof tool === "number" &&
    Number.isSafeInteger(tool) &&
    tool >= 1 &&
    tool <= TOOL_IDS.length
  ) {
    return TOOL_IDS[tool - 1];
  }
  return undefined;
}

const MAX_TRANSFORM_KEYS = ["a", "b", "c", "d", "e", "f"];

export {
  clampCoord,
  clampOpacity,
  clampSize,
  LIMITS,
  normalizeBoardCoord,
  resolveMaxBoardSize,
  toFiniteNumber,
};

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : null;
}

/**
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function truncateText(value, maxLength) {
  if (value === undefined || value === null) value = "";
  return String(value).slice(0, maxLength || LIMITS.MAX_TEXT_LENGTH);
}

/**
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string | null}
 */
export function normalizeId(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }
  const containsControlOrWhitespace = Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || /\s/.test(char);
  });
  return value.length > 0 &&
    value.length <= (maxLength || LIMITS.MAX_ID_LENGTH) &&
    !containsControlOrWhitespace
    ? value
    : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function normalizeFiniteNumber(value) {
  return toFiniteNumber(value);
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {boolean} [integerOnly]
 * @returns {number | null}
 */
export function normalizeNumberInRange(value, min, max, integerOnly = false) {
  const number = toFiniteNumber(value);
  if (
    number === null ||
    number < min ||
    number > max ||
    (integerOnly && !Number.isInteger(number))
  ) {
    return null;
  }
  return number;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFiniteTransformNumber(value) {
  return toFiniteNumber(value) !== null;
}

/**
 * @param {unknown} boardName
 * @param {unknown} toolId
 * @returns {boolean}
 */
export function requiresTurnstile(boardName, toolId) {
  if (boardName !== "anonymous") return false;
  const normalizedToolId = normalizeToolId(toolId);
  if (!normalizedToolId || normalizedToolId === "cursor") return false;
  return true;
}

/**
 * @param {unknown} toolId
 * @returns {boolean}
 */
export function isDrawTool(toolId) {
  const normalizedToolId = normalizeToolId(toolId);
  return (
    typeof normalizedToolId === "string" &&
    DRAW_TOOL_ID_SET.has(normalizedToolId)
  );
}

/**
 * @param {unknown} scale
 * @returns {boolean}
 */
export function isDrawToolAllowedAtScale(scale) {
  const numericScale = toFiniteNumber(scale);
  return numericScale !== null && numericScale > LIMITS.MIN_DRAW_ZOOM;
}

export function getMaxShapeSpan() {
  return LIMITS.GIANT_SHAPE_VIEWPORT_WIDTH / LIMITS.MIN_DRAW_ZOOM;
}

/**
 * @param {Bounds | null | undefined} bounds
 * @returns {Bounds | null}
 */
function cloneBounds(bounds) {
  if (!bounds) return null;
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
}

/**
 * @param {Bounds | null | undefined} bounds
 * @param {unknown} x
 * @param {unknown} y
 * @returns {Bounds | null}
 */
export function extendBoundsWithPoint(bounds, x, y) {
  const pointX = toFiniteNumber(x);
  const pointY = toFiniteNumber(y);
  if (pointX === null || pointY === null) return cloneBounds(bounds);
  if (!bounds) {
    return {
      minX: pointX,
      minY: pointY,
      maxX: pointX,
      maxY: pointY,
    };
  }
  return {
    minX: Math.min(bounds.minX, pointX),
    minY: Math.min(bounds.minY, pointY),
    maxX: Math.max(bounds.maxX, pointX),
    maxY: Math.max(bounds.maxY, pointY),
  };
}

/**
 * @param {GeometryItem | null | undefined} item
 * @returns {Bounds | null}
 */
export function getPencilBounds(item) {
  if (!item || !Array.isArray(item._children) || item._children.length === 0)
    return null;
  /** @type {Bounds | null} */
  let bounds = null;
  for (let index = 0; index < item._children.length; index++) {
    const child = item._children[index];
    if (!child) continue;
    const x = toFiniteNumber(child.x);
    const y = toFiniteNumber(child.y);
    if (x === null || y === null) continue;
    if (!bounds) {
      bounds = {
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
      };
      continue;
    }
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  }
  return bounds;
}

/**
 * @param {GeometryItem | null | undefined} item
 * @returns {Bounds | null}
 */
function getStraightShapeBounds(item) {
  if (!item) return null;
  const x1 = toFiniteNumber(item.x);
  const y1 = toFiniteNumber(item.y);
  const x2 = toFiniteNumber(item.x2);
  const y2 = toFiniteNumber(item.y2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  return {
    minX: Math.min(x1, x2),
    minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2),
    maxY: Math.max(y1, y2),
  };
}

/**
 * @param {GeometryItem} item
 * @returns {number}
 */
function getTextBoundsLength(item) {
  const length =
    typeof item.txt === "string"
      ? item.txt.length
      : toFiniteNumber(item.textLength);
  if (length === null) return 0;
  return Math.min(LIMITS.MAX_TEXT_LENGTH, Math.max(0, Math.floor(length)));
}

/**
 * @param {GeometryItem | null | undefined} item
 * @returns {Bounds | null}
 */
function getTextBounds(item) {
  if (!item) return null;
  const x = toFiniteNumber(item.x);
  const y = toFiniteNumber(item.y);
  const size = toFiniteNumber(item.size);
  if (x === null || y === null || size === null) return null;
  const width = Math.min(size * getTextBoundsLength(item), getMaxShapeSpan());
  return {
    minX: x,
    minY: y - size,
    maxX: x + width,
    maxY: y,
  };
}

/**
 * @param {GeometryItem | null | undefined} item
 * @returns {Bounds | null}
 */
export function getLocalGeometryBounds(item) {
  if (!item || !normalizeToolId(item.tool)) return null;
  if (Array.isArray(item._children)) return getPencilBounds(item);
  if (item.x2 !== undefined || item.y2 !== undefined) {
    return getStraightShapeBounds(item);
  }
  return getTextBounds(item);
}

/**
 * @param {GeometryItem | null | undefined} item
 * @returns {boolean}
 */
export function isGeometryTooLarge(item) {
  return isBoundsTooLarge(getEffectiveGeometryBounds(item));
}
/**
 * @param {Point} point
 * @param {Transform | null | undefined} transform
 * @returns {Point | null}
 */
export function applyTransformToPoint(point, transform) {
  const normalizedTransform = normalizeTransformNumbers(transform);
  if (!normalizedTransform) {
    return null;
  }
  return {
    x:
      normalizedTransform.a * point.x +
      normalizedTransform.c * point.y +
      normalizedTransform.e,
    y:
      normalizedTransform.b * point.x +
      normalizedTransform.d * point.y +
      normalizedTransform.f,
  };
}

/**
 * @param {unknown} transform
 * @returns {Transform | null}
 */
export function normalizeTransformNumbers(transform) {
  if (!transform || typeof transform !== "object") return null;
  const rawTransform = /** @type {Record<string, unknown>} */ (transform);
  /** @type {Transform} */
  const normalized = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  for (const key of MAX_TRANSFORM_KEYS) {
    const value = toFiniteNumber(rawTransform[key]);
    if (value === null) return null;
    normalized[/** @type {keyof Transform} */ (key)] = value;
  }
  return normalized;
}

/**
 * @param {Bounds | null | undefined} bounds
 * @param {unknown} transform
 * @returns {Bounds | null}
 */
export function applyTransformToBounds(bounds, transform) {
  if (!bounds) return null;
  if (!transform) return cloneBounds(bounds);

  const normalizedTransform = normalizeTransformNumbers(transform);
  if (!normalizedTransform) return null;

  const isTranslationOnly =
    normalizedTransform.a === 1 &&
    normalizedTransform.b === 0 &&
    normalizedTransform.c === 0 &&
    normalizedTransform.d === 1;
  if (isTranslationOnly) {
    return {
      minX: bounds.minX + normalizedTransform.e,
      minY: bounds.minY + normalizedTransform.f,
      maxX: bounds.maxX + normalizedTransform.e,
      maxY: bounds.maxY + normalizedTransform.f,
    };
  }

  /** @type {Point[]} */
  const points = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  ];
  let transformed = null;
  for (let i = 0; i < points.length; i++) {
    const sourcePoint = points[i];
    if (!sourcePoint) return null;
    const point = applyTransformToPoint(sourcePoint, normalizedTransform);
    if (point === null) return null;
    transformed = extendBoundsWithPoint(transformed, point.x, point.y);
  }
  return transformed;
}

/**
 * @param {GeometryItem | null | undefined} item
 * @returns {Bounds | null}
 */
export function getEffectiveGeometryBounds(item) {
  if (!item) return null;
  return applyTransformToBounds(getLocalGeometryBounds(item), item.transform);
}

/**
 * @param {Bounds | null | undefined} bounds
 * @returns {number}
 */
function getBoundsWidth(bounds) {
  return bounds ? bounds.maxX - bounds.minX : 0;
}

/**
 * @param {Bounds | null | undefined} bounds
 * @returns {number}
 */
function getBoundsHeight(bounds) {
  return bounds ? bounds.maxY - bounds.minY : 0;
}

/**
 * @param {Bounds | null | undefined} bounds
 * @returns {boolean}
 */
export function isBoundsTooLarge(bounds) {
  if (!bounds) return false;
  const maxShapeSpan = getMaxShapeSpan();
  return (
    getBoundsWidth(bounds) > maxShapeSpan ||
    getBoundsHeight(bounds) > maxShapeSpan
  );
}

/**
 * @param {Bounds | null | undefined} bounds
 * @param {unknown} maxBoardSize
 * @returns {boolean}
 */
export function isBoundsOutsideBoard(bounds, maxBoardSize) {
  if (!bounds) return false;
  const resolvedMaxBoardSize = resolveMaxBoardSize(maxBoardSize);
  return (
    bounds.minX < 0 ||
    bounds.minY < 0 ||
    bounds.maxX > resolvedMaxBoardSize ||
    bounds.maxY > resolvedMaxBoardSize
  );
}

/**
 * @param {Bounds | null | undefined} bounds
 * @param {unknown} maxBoardSize
 * @returns {boolean}
 */
export function isBoundsInvalid(bounds, maxBoardSize) {
  return isBoundsTooLarge(bounds) || isBoundsOutsideBoard(bounds, maxBoardSize);
}

/**
 * @param {GeometryItem | null | undefined} item
 * @param {unknown} maxBoardSize
 * @returns {boolean}
 */
export function isGeometryInvalid(item, maxBoardSize) {
  return isBoundsInvalid(getEffectiveGeometryBounds(item), maxBoardSize);
}

const messageCommon = {
  LIMITS,
  applyTransformToBounds,
  clampOpacity,
  clampCoord,
  clampSize,
  extendBoundsWithPoint,
  getEffectiveGeometryBounds,
  getLocalGeometryBounds,
  getMaxShapeSpan,
  getPencilBounds,
  isBoundsInvalid,
  isBoundsOutsideBoard,
  isFiniteTransformNumber,
  isBoundsTooLarge,
  isGeometryInvalid,
  isDrawTool,
  isDrawToolAllowedAtScale,
  isGeometryTooLarge,
  normalizeColor,
  normalizeBoardCoord,
  normalizeFiniteNumber,
  normalizeId,
  normalizeNumberInRange,
  normalizeTransformNumbers,
  resolveMaxBoardSize,
  truncateText,
  requiresTurnstile,
};
export default messageCommon;
