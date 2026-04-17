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
  if (!entry || typeof entry.tagName !== "string") return null;
  const attributes = entry.attributes || {};
  const id = typeof attributes.id === "string" ? attributes.id : undefined;
  if (!id) return null;
  const opacity = parseNumber(attributes.opacity);
  const transform = parseTransformAttribute(attributes.transform);
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
        x,
        y,
        x2: x + width,
        y2: y + height,
        color: attributes.stroke || "#000000",
        size,
        ...(opacity !== undefined ? { opacity } : {}),
        ...(transform ? { transform } : {}),
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
        x: cx - rx,
        y: cy - ry,
        x2: cx + rx,
        y2: cy + ry,
        color: attributes.stroke || "#000000",
        size,
        ...(opacity !== undefined ? { opacity } : {}),
        ...(transform ? { transform } : {}),
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
        x: x1,
        y: y1,
        x2,
        y2,
        color: attributes.stroke || "#000000",
        size,
        ...(opacity !== undefined ? { opacity } : {}),
        ...(transform ? { transform } : {}),
      };
    }
    case "text": {
      const x = parseNumber(attributes.x);
      const y = parseNumber(attributes.y);
      const size = parseNumber(attributes["font-size"]);
      if (x === undefined || y === undefined || size === undefined) {
        return null;
      }
      return {
        id,
        tool: "Text",
        x,
        y,
        color: attributes.fill || "#000000",
        size,
        txt: unescapeHtml(entry.content || ""),
        ...(opacity !== undefined ? { opacity } : {}),
        ...(transform ? { transform } : {}),
      };
    }
    case "path": {
      const size = parseNumber(attributes["stroke-width"]);
      const points = pointsFromPathData(parsePathData(attributes.d));
      if (size === undefined || points.length === 0) {
        return null;
      }
      return {
        id,
        tool: "Pencil",
        color: attributes.stroke || "#000000",
        size,
        _children: points,
        ...(opacity !== undefined ? { opacity } : {}),
        ...(transform ? { transform } : {}),
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
  parseTransformAttribute,
  pointsFromPathData,
  renderPencilPath,
  renderTransformAttribute,
  serializeStoredSvgItem,
};
