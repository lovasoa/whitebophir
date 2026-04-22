import { readFile } from "node:fs/promises";
import path from "node:path";

const BOARD_METADATA_KEY = "__wbo_meta__";
const DEFAULT_HISTORY_DIR = path.join(process.cwd(), "server-data");
const LEGACY_BOARD_UNIT_SCALE = 10;
const LEGACY_GEOMETRY_KEYS = new Set([
  "x",
  "y",
  "x2",
  "y2",
  "size",
  "deltax",
  "deltay",
]);
/**
 * @param {string | undefined} historyDir
 * @returns {string}
 */
function resolveHistoryDir(historyDir) {
  if (typeof historyDir === "string" && historyDir !== "") {
    return historyDir;
  }
  return process.env.WBO_HISTORY_DIR || DEFAULT_HISTORY_DIR;
}

/**
 * @param {string} name
 * @param {string} [historyDir]
 * @returns {string}
 */
function boardJsonPath(name, historyDir) {
  return path.join(
    resolveHistoryDir(historyDir),
    `board-${encodeURIComponent(name)}.json`,
  );
}

/**
 * @param {any} metadata
 * @returns {{readonly: boolean}}
 */
function normalizeLegacyBoardMetadata(metadata) {
  return {
    readonly: metadata && metadata.readonly === true,
  };
}

/**
 * @param {unknown} value
 * @returns {number | unknown}
 */
function scaleLegacyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(number * LEGACY_BOARD_UNIT_SCALE)
    : value;
}

/**
 * @param {unknown} transform
 * @returns {unknown}
 */
function scaleLegacyTransform(transform) {
  if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
    return transform;
  }
  /** @type {Record<string, unknown>} */
  const matrix = /** @type {Record<string, unknown>} */ (transform);
  return {
    ...transform,
    e: scaleLegacyNumber(matrix.e),
    f: scaleLegacyNumber(matrix.f),
  };
}

/**
 * @param {unknown} child
 * @returns {unknown}
 */
function scaleLegacyChildPoint(child) {
  if (!child || typeof child !== "object" || Array.isArray(child)) {
    return child;
  }
  /** @type {Record<string, unknown>} */
  const point = /** @type {Record<string, unknown>} */ (child);
  return {
    ...child,
    x: scaleLegacyNumber(point.x),
    y: scaleLegacyNumber(point.y),
  };
}

/**
 * @param {unknown} item
 * @returns {unknown}
 */
function scaleLegacyBoardItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }

  /** @type {{[name: string]: unknown}} */
  const scaled = {};
  for (const [key, value] of Object.entries(item)) {
    if (LEGACY_GEOMETRY_KEYS.has(key)) {
      scaled[key] = scaleLegacyNumber(value);
      continue;
    }
    if (key === "_children" && Array.isArray(value)) {
      scaled[key] = value.map(scaleLegacyChildPoint);
      continue;
    }
    if (key === "transform") {
      scaled[key] = scaleLegacyTransform(value);
      continue;
    }
    scaled[key] = value;
  }
  return scaled;
}

/**
 * @param {any} storedBoard
 * @returns {{board: {[name: string]: any}, metadata: {readonly: boolean}}}
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
  let metadata = normalizeLegacyBoardMetadata(null);

  for (const [key, value] of Object.entries(storedBoard)) {
    if (key === BOARD_METADATA_KEY) {
      metadata = normalizeLegacyBoardMetadata(value);
    } else {
      board[key] = scaleLegacyBoardItem(value);
    }
  }

  return { board, metadata };
}

/**
 * @param {string} boardName
 * @param {{historyDir?: string}=} [options]
 * @returns {Promise<{board: {[name: string]: any}, metadata: {readonly: boolean}, source: "json"}>}
 */
async function readLegacyBoardState(boardName, options) {
  const jsonText = await readFile(
    boardJsonPath(boardName, options?.historyDir),
    "utf8",
  );
  const parsed = parseLegacyStoredBoard(JSON.parse(jsonText));
  return {
    board: parsed.board,
    metadata: parsed.metadata,
    source: "json",
  };
}

export { boardJsonPath, parseLegacyStoredBoard, readLegacyBoardState };
