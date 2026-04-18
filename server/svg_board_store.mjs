import fs from "node:fs";
import { once } from "node:events";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { wboPencilPoint } from "../client-data/tools/pencil/wbo_pencil_point.js";
import { readConfiguration } from "./configuration.mjs";
import {
  boardJsonPath,
  parseLegacyStoredBoard,
  readLegacyBoardState,
} from "./legacy_json_board_source.mjs";
import { streamingUpdate } from "./streaming_stored_svg_update.mjs";
import {
  STORED_SVG_FORMAT,
  createDefaultStoredSvgEnvelope,
  parseAttributes,
  parseStoredSvgEnvelope,
  parseStoredSvgItems,
  serializeStoredSvgEnvelope,
  updateRootMetadata,
} from "./svg_envelope.mjs";
import {
  parseStoredSvgItem,
  serializeStoredSvgItem,
  summarizeStoredSvgItem,
} from "./stored_svg_item_codec.mjs";
import { streamStoredSvgStructure } from "./streaming_stored_svg_scan.mjs";

const DEFAULT_SVG_SIZE = 500;
const SVG_MARGIN = 400;
let tempSvgSuffixCounter = 0;

/** @typedef {{readonly: boolean}} BoardMetadata */

/** @returns {BoardMetadata} */
function defaultBoardMetadata() {
  return {
    readonly: false,
  };
}

/**
 * @param {string | undefined} historyDir
 * @returns {string}
 */
function resolveHistoryDir(historyDir) {
  return historyDir || readConfiguration().HISTORY_DIR;
}

/**
 * @param {string} name
 * @param {string} [historyDir]
 * @returns {string}
 */
