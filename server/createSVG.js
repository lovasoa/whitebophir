const fsp = require("node:fs/promises"),
  path = require("node:path"),
  parseStoredBoard = require("./boardData.js").parseStoredBoard,
  wboPencilPoint =
    require("../client-data/tools/pencil/wbo_pencil_point.js").wboPencilPoint;

/** @typedef {{x: number, y: number}} Point */
/** @typedef {{type: string, values: number[]}} PathOperation */
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
 * @param {unknown} str
 * @returns {string}
 */
function htmlspecialchars(str) {
  if (typeof str !== "string") return "";

  return str.replace(/[<>&"']/g, function (c) {
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
  return 'transform="translate(' + deltax + "," + deltay + ')"';
}

/**
 * @param {ElementStyle} el
 * @param {string} pathstring
 * @returns {string}
 */
function renderPath(el, pathstring) {
  return (
    "<path " +
    (el.id ? 'id="' + htmlspecialchars(el.id) + '" ' : "") +
    'stroke-width="' +
    (numberOrZero(el.size) | 0) +
    '" ' +
    (el.opacity ? 'opacity="' + numberOrZero(el.opacity) + '" ' : "") +
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

/** @type {{[tool: string]: ToolRenderer}} */
const Tools = {
  /**
   * @param {RenderableElement} el
   * @return {string}
   */
  Text: function (el) {
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
  Pencil: function (el) {
    if (el.tool !== "Pencil") return "";
    /** @type {PencilElement} */
    const pencil = el;
    if (!pencil._children) return "";
    /** @type {PathOperation[]} */
    let pts = pencil._children.reduce(
      /**
       * @param {PathOperation[]} pts
       * @param {Point} point
       * @returns {PathOperation[]}
       */
      function (pts, point) {
        return wboPencilPoint(pts, point.x, point.y);
      },
      /** @type {PathOperation[]} */ ([]),
    );
    const pathstring = pts
      .map(function (op) {
        return op.type + " " + op.values.join(" ");
      })
      .join(" ");
    return renderPath(pencil, pathstring);
  },
  /**
   * @param {RenderableElement} el
   * @return {string}
   */
  Rectangle: function (el) {
    if (el.tool !== "Rectangle") return "";
    /** @type {ShapeElement} */
    const shape = el;
    const bounds = normalizeRectBounds(shape.x, shape.y, shape.x2, shape.y2);
    return (
      "<rect " +
      (shape.id ? 'id="' + htmlspecialchars(shape.id) + '" ' : "") +
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
  Ellipse: function (el) {
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
  "Straight line": function (el) {
    if (el.tool !== "Straight line") return "";
    /** @type {ShapeElement} */
    const shape = el;
    const pathstring =
      "M" + shape.x + " " + shape.y + "L" + shape.x2 + " " + shape.y2;
    return renderPath(shape, pathstring);
  },
};

/**
 * @param {RenderableElement} elem
 * @returns {Point | null}
 */
function originPointForBounds(elem) {
  if (elem.tool === "Pencil") {
    const firstPoint = elem._children && elem._children[0];
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
    function (dim, elem) {
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
  await Promise.all(
    elems.map(async function (elem) {
      await Promise.resolve(); // Do not block the event loop
      const renderFun = Tools[elem.tool];
      if (renderFun) writeable.write(renderFun(elem));
      else console.warn("Missing render function for tool", elem.tool);
    }),
  );
  writeable.write("</svg>");
}

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
async function renderBoardToSVG(file) {
  const data = await fsp.readFile(file, "utf8");
  /** @type {RenderableBoard} */
  var board = /** @type {RenderableBoard} */ (
    parseStoredBoard(JSON.parse(data)).board
  );
  /** @type {string[]} */
  const chunks = [];
  await toSVG(board, {
    write: function (chunk) {
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
async function renderBoard(file, stream) {
  const svg = await renderBoardToSVG(file);
  stream.write(svg);
}

if (require.main === module) {
  const config = require("./configuration.js");
  const HISTORY_FILE =
    process.argv[2] || path.join(config.HISTORY_DIR, "board-anonymous.json");

  renderBoard(HISTORY_FILE, process.stdout).catch(console.error.bind(console));
} else {
  module.exports = {
    renderBoard: renderBoard,
    renderBoardToSVG: renderBoardToSVG,
  };
}
