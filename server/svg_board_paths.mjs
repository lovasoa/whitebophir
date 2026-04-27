import path from "node:path";

let tempSvgSuffixCounter = 0;

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
  return path.join(resolveHistoryDir(historyDir), `board-${name}.svg`);
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
 * @param {string} file
 * @returns {string}
 */
function createTempSvgPath(file) {
  tempSvgSuffixCounter = (tempSvgSuffixCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${file}.${Date.now()}.${tempSvgSuffixCounter}.tmp`;
}

export { boardSvgBackupPath, boardSvgPath, createTempSvgPath };