function boardSvgPath(name, historyDir) {
  return path.join(
    resolveHistoryDir(historyDir),
    `board-${encodeURIComponent(name)}.svg`,
  );
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
 * @param {string} file
 * @returns {string}
 */
function createTempSvgPath(file) {
  tempSvgSuffixCounter = (tempSvgSuffixCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${file}.${Date.now()}.${tempSvgSuffixCounter}.tmp`;
}

/**
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function fileExists(file) {
  try {
    await fs.promises.access(file);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * @param {number} expectedSeq
 * @param {number} actualSeq
 * @returns {Error & {code: string}}
 */
function createStoredSvgSeqMismatchError(expectedSeq, actualSeq) {
  const error = /** @type {Error & {code: string}} */ (
    new Error(
      `Stored SVG seq mismatch: expected ${expectedSeq}, got ${actualSeq}`,
    )
  );
  error.code = "WBO_STORED_SVG_SEQ_MISMATCH";
  return error;
}

/**
 * @param {{[name: string]: any}} board
 * @param {BoardMetadata} metadata
 * @param {number} seq
 * @returns {string}
 */
function serializeStoredSvg(board, metadata, seq) {
  const items = Object.values(board).map((item) =>
    serializeStoredSvgItem(item),
  );
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
    const item = parseStoredSvgItem(itemEntry);
    const id = item?.id;
    if (id) board[id] = item;
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
 * @param {string} svg
 * @returns {{summaries: Map<string, any>, metadata: BoardMetadata, seq: number}}
 */
function summarizeStoredSvg(svg) {
  const envelope = parseStoredSvgEnvelope(svg);
  const rootAttributes = envelope.rootAttributes;
  if (rootAttributes["data-wbo-format"] !== STORED_SVG_FORMAT) {
    throw new Error("Unsupported stored SVG format");
  }
  const summaries = new Map();
  let paintOrder = 0;
  for (const itemEntry of parseStoredSvgItems(envelope.drawingAreaContent)) {
    const summary = summarizeStoredSvgItem(itemEntry, paintOrder);
    if (!summary?.id) continue;
    summaries.set(summary.id, summary);
    paintOrder += 1;
  }
  return {
    summaries,
    metadata: {
      readonly: rootAttributes["data-wbo-readonly"] === "true",
    },
    seq: normalizeStoredSeq(rootAttributes["data-wbo-seq"]),
  };
}

/**
 * @param {string} prefix
 * @returns {{[name: string]: string}}
 */
function parseRootAttributesFromPrefix(prefix) {
  const svgStart = prefix.indexOf("<svg");
  if (svgStart === -1) throw new Error("Missing <svg> root");
  const openTagEnd = prefix.indexOf(">", svgStart);
  if (openTagEnd === -1) throw new Error("Unterminated <svg> root");
  return parseAttributes(prefix.slice(svgStart + 4, openTagEnd));
}

/**
 * @param {string} file
 * @returns {Promise<{summaries: Map<string, any>, metadata: BoardMetadata, seq: number}>}
 */
async function summarizeStoredSvgFile(file) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  /** @type {{[name: string]: string} | null} */
  let rootAttributes = null;
  const summaries = new Map();
  let paintOrder = 0;

  for await (const event of streamStoredSvgStructure(stream)) {
    if (event.type === "prefix") {
      rootAttributes = parseRootAttributesFromPrefix(event.prefix);
      if (rootAttributes["data-wbo-format"] !== STORED_SVG_FORMAT) {
        throw new Error("Unsupported stored SVG format");
      }
      continue;
    }
    if (event.type !== "item") continue;
    const summary = summarizeStoredSvgItem(event.entry, paintOrder);
    if (!summary?.id) continue;
    summaries.set(summary.id, summary);
    paintOrder += 1;
  }

  if (!rootAttributes) {
    throw new Error("Missing <svg> root");
  }

  return {
    summaries,
    metadata: {
      readonly: rootAttributes["data-wbo-readonly"] === "true",
    },
    seq: normalizeStoredSeq(rootAttributes["data-wbo-seq"]),
  };
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
      .map((item) => serializeStoredSvgItem(item))
      .join("") +
    `</g>` +
    `<g id="cursors"></g>` +
    `</svg>`
  );
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<{board: {[name: string]: any}, metadata: BoardMetadata, seq: number, source: "svg" | "json" | "empty"}>}
 */
async function readBoardState(boardName, options) {
  const historyDir = options?.historyDir;
  try {
    const svg = await readFile(boardSvgPath(boardName, historyDir), "utf8");
    const parsed = parseStoredSvg(svg);
    return { ...parsed, source: "svg" };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  try {
    const parsed = await readLegacyBoardState(boardName, {
      historyDir: historyDir,
    });
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
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<{board?: {[name: string]: any}, summaries: Map<string, any>, metadata: BoardMetadata, seq: number, source: "svg" | "json" | "empty", byteLength: number}>}
 */
async function readBoardLoadState(boardName, options) {
  const historyDir = options?.historyDir;
  try {
    const file = boardSvgPath(boardName, historyDir);
    const [fileStat, parsed] = await Promise.all([
      stat(file),
      summarizeStoredSvgFile(file),
    ]);
    return { ...parsed, source: "svg", byteLength: fileStat.size };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  try {
    const parsed = await readLegacyBoardState(boardName, {
      historyDir: historyDir,
    });
    return {
      board: parsed.board,
      summaries: new Map(),
      metadata: parsed.metadata,
      seq: 0,
      source: "json",
      byteLength: 0,
    };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  return {
    summaries: new Map(),
    metadata: defaultBoardMetadata(),
    seq: 0,
    source: "empty",
    byteLength: 0,
  };
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<boolean>}
 */
async function boardExists(boardName, options) {
  const historyDir = options?.historyDir;
  return (
    (await fileExists(boardSvgPath(boardName, historyDir))) ||
    (await fileExists(boardJsonPath(boardName, historyDir)))
  );
}

/**
 * @param {string} boardName
 * @param {{[name: string]: any}} board
 * @param {BoardMetadata} metadata
 * @param {number} seq
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<void>}
 */
async function writeBoardState(boardName, board, metadata, seq, options) {
  const historyDir = options?.historyDir;
  const file = boardSvgPath(boardName, historyDir);
  const tmpFile = createTempSvgPath(file);
  if (Object.keys(board).length === 0) {
    for (const emptyPath of [file, boardJsonPath(boardName, historyDir)]) {
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
    const itemTags = Object.values(board).map((item) =>
      serializeStoredSvgItem(item),
    );
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
 * @param {Set<string>} ids
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<Map<string, any>>}
 */
async function parseBoardItems(boardName, ids, options) {
  if (!(ids instanceof Set) || ids.size === 0) {
    return new Map();
  }
  const historyDir = options?.historyDir;
  try {
    const stream = fs.createReadStream(boardSvgPath(boardName, historyDir), {
      encoding: "utf8",
    });
    const items = new Map();
    for await (const event of streamStoredSvgStructure(stream)) {
      if (event.type !== "item") continue;
      const id = event.entry.attributes.id;
      if (!id || !ids.has(id)) continue;
      const item = parseStoredSvgItem(event.entry);
      if (item) items.set(id, item);
      if (items.size === ids.size) {
        stream.destroy();
        break;
      }
    }
    return items;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  try {
    const parsed = await readLegacyBoardState(boardName, {
      historyDir: historyDir,
    });
    return new Map(
      [...ids]
        .filter((id) => Object.hasOwn(parsed.board, id))
        .map((id) => [id, parsed.board[id]]),
    );
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return new Map();
}

/**
 * @param {string} boardName
 * @param {number} fromSeqExclusive
 * @param {number} toSeqInclusive
 * @param {Array<{mutation: any}>} mutations
 * @param {{readonly: boolean}} metadata
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<void>}
 */
async function rewriteStoredSvg(
  boardName,
  fromSeqExclusive,
  toSeqInclusive,
  mutations,
  metadata,
  options,
) {
  const historyDir = options?.historyDir;
  const file = boardSvgPath(boardName, historyDir);
  const tmpFile = createTempSvgPath(file);
  const envelope = parseStoredSvgEnvelope(await readFile(file, "utf8"));
  const currentSeq = normalizeStoredSeq(
    envelope.rootAttributes["data-wbo-seq"],
  );
  if (currentSeq !== fromSeqExclusive) {
    throw createStoredSvgSeqMismatchError(fromSeqExclusive, currentSeq);
  }
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const output = fs.createWriteStream(tmpFile, {
    encoding: "utf8",
    flags: "wx",
  });
  const closeOutput = () =>
    new Promise((resolve, reject) => {
      output.on("error", reject);
      output.end(resolve);
    });

  try {
    for await (const chunk of streamingUpdate(
      input,
      mutations.map((entry) => entry.mutation),
      { metadata, toSeqInclusive },
    )) {
      if (!output.write(chunk)) {
        await once(output, "drain");
      }
    }
    await closeOutput();
  } catch (error) {
    input.destroy();
    output.destroy();
    await fs.promises.rm(tmpFile, { force: true });
    throw error;
  }

  await rename(tmpFile, file);
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<{readonly: boolean}>}
 */
async function readBoardMetadata(boardName, options) {
  const historyDir = options?.historyDir;
  try {
    const svg = await readFile(boardSvgPath(boardName, historyDir), "utf8");
    return {
      readonly:
        parseStoredSvgEnvelope(svg).rootAttributes["data-wbo-readonly"] ===
        "true",
    };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  try {
    const parsed = await readLegacyBoardState(boardName, {
      historyDir: historyDir,
    });
    return parsed.metadata;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return defaultBoardMetadata();
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<string>}
 */
async function readBoardDownload(boardName, options) {
  const historyDir = options?.historyDir;
  try {
    return await readFile(boardSvgPath(boardName, historyDir), "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return readFile(boardJsonPath(boardName, historyDir), "utf8");
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<string>}
 */
async function readServedBaseline(boardName, options) {
  const historyDir = options?.historyDir;
  try {
    return await readFile(boardSvgPath(boardName, historyDir), "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  try {
    const parsed = await readLegacyBoardState(boardName, {
      historyDir: historyDir,
    });
    return renderServedBaselineSvg(parsed.board, parsed.metadata, 0);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return renderServedBaselineSvg({}, defaultBoardMetadata(), 0);
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<Readable>}
 */
async function streamServedBaseline(boardName, options) {
  const historyDir = options?.historyDir;
  try {
    const file = boardSvgPath(boardName, historyDir);
    await fs.promises.access(file);
    return fs.createReadStream(file, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return Readable.from([await readServedBaseline(boardName, options)]);
}

export {
  STORED_SVG_FORMAT,
  boardJsonPath,
  boardExists,
  boardSvgPath,
  createTempSvgPath,
  defaultBoardMetadata,
  parseLegacyStoredBoard,
  rewriteStoredSvg,
  parseStoredSvg,
  parseBoardItems,
  readBoardLoadState,
  readBoardDownload,
  readBoardMetadata,
  readBoardState,
  readServedBaseline,
  renderServedBaselineSvg,
  serializeStoredSvg,
  summarizeStoredSvg,
  streamServedBaseline,
  writeBoardState,
};
