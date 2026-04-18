import { readFile } from "node:fs/promises";
import path from "node:path";

import { readConfiguration } from "./configuration.mjs";

const BOARD_METADATA_KEY = "__wbo_meta__";

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
      board[key] = value;
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
