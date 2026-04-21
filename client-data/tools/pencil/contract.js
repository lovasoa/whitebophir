import { TOOL_CATALOG_BY_NAME } from "../../js/tool_catalog.js";

const toolName = /** @type {string} */ (TOOL_CATALOG_BY_NAME.Pencil?.name);

/**
 * @param {number} value
 * @returns {number}
 */
function roundPathValue(value) {
  return Math.round(value);
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isPathWhitespace(code) {
  return code === 9 || code === 10 || code === 13 || code === 32 || code === 44;
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isAsciiLetter(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * @param {string | undefined} d
 * @param {(command: "M" | "l", x: number, y: number) => void} visit
 * @returns {boolean}
 */
function forEachPathPair(d, visit) {
  if (typeof d !== "string" || d.trim() === "") return true;
  let index = 0;
  /** @type {"M" | "l" | null} */
  let command = null;
  /** @type {number | undefined} */
  let pendingX;

  while (index < d.length) {
    const code = d.charCodeAt(index);
    if (Number.isNaN(code)) break;
    if (isPathWhitespace(code)) {
      index += 1;
      continue;
    }
    if (code === 77 || code === 108) {
      if (pendingX !== undefined) return false;
      command = code === 77 ? "M" : "l";
      index += 1;
      continue;
    }
    if (isAsciiLetter(code) || !command) return false;
    const start = index;
    index += 1;
    while (index < d.length) {
      const nextCode = d.charCodeAt(index);
      if (Number.isNaN(nextCode)) break;
      if (isPathWhitespace(nextCode) || nextCode === 77 || nextCode === 108) {
        break;
      }
      index += 1;
      if (isAsciiLetter(nextCode)) return false;
    }
    const value = Number(d.slice(start, index));
    if (!Number.isFinite(value)) return false;
    if (pendingX === undefined) {
      pendingX = value;
      continue;
    }
    visit(command, pendingX, value);
    pendingX = undefined;
  }
  return pendingX === undefined;
}

/**
 * @param {string | undefined} d
 * @returns {{type: string, values: number[]}[]}
 */
function parsePathData(d) {
  /** @type {{type: string, values: number[]}[]} */
  const segments = [];
  const ok = forEachPathPair(d, (command, x, y) => {
    segments.push({ type: command, values: [x, y] });
  });
  return ok ? segments : [];
}

/**
 * @param {string | undefined} d
 * @returns {{childCount: number, localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null}}
 */
function scanPathSummary(d) {
  let currentX = 0;
  let currentY = 0;
  let childCount = 0;
  /** @type {{minX: number, minY: number, maxX: number, maxY: number} | null} */
  let localBounds = null;
  /** @type {number | undefined} */
  let previousX;
  /** @type {number | undefined} */
  let previousY;
  const ok = forEachPathPair(d, (command, x, y) => {
    if (command === "M") {
      currentX = x;
      currentY = y;
    } else {
      currentX += x;
      currentY += y;
    }
    if (previousX === currentX && previousY === currentY) return;
    previousX = currentX;
    previousY = currentY;
    childCount += 1;
    if (!localBounds) {
      localBounds = {
        minX: currentX,
        minY: currentY,
        maxX: currentX,
        maxY: currentY,
      };
      return;
    }
    localBounds.minX = Math.min(localBounds.minX, currentX);
    localBounds.minY = Math.min(localBounds.minY, currentY);
    localBounds.maxX = Math.max(localBounds.maxX, currentX);
    localBounds.maxY = Math.max(localBounds.maxY, currentY);
  });
  if (!ok) return { childCount: 0, localBounds: null };
  return { childCount, localBounds };
}

/**
 * @param {{type: string, values: number[]}[]} pathData
 * @returns {{x: number, y: number}[]}
 */
function pointsFromPathData(pathData) {
  /** @type {{x: number, y: number}[]} */
  const points = [];
  let currentX = 0;
  let currentY = 0;
  pathData.forEach((segment) => {
    if (!segment || !Array.isArray(segment.values)) return;
    if (segment.values.length < 2) return;
    const x = segment.values[segment.values.length - 2];
    const y = segment.values[segment.values.length - 1];
    if (typeof x !== "number" || typeof y !== "number") return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const pointX = segment.type === "l" ? currentX + x : x;
    const pointY = segment.type === "l" ? currentY + y : y;
    const previous = points[points.length - 1];
    const point = { x: pointX, y: pointY };
    if (previous && previous.x === point.x && previous.y === point.y) return;
    points.push(point);
    currentX = pointX;
    currentY = pointY;
  });
  return points;
}

/**
 * @param {{x: number, y: number}[]} points
 * @returns {string}
 */
function renderPencilPath(points) {
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

export { parsePathData, pointsFromPathData, renderPencilPath, scanPathSummary };

/** @type {import("../shape_contract.js").ToolContract} */
const pencilContract = {
  toolName,
  liveMessageFields: {
    line: {
      id: "id",
      color: "color",
      size: "size",
      opacity: "opacity?",
    },
    child: {
      parent: "id",
      x: "coord",
      y: "coord",
    },
  },
  storedFields: {
    color: "color",
    size: "size",
    opacity: "opacity?",
    transform: "transform?",
    time: "time?",
  },
  normalizeStoredItemData(item, raw, helpers) {
    if (!Array.isArray(raw?._children)) return;
    const children = helpers.normalizeStoredChildren(
      raw._children.slice(0, helpers.maxChildren),
    );
    if (children.length) item._children = children;
  },
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    const scanned = scanPathSummary(helpers.readStoredSvgAttribute(entry, "d"));
    if (size === undefined || scanned.childCount === 0) return null;
    return {
      id: helpers.id,
      tool: toolName,
      data: helpers.decorateStoredItemData(
        {
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        helpers.opacity,
        helpers.transform,
      ),
      childCount: scanned.childCount,
      paintOrder,
      localBounds: scanned.localBounds,
    };
  },
  parseStoredSvgItem(summary, entry, helpers) {
    const points = pointsFromPathData(
      parsePathData(helpers.readStoredSvgAttribute(entry, "d")),
    );
    if (points.length === 0) return null;
    return {
      id: summary.id,
      tool: toolName,
      ...summary.data,
      _children: points,
    };
  },
  serializeStoredSvgItem(item, helpers) {
    const transform = helpers.renderTransformAttribute(item.transform);
    const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
    const color = helpers.escapeHtml(item.color || "#000000");
    const size = helpers.numberOrZero(item.size) | 0;
    const opacity =
      typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
    const points = Array.isArray(item._children) ? item._children : [];
    const pathData = renderPencilPath(points);
    if (!pathData) return "";
    return (
      `<path id="${id}" d="${helpers.escapeHtml(pathData)}" stroke="${color}"` +
      ` stroke-width="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round"` +
      `${opacity}${transform}></path>`
    );
  },
  renderBoardSvg(pencil, helpers) {
    const pathstring = renderPencilPath(pencil._children || []);
    if (pathstring === "") return "";
    return helpers.renderPath(pencil, pathstring);
  },
};

export default pencilContract;
