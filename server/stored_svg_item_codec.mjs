import { wboPencilPoint } from "../client-data/tools/pencil/wbo_pencil_point.js";

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
 * @param {{attributes?: {[name: string]: string}}} entry
 * @returns {{attributes: {[name: string]: string}, id: string | undefined, opacity: number | undefined, transform: {a: number, b: number, c: number, d: number, e: number, f: number} | undefined}}
 */
function readStoredSvgBase(entry) {
  const attributes = entry?.attributes || {};
  return {
    attributes,
    id: typeof attributes.id === "string" ? attributes.id : undefined,
    opacity: parseNumber(attributes.opacity),
    transform: parseTransformAttribute(attributes.transform),
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
  /** @type {{type: string, values: number[]}[]} */
  const pathData = [];
  points.forEach((point) => {
    wboPencilPoint(pathData, point.x, point.y);
  });
  return pathData
    .map((segment) => `${segment.type} ${segment.values.join(" ")}`)
    .join(" ");
}

/**
 * @param {string | undefined} d
 * @returns {{type: string, values: number[]}[]}
 */
function parsePathData(d) {
  if (typeof d !== "string" || d.trim() === "") return [];
  /** @type {{type: string, values: number[]}[]} */
  const segments = [];
  const pattern = /([MLC])([^MLC]*)/g;
  let match = pattern.exec(d);
  while (match) {
    const type = match[1];
    const values = (match[2] || "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (
      type &&
      ["M", "L", "C"].includes(type) &&
      values.length > 0 &&
      values.every((value) => Number.isFinite(value))
    ) {
      segments.push({ type, values });
    }
    match = pattern.exec(d);
  }
  return segments;
}

/**
 * @param {string | undefined} d
 * @returns {{childCount: number, localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null}}
 */
function scanPathSummary(d) {
  if (typeof d !== "string" || d.trim() === "") {
    return { childCount: 0, localBounds: null };
  }
  let index = 0;
  let valuesPerSegment = 0;
  let valuesRead = 0;
  /** @type {number | undefined} */
  let endpointX;
  /** @type {number | undefined} */
  let endpointY;
  let childCount = 0;
  /** @type {{minX: number, minY: number, maxX: number, maxY: number} | null} */
  let localBounds = null;
  /** @type {number | undefined} */
  let previousX;
  /** @type {number | undefined} */
  let previousY;

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  function pushPoint(x, y) {
    if (previousX === x && previousY === y) return;
    previousX = x;
    previousY = y;
    childCount += 1;
    if (localBounds) {
      localBounds.minX = Math.min(localBounds.minX, x);
      localBounds.minY = Math.min(localBounds.minY, y);
      localBounds.maxX = Math.max(localBounds.maxX, x);
      localBounds.maxY = Math.max(localBounds.maxY, y);
      return;
    }
    localBounds = {
      minX: x,
      minY: y,
      maxX: x,
      maxY: y,
    };
  }

  while (index < d.length) {
    const char = d[index];
    if (char === "M" || char === "L" || char === "C") {
      valuesPerSegment = char === "C" ? 6 : 2;
      valuesRead = 0;
      endpointX = undefined;
      endpointY = undefined;
      index += 1;
      continue;
    }
    if (char === " " || char === "," || char === "\n" || char === "\t") {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < d.length) {
      const next = d[index];
      if (
        next === " " ||
        next === "," ||
        next === "\n" ||
        next === "\t" ||
        next === "M" ||
        next === "L" ||
        next === "C"
      ) {
        break;
      }
      index += 1;
    }
    const value = Number(d.slice(start, index));
    if (!Number.isFinite(value) || valuesPerSegment === 0) {
      continue;
    }
    if (valuesRead === valuesPerSegment - 2) {
      endpointX = value;
    } else if (valuesRead === valuesPerSegment - 1) {
      endpointY = value;
    }
    valuesRead += 1;
    if (valuesRead === valuesPerSegment) {
      if (endpointX !== undefined && endpointY !== undefined) {
        pushPoint(endpointX, endpointY);
      }
      valuesRead = 0;
      endpointX = undefined;
      endpointY = undefined;
    }
  }

  return { childCount, localBounds };
}

/**
 * @param {{type: string, values: number[]}[]} pathData
 * @returns {{x: number, y: number}[]}
 */
function pointsFromPathData(pathData) {
  /** @type {{x: number, y: number}[]} */
  const points = [];
  pathData.forEach((segment) => {
    if (!segment || !Array.isArray(segment.values)) return;
    const x = segment.values[segment.values.length - 2];
    const y = segment.values[segment.values.length - 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const previous = points[points.length - 1];
    const point = /** @type {{x: number, y: number}} */ ({ x, y });
    if (previous && previous.x === point.x && previous.y === point.y) return;
    points.push(point);
  });
  return points;
}

/**
 * @param {{tagName: string, attributes: {[name: string]: string}, content?: string}} entry
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
      const points = pointsFromPathData(parsePathData(entry.attributes?.d));
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
 * @param {{tagName: string, attributes: {[name: string]: string}, content?: string}} entry
 * @param {number} [paintOrder]
 * @returns {any | null}
 */
function summarizeStoredSvgItem(entry, paintOrder) {
  if (!entry || typeof entry.tagName !== "string") return null;
  const { attributes, id, opacity, transform } = readStoredSvgBase(entry);
  if (!id) return null;
  switch (entry.tagName) {
    case "rect": {
      const x = parseNumber(attributes.x);
      const y = parseNumber(attributes.y);
      const width = parseNumber(attributes.width);
      const height = parseNumber(attributes.height);
      const size = parseNumber(attributes["stroke-width"]);
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
            color: attributes.stroke || "#000000",
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
      const cx = parseNumber(attributes.cx);
      const cy = parseNumber(attributes.cy);
      const rx = parseNumber(attributes.rx);
      const ry = parseNumber(attributes.ry);
      const size = parseNumber(attributes["stroke-width"]);
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
            color: attributes.stroke || "#000000",
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
      const x1 = parseNumber(attributes.x1);
      const y1 = parseNumber(attributes.y1);
      const x2 = parseNumber(attributes.x2);
      const y2 = parseNumber(attributes.y2);
      const size = parseNumber(attributes["stroke-width"]);
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
            color: attributes.stroke || "#000000",
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
      const x = parseNumber(attributes.x);
      const y = parseNumber(attributes.y);
      const size = parseNumber(attributes["font-size"]);
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
            color: attributes.fill || "#000000",
          },
          opacity,
          transform,
        ),
        textLength,
        localBounds: textBoundsFromLength(x, y, size, textLength),
      };
    }
    case "path": {
      const size = parseNumber(attributes["stroke-width"]);
      const scanned = scanPathSummary(attributes.d);
      if (size === undefined || scanned.childCount === 0) return null;
      return {
        id,
        tool: "Pencil",
        data: decorateStoredItemData(
          {
            color: attributes.stroke || "#000000",
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
    case "Text":
      return (
        `<text id="${id}" x="${numberOrZero(item.x)}" y="${numberOrZero(item.y)}"` +
        ` font-size="${numberOrZero(item.size) | 0}" fill="${color}"${opacity}${transform}>` +
        `${escapeHtml(String(item.txt || ""))}</text>`
      );
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
