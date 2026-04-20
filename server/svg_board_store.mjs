import fs from "node:fs";
import { once } from "node:events";
import { copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { readConfiguration } from "./configuration.mjs";
import observability from "./observability.mjs";
import {
  boardJsonPath,
  readLegacyBoardState,
} from "./legacy_json_board_source.mjs";
import {
  canonicalItemFromStoredSvgEntry,
  currentText,
  materializeItemForSave,
} from "./canonical_board_items.mjs";
import {
  STORED_SVG_FORMAT,
  createDefaultStoredSvgEnvelope,
  parseAttributes,
  parseStoredSvgEnvelope,
  serializeStoredSvgEnvelope,
  updateRootMetadata,
} from "./svg_envelope.mjs";
import {
  parseStoredSvgItem,
  serializeStoredSvgItem,
} from "./stored_svg_item_codec.mjs";
import { streamStoredSvgStructure } from "./streaming_stored_svg_scan.mjs";

const DEFAULT_SVG_SIZE = 5000;
const SVG_MARGIN = 4000;
let tempSvgSuffixCounter = 0;
const { logger } = observability;

/** @typedef {{readonly: boolean, seq?: number}} BoardMetadata */

/** @returns {BoardMetadata} */
function defaultBoardMetadata() {
  return {
    readonly: false,
    seq: 0,
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
 * @param {string} name
 * @param {string} [historyDir]
 * @returns {string}
 */
function boardSvgBackupPath(name, historyDir) {
  return `${boardSvgPath(name, historyDir)}.bak`;
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
 * @param {string} event
 * @param {{[key: string]: unknown}} fields
 * @returns {void}
 */
function logSvgStoreDebug(event, fields) {
  if (!logger.isEnabled("debug")) return;
  logger.debug(event, fields);
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
 * @param {string} boardName
 * @param {string | undefined} historyDir
 * @returns {Promise<{file: string, byteLength: number, source: "svg" | "svg_backup"} | null>}
 */
async function resolveReadableSvgFile(boardName, historyDir) {
  /** @type {Array<{file: string, source: "svg" | "svg_backup"}>} */
  for (const candidate of [
    { file: boardSvgPath(boardName, historyDir), source: "svg" },
    { file: boardSvgBackupPath(boardName, historyDir), source: "svg_backup" },
  ]) {
    try {
      const fileStat = await stat(candidate.file);
      return {
        file: candidate.file,
        byteLength: fileStat.size,
        source: /** @type {"svg" | "svg_backup"} */ (candidate.source),
      };
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }
  return null;
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
 * @returns {Promise<{
 *   itemsById: Map<string, any>,
 *   paintOrder: string[],
 *   metadata: BoardMetadata,
 *   seq: number,
 *   source: "svg" | "svg_backup" | "empty",
 *   byteLength: number,
 * }>}
 */
async function readCanonicalBoardState(boardName, options) {
  const historyDir = options?.historyDir;
  const itemsById = new Map();
  /** @type {string[]} */
  const paintOrder = [];
  const readableSvg = await resolveReadableSvgFile(boardName, historyDir);
  if (readableSvg) {
    const stream = fs.createReadStream(readableSvg.file, { encoding: "utf8" });
    /** @type {BoardMetadata} */
    let metadata = defaultBoardMetadata();
    let seq = 0;
    let index = 0;
    for await (const event of streamStoredSvgStructure(stream)) {
      if (event.type === "prefix") {
        const openTagEnd = event.prefix.indexOf(">");
        const rootAttributes = parseAttributes(
          event.prefix.slice(event.prefix.indexOf("<svg") + 4, openTagEnd),
        );
        metadata = {
          readonly: rootAttributes["data-wbo-readonly"] === "true",
        };
        seq = normalizeStoredSeq(rootAttributes["data-wbo-seq"]);
        continue;
      }
      if (event.type !== "item") continue;
      const item = canonicalItemFromStoredSvgEntry(event.entry, index);
      if (!item) continue;
      itemsById.set(item.id, item);
      paintOrder.push(item.id);
      index += 1;
    }
    return {
      itemsById,
      paintOrder,
      metadata,
      seq,
      source: readableSvg.source,
      byteLength: readableSvg.byteLength,
    };
  }

  try {
    const parsed = await readLegacyBoardState(boardName, {
      historyDir: historyDir,
    });
    await migrateLegacyJsonBoardToSvg(boardName, parsed, options);
    return readCanonicalBoardState(boardName, options);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  return {
    itemsById,
    paintOrder,
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
    (await fileExists(boardSvgBackupPath(boardName, historyDir))) ||
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
  const backupFile = boardSvgBackupPath(boardName, historyDir);
  const tmpFile = createTempSvgPath(file);
  logSvgStoreDebug("svg.write_started", {
    board: boardName,
    "file.path": file,
    "file.tmp_path": tmpFile,
    "wbo.svg.item_count": Object.keys(board).length,
    "wbo.svg.seq": seq,
  });
  if (Object.keys(board).length === 0) {
    for (const emptyPath of [
      file,
      backupFile,
      boardJsonPath(boardName, historyDir),
    ]) {
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
  logSvgStoreDebug("svg.write_tmp_finished", {
    board: boardName,
    "file.path": file,
    "file.tmp_path": tmpFile,
  });
  await rename(tmpFile, file);
  await copyFile(file, backupFile);
  const savedFile = await stat(file).catch(async (error) => {
    if (errorCode(error) !== "ENOENT") throw error;
    return stat(backupFile);
  });
  logSvgStoreDebug("svg.write_completed", {
    board: boardName,
    "file.path": file,
    "file.size": savedFile.size,
    "wbo.svg.seq": seq,
  });
}

/**
 * @param {string} boardName
 * @param {{board: {[name: string]: any}, metadata: BoardMetadata}} parsed
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<void>}
 */
async function migrateLegacyJsonBoardToSvg(boardName, parsed, options) {
  const historyDir = options?.historyDir;
  const file = boardSvgPath(boardName, historyDir);
  const tmpFile = createTempSvgPath(file);
  if (Object.keys(parsed.board).length === 0) {
    await writeFile(tmpFile, serializeStoredSvg({}, parsed.metadata, 0), {
      flag: "wx",
    });
    await rename(tmpFile, file);
  } else {
    await writeBoardState(boardName, parsed.board, parsed.metadata, 0, options);
  }
  try {
    await fs.promises.unlink(boardJsonPath(boardName, historyDir));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * @param {Map<string, any>} itemsById
 * @param {string[]} paintOrder
 * @returns {any[]}
 */
function collectPersistedCanonicalItems(itemsById, paintOrder) {
  return paintOrder
    .map((id) => itemsById.get(id))
    .filter((item) => item && item.deleted !== true);
}

/**
 * @param {string} boardName
 * @param {Map<string, any>} itemsById
 * @param {string[]} paintOrder
 * @param {BoardMetadata} metadata
 * @param {number} seq
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<{persistedIds: Set<string>, hasBaseline: boolean}>}
 */
async function writeCanonicalBoardState(
  boardName,
  itemsById,
  paintOrder,
  metadata,
  seq,
  options,
) {
  const persistedIds = new Set();
  /** @type {{[name: string]: any}} */
  const fullBoard = {};
  for (const item of collectPersistedCanonicalItems(itemsById, paintOrder)) {
    const materialized = materializeItemForSave(item);
    const serialized = serializeStoredSvgItem(materialized);
    if (!serialized) continue;
    persistedIds.add(item.id);
    fullBoard[item.id] = materialized;
  }
  await writeBoardState(boardName, fullBoard, metadata, seq, options);
  return {
    persistedIds,
    hasBaseline: persistedIds.size > 0,
  };
}

/**
 * @param {any} record
 * @returns {boolean}
 */
function needsSourcePayload(record) {
  return !!(
    record &&
    record.deleted !== true &&
    ((record.payload?.kind === "children" &&
      (record.payload.appendedChildren?.length || 0) > 0) ||
      (record.payload?.kind === "text" && currentText(record) === undefined))
  );
}

/**
 * @param {{tagName: string, attributes: {[name: string]: string}, content: string, raw: string}} entry
 * @returns {{txt: string} | {_children: any[]} | undefined}
 */
function readStoredSourcePayload(entry) {
  const sourceItem = parseStoredSvgItem(entry);
  if (sourceItem?.tool === "Text") {
    return { txt: sourceItem.txt };
  }
  if (sourceItem?.tool === "Pencil") {
    return { _children: sourceItem._children || [] };
  }
  return undefined;
}

/**
 * @param {Map<string, any>} itemsById
 * @returns {Map<string, string[]>}
 */
function collectCopyTargetsBySourceId(itemsById) {
  const targetsBySourceId = new Map();
  for (const item of itemsById.values()) {
    const sourceId = item?.copySource?.sourceId;
    if (typeof sourceId !== "string" || item.deleted === true) continue;
    const existing = targetsBySourceId.get(sourceId);
    if (existing) {
      existing.push(item.id);
    } else {
      targetsBySourceId.set(sourceId, [item.id]);
    }
  }
  return targetsBySourceId;
}

/**
 * @param {string} boardName
 * @param {Map<string, any>} itemsById
 * @param {string[]} paintOrder
 * @param {BoardMetadata} metadata
 * @param {number} persistedSeq
 * @param {number} latestSeq
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<Set<string>>}
 */
async function rewriteStoredSvgFromCanonical(
  boardName,
  itemsById,
  paintOrder,
  metadata,
  persistedSeq,
  latestSeq,
  options,
) {
  const historyDir = options?.historyDir;
  const file = boardSvgPath(boardName, historyDir);
  const backupFile = boardSvgBackupPath(boardName, historyDir);
  const tmpFile = createTempSvgPath(file);
  const sourceFile =
    (await resolveReadableSvgFile(boardName, historyDir))?.file || file;
  const input = fs.createReadStream(sourceFile, { encoding: "utf8" });
  const output = fs.createWriteStream(tmpFile, {
    encoding: "utf8",
    flags: "wx",
  });
  const copyTargetsBySourceId = collectCopyTargetsBySourceId(itemsById);
  const bufferedPayloads = new Map();
  const persistedIds = new Set();
  const closeOutput = () =>
    new Promise((resolve, reject) => {
      output.on("error", reject);
      output.end(resolve);
    });

  try {
    for await (const event of streamStoredSvgStructure(input)) {
      if (event.type === "prefix") {
        const openTagEnd = event.prefix.indexOf(">");
        const rootAttributes = parseAttributes(
          event.prefix.slice(event.prefix.indexOf("<svg") + 4, openTagEnd),
        );
        const currentSeq = normalizeStoredSeq(rootAttributes["data-wbo-seq"]);
        if (currentSeq !== persistedSeq) {
          throw createStoredSvgSeqMismatchError(persistedSeq, currentSeq);
        }
        if (
          !output.write(updateRootMetadata(event.prefix, metadata, latestSeq))
        ) {
          await once(output, "drain");
        }
        continue;
      }

      if (event.type === "tail") {
        if (!output.write(event.chunk)) {
          await once(output, "drain");
        }
        continue;
      }

      if (event.type === "suffix") {
        for (const id of paintOrder) {
          const item = itemsById.get(id);
          if (
            !item ||
            item.deleted === true ||
            item.createdAfterPersistedSeq !== true
          ) {
            continue;
          }
          const sourcePayload = item.copySource
            ? bufferedPayloads.get(item.copySource.sourceId)
            : undefined;
          const tag = serializeStoredSvgItem(
            materializeItemForSave(item, sourcePayload),
          );
          if (!tag) continue;
          persistedIds.add(item.id);
          if (!output.write(tag)) {
            await once(output, "drain");
          }
        }
        if (!output.write(event.leadingText + event.suffix)) {
          await once(output, "drain");
        }
        continue;
      }

      const id = event.entry.attributes.id;
      if (typeof id !== "string") {
        if (!output.write(event.leadingText + event.entry.raw)) {
          await once(output, "drain");
        }
        continue;
      }

      const item = itemsById.get(id);
      if (!item || item.deleted === true) {
        continue;
      }

      if (copyTargetsBySourceId.has(id)) {
        const sourcePayload = readStoredSourcePayload(event.entry);
        if (sourcePayload) {
          bufferedPayloads.set(id, sourcePayload);
        }
      }

      if (item.dirty !== true || item.createdAfterPersistedSeq === true) {
        if (!output.write(event.leadingText + event.entry.raw)) {
          await once(output, "drain");
        }
        continue;
      }

      const sourcePayload = needsSourcePayload(item)
        ? bufferedPayloads.get(id) || readStoredSourcePayload(event.entry)
        : undefined;
      const rewrittenTag = serializeStoredSvgItem(
        materializeItemForSave(item, sourcePayload),
      );
      if (!rewrittenTag) {
        continue;
      }
      persistedIds.add(id);
      if (!output.write(event.leadingText + rewrittenTag)) {
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
  await copyFile(file, backupFile);
  return persistedIds;
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<{metadata: {readonly: boolean, seq?: number}, inlineBoardSvg: string | null, source: "svg" | "svg_backup" | "generated"}>}
 */
async function readBoardDocumentState(boardName, options) {
  const historyDir = options?.historyDir;
  const readableSvg = await resolveReadableSvgFile(boardName, historyDir);
  if (readableSvg) {
    const stream = fs.createReadStream(readableSvg.file, { encoding: "utf8" });
    /** @type {BoardMetadata} */
    let metadata = defaultBoardMetadata();
    try {
      for await (const event of streamStoredSvgStructure(stream)) {
        if (event.type !== "prefix") continue;
        const openTagEnd = event.prefix.indexOf(">");
        const rootAttributes = parseAttributes(
          event.prefix.slice(event.prefix.indexOf("<svg") + 4, openTagEnd),
        );
        metadata = {
          readonly: rootAttributes["data-wbo-readonly"] === "true",
          seq: normalizeStoredSeq(rootAttributes["data-wbo-seq"]),
        };
        break;
      }
    } finally {
      stream.destroy();
    }
    return {
      metadata,
      inlineBoardSvg: null,
      source: readableSvg.source,
    };
  }

  try {
    const parsed = await readLegacyBoardState(boardName, {
      historyDir: historyDir,
    });
    const parsedMetadata = /** @type {{readonly: boolean, seq?: unknown}} */ (
      parsed.metadata
    );
    const metadata = {
      readonly: parsedMetadata.readonly,
      seq: normalizeStoredSeq(parsedMetadata.seq),
    };
    return {
      metadata,
      inlineBoardSvg: renderServedBaselineSvg(parsed.board, metadata, 0),
      source: "generated",
    };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  const metadata = defaultBoardMetadata();
  return {
    metadata,
    inlineBoardSvg: renderServedBaselineSvg({}, metadata, 0),
    source: "generated",
  };
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<string>}
 */
async function readServedBaseline(boardName, options) {
  const historyDir = options?.historyDir;
  const readableSvg = await resolveReadableSvgFile(boardName, historyDir);
  if (readableSvg) {
    return await readFile(readableSvg.file, "utf8");
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
  const readableSvg = await resolveReadableSvgFile(boardName, historyDir);
  if (readableSvg) {
    return fs.createReadStream(readableSvg.file, "utf8");
  }
  return Readable.from([await readServedBaseline(boardName, options)]);
}

export {
  STORED_SVG_FORMAT,
  boardJsonPath,
  boardExists,
  boardSvgBackupPath,
  boardSvgPath,
  readCanonicalBoardState,
  readBoardDocumentState,
  readServedBaseline,
  rewriteStoredSvgFromCanonical,
  streamServedBaseline,
  writeCanonicalBoardState,
  writeBoardState,
};
