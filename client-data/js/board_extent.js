import MessageCommon from "./message_common.js";
import { hasMessagePoint } from "./message_shape.js";

/**
 * @typedef {{minX: number, minY: number, maxX: number, maxY: number}} Bounds
 */

/**
 * This module derives board-space extents. The viewport controller owns all
 * root SVG dimension and page layout mutation.
 */

/**
 * @param {Bounds | null} current
 * @param {Bounds | null | undefined} next
 * @returns {Bounds | null}
 */
export function extendBoundsWithBounds(current, next) {
  if (!next) return current;
  if (!current) {
    return {
      minX: next.minX,
      minY: next.minY,
      maxX: next.maxX,
      maxY: next.maxY,
    };
  }
  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  };
}

/**
 * WARNING: this calls SVG getBBox(), which may force browser layout. Use only
 * for small, already-identified element sets such as the current hand-tool
 * selection. Do not use this from board-wide scans, replay loops, or generic
 * message hooks.
 * @param {unknown} element
 * @returns {Bounds | null}
 */
export function measureSvgElementLocalBounds(element) {
  if (!element || typeof element !== "object" || !("getBBox" in element)) {
    return null;
  }
  const getBBox = /** @type {{getBBox?: () => DOMRect}} */ (element).getBBox;
  if (typeof getBBox !== "function") return null;
  let bbox;
  try {
    bbox = getBBox.call(element);
  } catch {
    return null;
  }
  if (
    !Number.isFinite(bbox.x) ||
    !Number.isFinite(bbox.y) ||
    !Number.isFinite(bbox.width) ||
    !Number.isFinite(bbox.height)
  ) {
    return null;
  }
  return {
    minX: bbox.x,
    minY: bbox.y,
    maxX: bbox.x + bbox.width,
    maxY: bbox.y + bbox.height,
  };
}

/**
 * WARNING: this calls SVG getBBox() through measureSvgElementLocalBounds().
 * Keep usage scoped to small selected element sets.
 * @param {unknown} element
 * @param {unknown} transform
 * @returns {Bounds | null}
 */
export function measureSvgElementBoundsAfterTransform(element, transform) {
  return MessageCommon.applyTransformToBounds(
    measureSvgElementLocalBounds(element),
    transform,
  );
}

/**
 * Computes extents from the message payload only. It intentionally does not
 * measure DOM elements, so transform-only updates return null.
 * @param {unknown} message
 * @returns {Bounds | null}
 */
export function getMessageBounds(message) {
  if (!message || typeof message !== "object") return null;
  const record = /** @type {{[key: string]: unknown}} */ (message);
  if (Array.isArray(record._children)) {
    /** @type {Bounds | null} */
    let bounds = null;
    for (let index = 0; index < record._children.length; index++) {
      bounds = extendBoundsWithBounds(
        bounds,
        getMessageBounds(record._children[index]),
      );
    }
    return bounds;
  }

  const geometryBounds = MessageCommon.getEffectiveGeometryBounds(record);
  if (geometryBounds) return geometryBounds;

  if (hasMessagePoint(record)) {
    return {
      minX: record.x,
      minY: record.y,
      maxX: record.x,
      maxY: record.y,
    };
  }
  if (typeof record.x2 === "number" && typeof record.y2 === "number") {
    return {
      minX: record.x2,
      minY: record.y2,
      maxX: record.x2,
      maxY: record.y2,
    };
  }
  return null;
}
