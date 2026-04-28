import fsp from "node:fs/promises";
import path from "node:path";

import MessageCommon from "../../client-data/js/message_common.js";
import { TOOL_BY_ID } from "../../client-data/tools/index.js";
import { parseLegacyStoredBoard } from "./legacy_json_board_source.mjs";
import observability from "../observability/index.mjs";

const { logger, tracing } = observability;
const STANDALONE_SVG_RENDER_BYTES_THRESHOLD = 1024 * 1024;

/** @typedef {{x: number, y: number}} Point */
/** @typedef {{tool: string, id?: string, color?: string, size?: number, opacity?: number, deltax?: number, deltay?: number, txt?: string, _children?: Point[], x?: number, y?: number, x2?: number, y2?: number}} RenderableElement */
/** @typedef {{[name: string]: RenderableElement}} RenderableBoard */
/** @typedef {{write: (chunk: string) => void}} WritableTarget */
/** @typedef {import("../../client-data/tools/shape_contract.js").StoredShapeItem} StoredShapeItem */

/**
 * @param {unknown} value
 * @returns {number}
 */
function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
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
 * @param {StoredShapeItem} el
 * @returns {string}
 */
function renderTranslate(el) {
  const deltax = numberOrZero(el.deltax);
  const deltay = numberOrZero(el.deltay);
  if (deltax === 0 && deltay === 0) return "";
  return `transform="translate(${deltax},${deltay})"`;
}

/**
 * @param {StoredShapeItem} el
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
 * Writes the given board as an svg to the given writeable stream
 * @param {RenderableBoard} obj
 * @param {WritableTarget} writeable
 * @returns {Promise<void>}
 */
async function toSVG(obj, writeable) {
  const margin = 4000;
  const elems = Object.values(obj);
  const dim = elems.reduce(
    /**
     * @param {[number, number]} dim
     * @param {RenderableElement} elem
     * @returns {[number, number]}
     */
    (dim, elem) => {
      const bounds = MessageCommon.getLocalGeometryBounds(elem);
      if (!bounds) return dim;
      return [
        Math.max(
          (bounds.maxX + margin + (numberOrZero(elem.deltax) | 0)) | 0,
          dim[0],
        ),
        Math.max(
          (bounds.maxY + margin + (numberOrZero(elem.deltay) | 0)) | 0,
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
    const contract = TOOL_BY_ID[elem.tool];
    if (typeof contract?.renderBoardSvg === "function") {
      writeable.write(
        contract.renderBoardSvg(elem, {
          htmlspecialchars,
          numberOrZero,
          renderPath,
          renderTranslate,
        }),
      );
    } else {
      logger.warn("svg.renderer_missing", {
        tool: elem.tool,
      });
    }
  }
  writeable.write("</svg>");
}

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function renderBoardToSVG(file) {
  let traceRoot = false;
  try {
    traceRoot =
      (await fsp.stat(file)).size >= STANDALONE_SVG_RENDER_BYTES_THRESHOLD;
  } catch {}
  return tracing.withExpensiveActiveSpan(
    "board.svg_render",
    {
      attributes: {
        "wbo.board.operation": "svg_render",
      },
      traceRoot: traceRoot,
    },
    async () => {
      const data = await fsp.readFile(file, "utf8");
      /** @type {RenderableBoard} */
      const board = /** @type {RenderableBoard} */ (
        parseLegacyStoredBoard(JSON.parse(data)).board
      );
      /** @type {string[]} */
      const chunks = [];
      await toSVG(board, {
        write: (chunk) => {
          chunks.push(chunk);
        },
      });
      const svg = chunks.join("");
      tracing.setActiveSpanAttributes({
        "file.size": data.length,
        "wbo.board.items": Object.keys(board).length,
        "wbo.svg.size": svg.length,
      });
      return svg;
    },
  );
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
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.join(process.cwd(), "server", "persistence", "create_svg.mjs");

if (isMainModule) {
  const historyFile =
    process.argv[2] ||
    path.join(process.cwd(), "server-data", "board-anonymous.json");

  renderBoard(historyFile, process.stdout).catch((error) => {
    logger.error("svg.render_failed", {
      error,
    });
  });
}
