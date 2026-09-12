/**
 * DOM-free helpers for the canonical persisted pencil path format
 * (`M <x> <y> l <dx> <dy> ...`). Shared by the pencil runtime, the storage
 * contract, and server persistence so none of them need the browser tool graph.
 */

/** @typedef {import("../shape_contract.js").SvgTransform} StoredPencilTransform */
/** @typedef {{id?: string, color?: string, size?: number, opacity?: number, transform?: StoredPencilTransform}} StoredPencilPathItem */
/** @typedef {{escapeHtml: (value: string) => string, numberOrZero: (value: unknown) => number, renderTransformAttribute: (transform: StoredPencilTransform | undefined) => string}} StoredPencilPathSerializeHelpers */

/**
 * @param {number} value
 * @returns {number}
 */
function roundPathValue(value) {
  return Math.round(value);
}

/**
 * @param {string} d
 * @param {number} index
 * @returns {{value: number, index: number} | null}
 */
function readCanonicalPathInteger(d, index) {
  const length = d.length;
  let next = index;
  let sign = 1;
  if (next < length && d.charCodeAt(next) === 45) {
    sign = -1;
    next += 1;
  }
  if (next >= length) return null;
  let code = d.charCodeAt(next) - 48;
  if (code < 0 || code > 9) return null;
  let value = 0;
  while (next < length && code >= 0 && code <= 9) {
    value = value * 10 + code;
    next += 1;
    if (next >= length) break;
    code = d.charCodeAt(next) - 48;
  }
  return { value: sign * value, index: next };
}

const EMPTY_PERSISTED_PENCIL_SCAN = {
  childCount: 0,
  localBounds: null,
  lastPoint: null,
};

/**
 * @param {string | undefined} d
 * @returns {{
 *   childCount: number,
 *   localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null,
 *   lastPoint: {x: number, y: number} | null,
 * }}
 */
export function scanPersistedPencilPath(d) {
  if (typeof d !== "string" || d === "") return EMPTY_PERSISTED_PENCIL_SCAN;
  const length = d.length;
  if (length < 5 || d.charCodeAt(0) !== 77 || d.charCodeAt(1) !== 32)
    return EMPTY_PERSISTED_PENCIL_SCAN;

  let index = 2;
  const firstX = readCanonicalPathInteger(d, index);
  if (!firstX || firstX.index >= length || d.charCodeAt(firstX.index) !== 32)
    return EMPTY_PERSISTED_PENCIL_SCAN;
  index = firstX.index + 1;
  const firstY = readCanonicalPathInteger(d, index);
  if (!firstY) return EMPTY_PERSISTED_PENCIL_SCAN;
  index = firstY.index;

  let currentX = firstX.value;
  let currentY = firstY.value;
  let minX = currentX;
  let minY = currentY;
  let maxX = currentX;
  let maxY = currentY;
  let childCount = 1;
  let previousDistinctX = currentX;
  let previousDistinctY = currentY;

  while (index < length) {
    if (
      index + 2 >= length ||
      d.charCodeAt(index) !== 32 ||
      d.charCodeAt(index + 1) !== 108 ||
      d.charCodeAt(index + 2) !== 32
    ) {
      return EMPTY_PERSISTED_PENCIL_SCAN;
    }
    index += 3;
    const deltaX = readCanonicalPathInteger(d, index);
    if (!deltaX || deltaX.index >= length || d.charCodeAt(deltaX.index) !== 32)
      return EMPTY_PERSISTED_PENCIL_SCAN;
    index = deltaX.index + 1;
    const deltaY = readCanonicalPathInteger(d, index);
    if (!deltaY) return EMPTY_PERSISTED_PENCIL_SCAN;
    index = deltaY.index;
    currentX += deltaX.value;
    currentY += deltaY.value;
    if (previousDistinctX === currentX && previousDistinctY === currentY) {
      continue;
    }
    previousDistinctX = currentX;
    previousDistinctY = currentY;
    childCount += 1;
    if (currentX < minX) minX = currentX;
    else if (currentX > maxX) maxX = currentX;
    if (currentY < minY) minY = currentY;
    else if (currentY > maxY) maxY = currentY;
  }

  return {
    childCount,
    localBounds: { minX, minY, maxX, maxY },
    lastPoint: { x: currentX, y: currentY },
  };
}

/**
 * @param {string | undefined} d
 * @returns {{childCount: number, localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null}}
 */
export function scanPathSummary(d) {
  const scanned = scanPersistedPencilPath(d);
  return {
    childCount: scanned.childCount,
    localBounds: scanned.localBounds,
  };
}

/**
 * @param {string | undefined} d
 * @param {{x: number, y: number}[]} points
 * @returns {string}
 */
export function appendPersistedPencilPath(d, points) {
  if (!Array.isArray(points) || points.length === 0) {
    return typeof d === "string" ? d : "";
  }
  const scanned = scanPersistedPencilPath(d);
  if (!scanned.lastPoint) return "";
  let lastX = scanned.lastPoint.x;
  let lastY = scanned.lastPoint.y;
  let pathData = d || "";
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const x = roundPathValue(point.x);
    const y = roundPathValue(point.y);
    pathData += ` l ${x - lastX} ${y - lastY}`;
    lastX = x;
    lastY = y;
  }
  return pathData;
}

/**
 * @param {{x: number, y: number}[]} points
 * @returns {string}
 */
export function renderPencilPath(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  const firstPoint = points[0];
  if (
    !firstPoint ||
    !Number.isFinite(firstPoint.x) ||
    !Number.isFinite(firstPoint.y)
  ) {
    return "";
  }
  let lastX = roundPathValue(firstPoint.x);
  let lastY = roundPathValue(firstPoint.y);
  let pathData = `M ${lastX} ${lastY}`;
  if (points.length === 1) return `${pathData} l 0 0`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const x = roundPathValue(point.x);
    const y = roundPathValue(point.y);
    pathData += ` l ${x - lastX} ${y - lastY}`;
    lastX = x;
    lastY = y;
  }
  return pathData;
}

/**
 * @param {StoredPencilPathItem} item
 * @param {string} pathData
 * @param {StoredPencilPathSerializeHelpers} helpers
 * @returns {string}
 */
export function serializeStoredPencilPath(item, pathData, helpers) {
  if (!pathData) return "";
  const transform = helpers.renderTransformAttribute(item.transform);
  const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
  const color = helpers.escapeHtml(item.color || "#000000");
  const size = helpers.numberOrZero(item.size) | 0;
  const opacity =
    typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
  return (
    `<path id="${id}" d="${helpers.escapeHtml(pathData)}"` +
    ` stroke="${color}" stroke-width="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacity}${transform}></path>`
  );
}
