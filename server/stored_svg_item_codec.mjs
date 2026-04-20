import { readRawAttribute } from "./svg_envelope.mjs";

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
function unescapeHtml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * @param {string | undefined} value
 * @returns {number}
 */
function decodedTextLength(value) {
  if (typeof value !== "string" || value.length === 0) return 0;
  let index = 0;
  let length = 0;
  while (index < value.length) {
    if (value[index] !== "&") {
      length += 1;
      index += 1;
      continue;
    }
    if (value.startsWith("&lt;", index) || value.startsWith("&gt;", index)) {
      length += 1;
      index += 4;
      continue;
    }
    if (value.startsWith("&amp;", index)) {
      length += 1;
      index += 5;
      continue;
    }
    if (value.startsWith("&quot;", index)) {
      length += 1;
      index += 6;
      continue;
    }
    if (value.startsWith("&#39;", index)) {
      length += 1;
      index += 5;
      continue;
    }
    length += 1;
    index += 1;
  }
  return length;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * @param {any} transform
 * @returns {string}
 */
function renderTransformAttribute(transform) {
  if (
    !transform ||
    typeof transform !== "object" ||
    !["a", "b", "c", "d", "e", "f"].every(
      (key) => typeof transform[key] === "number",
    )
  ) {
    return "";
  }
  return ` transform="matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})"`;
}

/**
 * @param {string | undefined} transform
 * @returns {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined}
 */
function parseTransformAttribute(transform) {
  if (!transform) return undefined;
  const match = transform.match(
    /^matrix\(\s*([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)[ ,]([^\s,)]+)\s*\)$/,
  );
  if (!match) return undefined;
  /** @type {number[]} */
  const values = match.slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
  return { a, b, c, d, e, f };
}

/**
 * @param {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined} transform
 * @returns {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined}
 */
function cloneTransform(transform) {
  return transform ? { ...transform } : undefined;
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundPathValue(value) {
  return Math.round(value);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} textLength
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
function textBoundsFromLength(x, y, size, textLength) {
  return {
    minX: x,
    minY: y - size,
    maxX: x + size * textLength,
    maxY: y,
  };
}

/**
 * @param {{attributes?: {[name: string]: string}, rawAttributes?: string}} entry
 * @param {string} name
 * @returns {string | undefined}
 */
function readStoredSvgAttribute(entry, name) {
  const value = entry?.attributes?.[name];
  if (typeof value === "string") return value;
  return readRawAttribute(entry?.rawAttributes, name);
}

/**
 * @param {{attributes?: {[name: string]: string}, rawAttributes?: string, id?: string}} entry
 * @returns {{id: string | undefined, opacity: number | undefined, transform: {a: number, b: number, c: number, d: number, e: number, f: number} | undefined}}
 */
function readStoredSvgBase(entry) {
  const id =
    typeof entry?.id === "string"
      ? entry.id
      : readStoredSvgAttribute(entry, "id");
  return {
    id,
    opacity: parseNumber(readStoredSvgAttribute(entry, "opacity")),
    transform: parseTransformAttribute(
      readStoredSvgAttribute(entry, "transform"),
    ),
  };
}

/**
 * @param {object} data
 * @param {number | undefined} opacity
 * @param {{a: number, b: number, c: number, d: number, e: number, f: number} | undefined} transform
 * @returns {object}
 */
function decorateStoredItemData(data, opacity, transform) {
  return {
    ...data,
    ...(opacity !== undefined ? { opacity } : {}),
    ...(transform !== undefined
      ? { transform: cloneTransform(transform) }
      : {}),
  };
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

  if (points.length === 1) {
    return `${pathData} l 0 0`;
  }

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
    const point = /** @type {{x: number, y: number}} */ ({
      x: pointX,
      y: pointY,
    });
    if (previous && previous.x === point.x && previous.y === point.y) return;
    points.push(point);
    currentX = pointX;
    currentY = pointY;
  });
  return points;
}

/**
 * @param {{tagName: string, attributes?: {[name: string]: string}, rawAttributes?: string, content?: string, id?: string}} entry
 * @returns {any | null}
 */
