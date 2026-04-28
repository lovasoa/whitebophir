import MessageCommon from "../../client-data/js/message_common.js";

const DEFAULT_SVG_SIZE = 5000;
const SVG_MARGIN = 4000;

/**
 * @typedef {{width: number, height: number}} SvgExtent
 * @typedef {{bounds?: {minX: number, minY: number, maxX: number, maxY: number} | null, transform?: unknown, deleted?: boolean}} ExtentItem
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeSvgDimension(value) {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0
    ? Math.ceil(dimension)
    : DEFAULT_SVG_SIZE;
}

/**
 * @param {unknown} [width]
 * @param {unknown} [height]
 * @returns {SvgExtent}
 */
function createSvgExtent(width = DEFAULT_SVG_SIZE, height = DEFAULT_SVG_SIZE) {
  return {
    width: normalizeSvgDimension(width),
    height: normalizeSvgDimension(height),
  };
}

/**
 * @returns {SvgExtent}
 */
function createDefaultSvgExtent() {
  return createSvgExtent();
}

/**
 * @param {SvgExtent | undefined} extent
 * @returns {SvgExtent}
 */
function normalizeSvgExtent(extent) {
  return createSvgExtent(extent?.width, extent?.height);
}

/**
 * @param {SvgExtent} extent
 * @param {ExtentItem | null | undefined} item
 * @returns {void}
 */
function extendSvgExtentForItem(extent, item) {
  if (!item || item.deleted === true || !item.bounds) return;
  const bounds = item.transform
    ? MessageCommon.applyTransformToBounds(item.bounds, item.transform)
    : item.bounds;
  if (!bounds) return;
  extent.width = Math.max(extent.width, Math.ceil(bounds.maxX + SVG_MARGIN));
  extent.height = Math.max(extent.height, Math.ceil(bounds.maxY + SVG_MARGIN));
}

export {
  DEFAULT_SVG_SIZE,
  SVG_MARGIN,
  createDefaultSvgExtent,
  createSvgExtent,
  extendSvgExtentForItem,
  normalizeSvgDimension,
  normalizeSvgExtent,
};
