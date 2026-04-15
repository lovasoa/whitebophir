import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseStoredBoard } from "./boardData.js";
import { logger } from "./observability.js";
import config from "./configuration.js";

/** @typedef {{x: number, y: number}} Point */
/** @typedef {{tool: string, id?: string, color?: string, size?: number, opacity?: number, deltax?: number, deltay?: number}} ElementStyle */
/** @typedef {ElementStyle & {tool: "Text", x: number, y: number, txt?: string}} TextElement */
/** @typedef {ElementStyle & {tool: "Pencil", _children?: Point[]}} PencilElement */
/** @typedef {ElementStyle & {tool: "Rectangle" | "Ellipse" | "Straight line", x: number, y: number, x2: number, y2: number}} ShapeElement */
/** @typedef {TextElement | PencilElement | ShapeElement} RenderableElement */
/** @typedef {{[name: string]: RenderableElement}} RenderableBoard */
/** @typedef {{write: (chunk: string) => void}} WritableTarget */
/** @typedef {(element: RenderableElement) => string} ToolRenderer */

/**
 * @param {number | undefined} value
 * @returns {number}
 */
function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function normalizeRectBounds(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * @param {unknown} str
 * @returns {string}
 */
function htmlspecialchars(str) {
  if (typeof str !== "string") return "";

  return str.replace(/[<>&"']/g, (c) => {
    switch (c) {
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
        return c;
    }
  });
}

/**
 * @param {ElementStyle} el
 * @returns {string}
 */
function renderTranslate(el) {
  const deltax = numberOrZero(el.deltax);
  const deltay = numberOrZero(el.deltay);
  if (deltax === 0 && deltay === 0) return "";
  return `transform="translate(${deltax},${deltay})"`;
}

/**
 * @param {ElementStyle} el
 * @param {string} pathstring
 * @returns {string}
 */
function renderPath(el, pathstring) {
  return (
    "<path " +
    (el.id ? `id="${htmlspecialchars(el.id)}" ` : "") +
    'stroke-width="' +
    (numberOrZero(el.size) | 0) +
    '" ' +
    (el.opacity ? `opacity="${numberOrZero(el.opacity)}" ` : "") +
    'stroke="' +
    htmlspecialchars(el.color) +
    '" ' +
    'd="' +
    pathstring +
    '" ' +
    renderTranslate(el) +
    "/>"
  );
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function renderMoveTo(x, y) {
  return `M ${x} ${y}`;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function renderLineTo(x, y) {
  return `L ${x} ${y}`;
}

/**
 * @param {number} c1x
 * @param {number} c1y
 * @param {number} c2x
 * @param {number} c2y
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function renderCurveTo(c1x, c1y, c2x, c2y, x, y) {
  return `C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`;
}

/**
 * @param {Point[] | undefined} children
 * @returns {string}
 */
function renderPencilPath(children) {
  if (!children || children.length === 0) return "";

  const firstPoint = children[0];
  if (!firstPoint) return "";

  /** @type {string[]} */
  const pathParts = [
    renderMoveTo(firstPoint.x, firstPoint.y),
    renderLineTo(firstPoint.x, firstPoint.y),
  ];
  let pointCount = 1;
  let anteX = firstPoint.x;
  let anteY = firstPoint.y;
  let prevX = firstPoint.x;
  let prevY = firstPoint.y;
  let previousCurveIndex = -1;
  let previousCurveControlX = firstPoint.x;
  let previousCurveControlY = firstPoint.y;

  for (let index = 1; index < children.length; index++) {
    const point = children[index];
    if (!point) continue;

    const x = point.x;
    const y = point.y;
    if (pointCount === 1) {
      pathParts.push(renderCurveTo(firstPoint.x, firstPoint.y, x, y, x, y));
      previousCurveIndex = pathParts.length - 1;
      previousCurveControlX = firstPoint.x;
      previousCurveControlY = firstPoint.y;
      anteX = firstPoint.x;
      anteY = firstPoint.y;
      prevX = x;
      prevY = y;
      pointCount = 2;
      continue;
    }

    if ((prevX === x && prevY === y) || (anteX === x && anteY === y)) {
      continue;
    }

    const vectorX = x - anteX;
    const vectorY = y - anteY;
    const norm = Math.hypot(vectorX, vectorY);
    if (norm === 0) continue;

    const scaledVectorX = vectorX / 3;
    const scaledVectorY = vectorY / 3;
    const dist1 = dist(anteX, anteY, prevX, prevY) / norm;
    const dist2 = dist(x, y, prevX, prevY) / norm;
    const control1X = prevX - dist1 * scaledVectorX;
    const control1Y = prevY - dist1 * scaledVectorY;
    const control2X = prevX + dist2 * scaledVectorX;
    const control2Y = prevY + dist2 * scaledVectorY;

    if (previousCurveIndex !== -1) {
      pathParts[previousCurveIndex] = renderCurveTo(
        previousCurveControlX,
        previousCurveControlY,
        control1X,
        control1Y,
        prevX,
        prevY,
      );
    }
    pathParts.push(renderCurveTo(control2X, control2Y, x, y, x, y));
    previousCurveIndex = pathParts.length - 1;
    previousCurveControlX = control2X;
    previousCurveControlY = control2Y;
    anteX = prevX;
    anteY = prevY;
    prevX = x;
    prevY = y;
    pointCount += 1;
  }

  return pathParts.join(" ");
}

/** @type {{[tool: string]: ToolRenderer}} */
const Tools = {
  /**
   * @param {RenderableElement} el
   * @return {string}
   */
  Text: (el) => {
    if (el.tool !== "Text") return "";
    /** @type {TextElement} */
    const text = el;
    return (
      "<text " +
      'id="' +
      htmlspecialchars(text.id || "t") +
      '" ' +
      'x="' +
      (text.x | 0) +
      '" ' +
      'y="' +
      (text.y | 0) +
      '" ' +
      'font-size="' +
      (numberOrZero(text.size) | 0) +
      '" ' +
      'fill="' +
      htmlspecialchars(text.color || "#000") +
      '" ' +
      renderTranslate(text) +
      ">" +
      htmlspecialchars(text.txt || "") +
      "</text>"
    );
  },
  /**
   * @param {RenderableElement} el
   * @return {string}
   */
  Pencil: (el) => {
    if (el.tool !== "Pencil") return "";
    /** @type {PencilElement} */
    const pencil = el;
    const pathstring = renderPencilPath(pencil._children);
    if (pathstring === "") return "";
    return renderPath(pencil, pathstring);
  },
  /**
   * @param {RenderableElement} el
   * @return {string}
   */
  Rectangle: (el) => {
    if (el.tool !== "Rectangle") return "";
    /** @type {ShapeElement} */
    const shape = el;
    const bounds = normalizeRectBounds(shape.x, shape.y, shape.x2, shape.y2);
    return (
      "<rect " +
      (shape.id ? `id="${htmlspecialchars(shape.id)}" ` : "") +
      'x="' +
      bounds.x +
      '" ' +
      'y="' +
      bounds.y +
      '" ' +
      'width="' +
      bounds.width +
      '" ' +
      'height="' +
      bounds.height +
      '" ' +
      'stroke="' +
      htmlspecialchars(shape.color) +
      '" ' +
      'stroke-width="' +
      (numberOrZero(shape.size) | 0) +
      '" ' +
      renderTranslate(shape) +
      "/>"
    );
  },
  /**
   * @param {RenderableElement} el
   * @return {string}
   */
  Ellipse: (el) => {
    if (el.tool !== "Ellipse") return "";
    /** @type {ShapeElement} */
    const shape = el;
    const cx = Math.round((shape.x2 + shape.x) / 2);
    const cy = Math.round((shape.y2 + shape.y) / 2);
    const rx = Math.abs(shape.x2 - shape.x) / 2;
    const ry = Math.abs(shape.y2 - shape.y) / 2;
    const pathstring =
      "M" +
      (cx - rx) +
      " " +
      cy +
      "a" +
      rx +
      "," +
      ry +
      " 0 1,0 " +
      rx * 2 +
      ",0" +
      "a" +
      rx +
      "," +
      ry +
      " 0 1,0 " +
      rx * -2 +
      ",0";
    return renderPath(shape, pathstring);
  },
  /**
   * @param {RenderableElement} el
   * @return {string}
   */
  "Straight line": (el) => {
    if (el.tool !== "Straight line") return "";
    /** @type {ShapeElement} */
    const shape = el;
    const pathstring = `M${shape.x} ${shape.y}L${shape.x2} ${shape.y2}`;
    return renderPath(shape, pathstring);
  },
};

/**
 * @param {RenderableElement} elem
 * @returns {Point | null}
 */
function originPointForBounds(elem) {
  if (elem.tool === "Pencil") {
    const firstPoint = elem._children?.[0];
    return firstPoint || null;
  }
  if (elem.tool === "Text") {
    return { x: elem.x, y: elem.y };
  }
  return { x: elem.x, y: elem.y };
}

/**
 * Writes the given board as an svg to the given writeable stream
 * @param {RenderableBoard} obj
 * @param {WritableTarget} writeable
 * @returns {Promise<void>}
 */
async function toSVG(obj, writeable) {
  const margin = 400;
  const elems = Object.values(obj);
  const dim = elems.reduce(
    /**
     * @param {[number, number]} dim
     * @param {RenderableElement} elem
     * @returns {[number, number]}
     */
    (dim, elem) => {
      const point = originPointForBounds(elem);
      if (!point) return dim;
      return [
        Math.max(
          (point.x + margin + (numberOrZero(elem.deltax) | 0)) | 0,
          dim[0],
        ),
        Math.max(
          (point.y + margin + (numberOrZero(elem.deltay) | 0)) | 0,
          dim[1],
        ),
      ];
    },
    /** @type {[number, number]} */ ([margin, margin]),
  );
  writeable.write(
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
      'width="' +
      dim[0] +
      '" height="' +
      dim[1] +
      '">' +
      '<defs><style type="text/css"><![CDATA[' +
      'text {font-family:"Arial"}' +
      "path {fill:none;stroke-linecap:round;stroke-linejoin:round;}" +
      "rect {fill:none}" +
      "]]></style></defs>",
  );
  for (let index = 0; index < elems.length; index++) {
    if (index > 0 && index % 128 === 0) {
      await Promise.resolve();
    }
    const elem = elems[index];
    if (!elem) continue;
    const renderFun = Tools[elem.tool];
    if (renderFun) writeable.write(renderFun(elem));
    else
      logger.warn("svg.renderer_missing", {
        tool: elem.tool,
      });
  }
  writeable.write("</svg>");
}

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function renderBoardToSVG(file) {
  const data = await fsp.readFile(file, "utf8");
  /** @type {RenderableBoard} */
  const board = /** @type {RenderableBoard} */ (
    parseStoredBoard(JSON.parse(data)).board
  );
  /** @type {string[]} */
  const chunks = [];
  await toSVG(board, {
    write: (chunk) => {
      chunks.push(chunk);
    },
  });
  return chunks.join("");
}

/**
 * @param {string} file
 * @param {WritableTarget} stream
 * @returns {Promise<void>}
 */
export async function renderBoard(file, stream) {
  const svg = await renderBoardToSVG(file);
  stream.write(svg);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const historyFile =
    process.argv[2] || path.join(config.HISTORY_DIR, "board-anonymous.json");

  renderBoard(historyFile, process.stdout).catch((error) => {
    logger.error("svg.render_failed", {
      error,
    });
  });
}