function parseStoredSvgItem(entry) {
  const summary = summarizeStoredSvgItem(entry);
  if (!summary) return null;
  switch (summary.tool) {
    case "Text":
      return {
        id: summary.id,
        tool: "Text",
        ...summary.data,
        txt: unescapeHtml(entry.content || ""),
      };
    case "Pencil": {
      const points = pointsFromPathData(
        parsePathData(readStoredSvgAttribute(entry, "d")),
      );
      if (points.length === 0) return null;
      return {
        id: summary.id,
        tool: "Pencil",
        ...summary.data,
        _children: points,
      };
    }
    default:
      return {
        id: summary.id,
        tool: summary.tool,
        ...summary.data,
      };
  }
}

/**
 * @param {{tagName: string, attributes?: {[name: string]: string}, rawAttributes?: string, content?: string, id?: string}} entry
 * @param {number} [paintOrder]
 * @returns {any | null}
 */
function summarizeStoredSvgItem(entry, paintOrder) {
  if (!entry || typeof entry.tagName !== "string") return null;
  const { id, opacity, transform } = readStoredSvgBase(entry);
  if (!id) return null;
  switch (entry.tagName) {
    case "rect": {
      const x = parseNumber(readStoredSvgAttribute(entry, "x"));
      const y = parseNumber(readStoredSvgAttribute(entry, "y"));
      const width = parseNumber(readStoredSvgAttribute(entry, "width"));
      const height = parseNumber(readStoredSvgAttribute(entry, "height"));
      const size = parseNumber(readStoredSvgAttribute(entry, "stroke-width"));
      if (
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined ||
        size === undefined
      ) {
        return null;
      }
      return {
        id,
        tool: "Rectangle",
        paintOrder,
        data: decorateStoredItemData(
          {
            x,
            y,
            x2: x + width,
            y2: y + height,
            color: readStoredSvgAttribute(entry, "stroke") || "#000000",
            size,
          },
          opacity,
          transform,
        ),
        localBounds: {
          minX: x,
          minY: y,
          maxX: x + width,
          maxY: y + height,
        },
      };
    }
    case "ellipse": {
      const cx = parseNumber(readStoredSvgAttribute(entry, "cx"));
      const cy = parseNumber(readStoredSvgAttribute(entry, "cy"));
      const rx = parseNumber(readStoredSvgAttribute(entry, "rx"));
      const ry = parseNumber(readStoredSvgAttribute(entry, "ry"));
      const size = parseNumber(readStoredSvgAttribute(entry, "stroke-width"));
      if (
        cx === undefined ||
        cy === undefined ||
        rx === undefined ||
        ry === undefined ||
        size === undefined
      ) {
        return null;
      }
      return {
        id,
        tool: "Ellipse",
        paintOrder,
        data: decorateStoredItemData(
          {
            x: cx - rx,
            y: cy - ry,
            x2: cx + rx,
            y2: cy + ry,
            color: readStoredSvgAttribute(entry, "stroke") || "#000000",
            size,
          },
          opacity,
          transform,
        ),
        localBounds: {
          minX: cx - rx,
          minY: cy - ry,
          maxX: cx + rx,
          maxY: cy + ry,
        },
      };
    }
    case "line": {
      const x1 = parseNumber(readStoredSvgAttribute(entry, "x1"));
      const y1 = parseNumber(readStoredSvgAttribute(entry, "y1"));
      const x2 = parseNumber(readStoredSvgAttribute(entry, "x2"));
      const y2 = parseNumber(readStoredSvgAttribute(entry, "y2"));
      const size = parseNumber(readStoredSvgAttribute(entry, "stroke-width"));
      if (
        x1 === undefined ||
        y1 === undefined ||
        x2 === undefined ||
        y2 === undefined ||
        size === undefined
      ) {
        return null;
      }
      return {
        id,
        tool: "Straight line",
        paintOrder,
        data: decorateStoredItemData(
          {
            x: x1,
            y: y1,
            x2,
            y2,
            color: readStoredSvgAttribute(entry, "stroke") || "#000000",
            size,
          },
          opacity,
          transform,
        ),
        localBounds: {
          minX: Math.min(x1, x2),
          minY: Math.min(y1, y2),
          maxX: Math.max(x1, x2),
          maxY: Math.max(y1, y2),
        },
      };
    }
    case "text": {
      const x = parseNumber(readStoredSvgAttribute(entry, "x"));
      const y = parseNumber(readStoredSvgAttribute(entry, "y"));
      const size = parseNumber(readStoredSvgAttribute(entry, "font-size"));
      if (x === undefined || y === undefined || size === undefined) {
        return null;
      }
      const textLength = decodedTextLength(entry.content || "");
      return {
        id,
        tool: "Text",
        paintOrder,
        data: decorateStoredItemData(
          {
            x,
            y,
            size,
            color: readStoredSvgAttribute(entry, "fill") || "#000000",
          },
          opacity,
          transform,
        ),
        textLength,
        localBounds: textBoundsFromLength(x, y, size, textLength),
      };
    }
    case "path": {
      const size = parseNumber(readStoredSvgAttribute(entry, "stroke-width"));
      const scanned = scanPathSummary(readStoredSvgAttribute(entry, "d"));
      if (size === undefined || scanned.childCount === 0) return null;
      return {
        id,
        tool: "Pencil",
        data: decorateStoredItemData(
          {
            color: readStoredSvgAttribute(entry, "stroke") || "#000000",
            size,
          },
          opacity,
          transform,
        ),
        childCount: scanned.childCount,
        paintOrder,
        localBounds: scanned.localBounds,
      };
    }
    default:
      return null;
  }
}

