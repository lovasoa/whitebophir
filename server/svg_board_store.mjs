import fs from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { wboPencilPoint } from "../client-data/tools/pencil/wbo_pencil_point.js";
import { readConfiguration } from "./configuration.mjs";
import {
  STORED_SVG_FORMAT,
  createDefaultStoredSvgEnvelope,
  parseStoredSvgEnvelope,
  parseStoredSvgItems,
  serializeStoredSvgEnvelope,
  updateRootMetadata,
} from "./svg_envelope.mjs";

const DEFAULT_SVG_SIZE = 500;
const SVG_MARGIN = 400;
const BOARD_METADATA_KEY = "__wbo_meta__";

/** @typedef {{readonly: boolean}} BoardMetadata */

/** @returns {BoardMetadata} */
function defaultBoardMetadata() {
  return {
    readonly: false,
  };
}

/**
 * @param {any} metadata
 * @returns {BoardMetadata}
 */
function normalizeBoardMetadata(metadata) {
  return {
    readonly: metadata && metadata.readonly === true,
  };
}

/**
 * @param {string} name
 * @returns {string}
 */
function boardJsonPath(name) {
  return path.join(
    readConfiguration().HISTORY_DIR,
    `board-${encodeURIComponent(name)}.json`,
  );
}

/**
 * @param {string} name
 * @returns {string}
 */
function boardSvgPath(name) {
  return path.join(
    readConfiguration().HISTORY_DIR,
    `board-${encodeURIComponent(name)}.svg`,
  );
}

/**
 * @param {any} storedBoard
 * @returns {{board: {[name: string]: any}, metadata: BoardMetadata}}
 */
function parseLegacyStoredBoard(storedBoard) {
  if (
    !storedBoard ||
    typeof storedBoard !== "object" ||
    Array.isArray(storedBoard)
  ) {
    throw new Error("Invalid board file format");
  }

  /** @type {{[name: string]: any}} */
  const board = {};
  let metadata = defaultBoardMetadata();

  for (const [key, value] of Object.entries(storedBoard)) {
    if (key === BOARD_METADATA_KEY) {
      metadata = normalizeBoardMetadata(value);
    } else {
      board[key] = value;
    }
  }

  return { board, metadata };
}

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
 * @param {any} item
 * @returns {string}
 */
function encodeStoredItem(item) {
  return encodeURIComponent(JSON.stringify(item));
}

/**
 * @param {string} value
 * @returns {any}
 */
