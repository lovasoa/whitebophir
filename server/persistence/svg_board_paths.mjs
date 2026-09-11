import path from "node:path";
import {
  BOARD_QUARANTINE_SUFFIX,
  BOARD_SVG_BACKUP_SUFFIX,
  BOARD_SVG_FILENAME_PREFIX,
  BOARD_SVG_FILENAME_SUFFIX,
  BOARD_TEMP_SUFFIX,
} from "../../client-data/js/board_name.js";

let tempSvgSuffixCounter = 0;
let quarantineSvgSuffixCounter = 0;

/**
 * @param {string | undefined} historyDir
 * @returns {string}
 */
function resolveHistoryDir(historyDir) {
  if (typeof historyDir === "string" && historyDir !== "") {
    return historyDir;
  }
  throw new Error("historyDir is required");
}

/**
 * @param {string} name
 * @param {string} [historyDir]
 * @returns {string}
 */
function boardSvgPath(name, historyDir) {
  return path.join(
    resolveHistoryDir(historyDir),
    `${BOARD_SVG_FILENAME_PREFIX}${name}${BOARD_SVG_FILENAME_SUFFIX}`,
  );
}

/**
 * @param {string} name
 * @param {string} [historyDir]
 * @returns {string}
 */
function boardSvgBackupPath(name, historyDir) {
  return `${boardSvgPath(name, historyDir)}${BOARD_SVG_BACKUP_SUFFIX}`;
}

/**
 * @param {string} file
 * @returns {string}
 */
function createTempSvgPath(file) {
  tempSvgSuffixCounter = (tempSvgSuffixCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${file}.${Date.now()}.${tempSvgSuffixCounter}${BOARD_TEMP_SUFFIX}`;
}

/**
 * @param {string} file
 * @returns {string}
 */
function createQuarantineSvgPath(file) {
  quarantineSvgSuffixCounter =
    (quarantineSvgSuffixCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${file}.${Date.now()}.${quarantineSvgSuffixCounter}${BOARD_QUARANTINE_SUFFIX}`;
}

export {
  boardSvgBackupPath,
  boardSvgPath,
  createQuarantineSvgPath,
  createTempSvgPath,
};