/**
 * @param {any} item
 * @returns {string}
 */
function serializeStoredSvgItem(item) {
  if (!item || typeof item !== "object" || typeof item.tool !== "string") {
    return "";
  }
  const transform = renderTransformAttribute(item.transform);
  const id = typeof item.id === "string" ? escapeHtml(item.id) : "";
  const color = escapeHtml(item.color || "#000000");
  const size = numberOrZero(item.size) | 0;
  const opacity =
    typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
  switch (item.tool) {
    case "Rectangle": {
      const x = Math.min(numberOrZero(item.x), numberOrZero(item.x2));
      const y = Math.min(numberOrZero(item.y), numberOrZero(item.y2));
      const width = Math.abs(numberOrZero(item.x2) - numberOrZero(item.x));
      const height = Math.abs(numberOrZero(item.y2) - numberOrZero(item.y));
      return (
        `<rect id="${id}" x="${x}" y="${y}" width="${width}" height="${height}"` +
        ` stroke="${color}" stroke-width="${size}" fill="none"${opacity}${transform}></rect>`
      );
    }
    case "Ellipse": {
      const cx = Math.round((numberOrZero(item.x) + numberOrZero(item.x2)) / 2);
      const cy = Math.round((numberOrZero(item.y) + numberOrZero(item.y2)) / 2);
      const rx = Math.abs(numberOrZero(item.x2) - numberOrZero(item.x)) / 2;
      const ry = Math.abs(numberOrZero(item.y2) - numberOrZero(item.y)) / 2;
      return (
        `<ellipse id="${id}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"` +
        ` stroke="${color}" stroke-width="${size}" fill="none"${opacity}${transform}></ellipse>`
      );
    }
    case "Straight line":
      return (
        `<line id="${id}" x1="${numberOrZero(item.x)}" y1="${numberOrZero(item.y)}"` +
        ` x2="${numberOrZero(item.x2)}" y2="${numberOrZero(item.y2)}"` +
        ` stroke="${color}" stroke-width="${size}" fill="none"${opacity}${transform}></line>`
      );
    case "Text": {
      const textValue = String(item.txt || "");
      return (
        `<text id="${id}" x="${numberOrZero(item.x)}" y="${numberOrZero(item.y)}"` +
        ` font-size="${numberOrZero(item.size) | 0}" fill="${color}"${opacity}${transform}>` +
        `${escapeHtml(textValue)}</text>`
      );
    }
    case "Pencil": {
      const points = Array.isArray(item._children) ? item._children : [];
      const pathData = renderPencilPath(points);
      if (!pathData) return "";
      return (
        `<path id="${id}" d="${escapeHtml(pathData)}" stroke="${color}"` +
        ` stroke-width="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round"` +
        `${opacity}${transform}></path>`
      );
    }
    default:
      return "";
  }
}

export {
  parsePathData,
  parseStoredSvgItem,
  scanPathSummary,
  parseTransformAttribute,
  pointsFromPathData,
  renderPencilPath,
  renderTransformAttribute,
  serializeStoredSvgItem,
  summarizeStoredSvgItem,
};