function decodeStoredItem(value) {
  return JSON.parse(decodeURIComponent(value));
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeStoredSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
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
 * @param {{[name: string]: any}} board
 * @param {BoardMetadata} metadata
 * @param {number} seq
 * @returns {string}
 */
function serializeStoredSvg(board, metadata, seq) {
  const items = Object.values(board).map((item) => {
    const tool = item && typeof item.tool === "string" ? item.tool : "Unknown";
    const id = item && typeof item.id === "string" ? item.id : "";
    return (
      `<g id="${escapeHtml(id)}" data-wbo-tool="${escapeHtml(tool)}"` +
      ` data-wbo-item="${escapeHtml(encodeStoredItem(item))}"` +
      `${renderTransformAttribute(item && item.transform)}></g>`
    );
  });
  const envelope = createDefaultStoredSvgEnvelope(metadata, seq);
  return serializeStoredSvgEnvelope(envelope.prefix, items, envelope.suffix);
}

/**
 * @param {string} svg
 * @returns {{board: {[name: string]: any}, metadata: BoardMetadata, seq: number}}
 */
function parseStoredSvg(svg) {
  const envelope = parseStoredSvgEnvelope(svg);
  const rootAttributes = envelope.rootAttributes;
  if (rootAttributes["data-wbo-format"] !== STORED_SVG_FORMAT) {
    throw new Error("Unsupported stored SVG format");
  }
  /** @type {{[name: string]: any}} */
  const board = {};
  for (const itemEntry of parseStoredSvgItems(envelope.drawingAreaContent)) {
    const attributes = itemEntry.attributes;
    const encodedItem = attributes["data-wbo-item"];
    if (encodedItem) {
      const item = decodeStoredItem(encodedItem);
      if (!item.transform) {
        const parsedTransform = parseTransformAttribute(attributes.transform);
        if (parsedTransform) item.transform = parsedTransform;
      }
      const id =
        item && typeof item.id === "string"
          ? item.id
          : attributes.id || undefined;
      if (id) {
        item.id = id;
        board[id] = item;
      }
    }
  }
  return {
    board,
    metadata: {
      readonly: rootAttributes["data-wbo-readonly"] === "true",
    },
    seq: normalizeStoredSeq(rootAttributes["data-wbo-seq"]),
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
 * @param {any} item
 * @returns {string}
 */
function renderVisibleItem(item) {
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

/**
 * @param {{[name: string]: any}} board
 * @returns {{width: number, height: number}}
 */
function computeBoardDimensions(board) {
  const values = Object.values(board);
  const maxPoint = values.reduce(
    (current, item) => {
      if (!item || typeof item !== "object") return current;
      switch (item.tool) {
        case "Rectangle":
        case "Ellipse":
        case "Straight line":
          return {
            x: Math.max(current.x, numberOrZero(item.x), numberOrZero(item.x2)),
            y: Math.max(current.y, numberOrZero(item.y), numberOrZero(item.y2)),
          };
        case "Text":
          return {
            x: Math.max(current.x, numberOrZero(item.x)),
            y: Math.max(current.y, numberOrZero(item.y)),
          };
        case "Pencil": {
          /** @type {Array<{x?: unknown, y?: unknown}>} */
          const points = Array.isArray(item._children) ? item._children : [];
          return points.reduce(
            (
              /** @type {{x: number, y: number}} */ pointCurrent,
              /** @type {{x?: unknown, y?: unknown}} */ point,
            ) => ({
              x: Math.max(pointCurrent.x, numberOrZero(point?.x)),
              y: Math.max(pointCurrent.y, numberOrZero(point?.y)),
            }),
            current,
          );
        }
        default:
          return current;
      }
    },
    { x: DEFAULT_SVG_SIZE - SVG_MARGIN, y: DEFAULT_SVG_SIZE - SVG_MARGIN },
  );
  return {
    width: Math.max(DEFAULT_SVG_SIZE, Math.ceil(maxPoint.x + SVG_MARGIN)),
    height: Math.max(DEFAULT_SVG_SIZE, Math.ceil(maxPoint.y + SVG_MARGIN)),
  };
}

/**
 * @param {{[name: string]: any}} board
 * @param {BoardMetadata} metadata
 * @param {number} seq
 * @returns {string}
 */
function renderServedBaselineSvg(board, metadata, seq) {
  const dimensions = computeBoardDimensions(board);
  return (
    `<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1"` +
    ` width="${dimensions.width}" height="${dimensions.height}"` +
    ` data-wbo-format="${STORED_SVG_FORMAT}" data-wbo-seq="${seq}"` +
    ` data-wbo-readonly="${metadata.readonly ? "true" : "false"}">` +
    `<defs id="defs"><style type="text/css"><![CDATA[` +
    `text {font-family:"Arial"}` +
    `path {fill:none;stroke-linecap:round;stroke-linejoin:round;}` +
    `rect {fill:none}` +
    `ellipse {fill:none}` +
    `line {fill:none}` +
    `]]></style></defs>` +
    `<g id="drawingArea">` +
    Object.values(board)
      .map((item) => renderVisibleItem(item))
      .join("") +
    `</g>` +
    `<g id="cursors"></g>` +
    `</svg>`
  );
}

/**
 * @param {string} boardName
 * @returns {Promise<{board: {[name: string]: any}, metadata: BoardMetadata, seq: number, source: "svg" | "json" | "empty"}>}
 */
async function readBoardState(boardName) {
  try {
    const svg = await readFile(boardSvgPath(boardName), "utf8");
    const parsed = parseStoredSvg(svg);
    return { ...parsed, source: "svg" };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  try {
    const jsonText = await readFile(boardJsonPath(boardName), "utf8");
    const parsed = parseLegacyStoredBoard(JSON.parse(jsonText));
    return {
      board: parsed.board,
      metadata: parsed.metadata,
      seq: 0,
      source: "json",
    };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  return {
    board: {},
    metadata: defaultBoardMetadata(),
    seq: 0,
    source: "empty",
  };
}

/**
 * @param {string} boardName
 * @param {{[name: string]: any}} board
 * @param {BoardMetadata} metadata
 * @param {number} seq
 * @returns {Promise<void>}
 */
async function writeBoardState(boardName, board, metadata, seq) {
  const file = boardSvgPath(boardName);
  const tmpFile = `${file}.${Date.now()}.tmp`;
  if (Object.keys(board).length === 0) {
    for (const emptyPath of [file, boardJsonPath(boardName)]) {
      try {
        await fs.promises.unlink(emptyPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }
    }
    return;
  }
  /** @type {string} */
  let svg;
  try {
    const existingSvg = await readFile(file, "utf8");
    const parsed = parseStoredSvgEnvelope(existingSvg);
    const prefix = updateRootMetadata(parsed.prefix, metadata, seq);
    const itemTags = Object.values(board).map((item) => {
      const tool =
        item && typeof item.tool === "string" ? item.tool : "Unknown";
      const id = item && typeof item.id === "string" ? item.id : "";
      return (
        `<g id="${escapeHtml(id)}" data-wbo-tool="${escapeHtml(tool)}"` +
        ` data-wbo-item="${escapeHtml(encodeStoredItem(item))}"` +
        `${renderTransformAttribute(item && item.transform)}></g>`
      );
    });
    svg = serializeStoredSvgEnvelope(prefix, itemTags, parsed.suffix);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      try {
        svg = serializeStoredSvg(board, metadata, seq);
      } catch {
        throw error;
      }
    } else {
      svg = serializeStoredSvg(board, metadata, seq);
    }
  }
  await writeFile(tmpFile, svg, { flag: "wx" });
  await rename(tmpFile, file);
}

/**
 * @param {string} boardName
 * @returns {Promise<{readonly: boolean}>}
 */
async function readBoardMetadata(boardName) {
  const state = await readBoardState(boardName);
  return state.metadata;
}

/**
 * @param {string} boardName
 * @returns {{readonly: boolean}}
 */
function readBoardMetadataSync(boardName) {
  try {
    const svg = fs.readFileSync(boardSvgPath(boardName), "utf8");
    return parseStoredSvg(svg).metadata;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      // fall through to json fallback
    }
  }
  try {
    const jsonText = fs.readFileSync(boardJsonPath(boardName), "utf8");
    return parseLegacyStoredBoard(JSON.parse(jsonText)).metadata;
  } catch {
    return defaultBoardMetadata();
  }
}

/**
 * @param {string} boardName
 * @returns {Promise<string>}
 */
async function readBoardDownload(boardName) {
  try {
    return await readFile(boardSvgPath(boardName), "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return readFile(boardJsonPath(boardName), "utf8");
}

/**
 * @param {string} boardName
 * @returns {Promise<string>}
 */
async function readServedBaseline(boardName) {
  const state = await readBoardState(boardName);
  return renderServedBaselineSvg(state.board, state.metadata, state.seq);
}

/**
 * @param {string} boardName
 * @returns {Promise<Readable>}
 */
async function streamServedBaseline(boardName) {
  return Readable.from([await readServedBaseline(boardName)]);
}

export {
  STORED_SVG_FORMAT,
  boardJsonPath,
  boardSvgPath,
  defaultBoardMetadata,
  normalizeBoardMetadata,
  parseLegacyStoredBoard,
  parseStoredSvg,
  readBoardDownload,
  readBoardMetadata,
  readBoardMetadataSync,
  readBoardState,
  readServedBaseline,
  renderServedBaselineSvg,
  serializeStoredSvg,
  streamServedBaseline,
  writeBoardState,
};
