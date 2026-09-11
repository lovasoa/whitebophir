const BOARD_NAME_INVALID_RUN = /[^\p{L}\p{N}_~()-]+/gu;
const BOARD_NAME_REPEATED_DASHES = /-+/g;
const BOARD_NAME_TRIMMED_DASHES = /^-+|-+$/g;
export const BOARD_FILENAME_MAX_BYTES = 255;
export const BOARD_SVG_FILENAME_PREFIX = "board-";
export const BOARD_SVG_FILENAME_SUFFIX = ".svg";
export const BOARD_SVG_BACKUP_SUFFIX = ".bak";
export const BOARD_QUARANTINE_SUFFIX = ".quarantine";
export const BOARD_TEMP_SUFFIX = ".tmp";
const MAX_SAFE_INTEGER_DECIMAL_DIGITS = String(Number.MAX_SAFE_INTEGER).length;
const MAX_GENERATED_BOARD_FILENAME_SUFFIX_BYTES = Math.max(
  1 +
    MAX_SAFE_INTEGER_DECIMAL_DIGITS +
    1 +
    MAX_SAFE_INTEGER_DECIMAL_DIGITS +
    BOARD_QUARANTINE_SUFFIX.length,
  BOARD_SVG_BACKUP_SUFFIX.length +
    1 +
    MAX_SAFE_INTEGER_DECIMAL_DIGITS +
    1 +
    MAX_SAFE_INTEGER_DECIMAL_DIGITS +
    BOARD_TEMP_SUFFIX.length,
);
const MAX_BOARD_SVG_FILENAME_BYTES =
  BOARD_FILENAME_MAX_BYTES - MAX_GENERATED_BOARD_FILENAME_SUFFIX_BYTES;

/**
 * @param {string} value
 * @returns {number}
 */
function utf8ByteLength(value) {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) || 0;
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) {
      byteLength += 1;
    } else if (codePoint <= 0x7ff) {
      byteLength += 2;
    } else if (codePoint <= 0xffff) {
      byteLength += 3;
    } else {
      byteLength += 4;
    }
  }
  return byteLength;
}

/**
 * @param {string} boardName
 * @returns {boolean}
 */
function hasValidBoardFilenameByteLength(boardName) {
  return (
    BOARD_SVG_FILENAME_PREFIX.length +
      utf8ByteLength(boardName) +
      BOARD_SVG_FILENAME_SUFFIX.length <=
    MAX_BOARD_SVG_FILENAME_BYTES
  );
}

/**
 * @param {unknown} boardName
 * @returns {string}
 */
export function canonicalizeBoardName(boardName) {
  if (typeof boardName !== "string") return "";
  return boardName
    .normalize()
    .toLowerCase()
    .replace(BOARD_NAME_INVALID_RUN, "-")
    .replace(BOARD_NAME_REPEATED_DASHES, "-")
    .replace(BOARD_NAME_TRIMMED_DASHES, "");
}

/**
 * @param {unknown} boardName
 * @returns {string | null}
 */
export function decodeBoardName(boardName) {
  if (typeof boardName !== "string") return null;
  try {
    return decodeURIComponent(boardName);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} boardName
 * @returns {boardName is string}
 */
export function isValidBoardName(boardName) {
  return (
    typeof boardName === "string" &&
    boardName !== "" &&
    canonicalizeBoardName(boardName) === boardName &&
    hasValidBoardFilenameByteLength(boardName)
  );
}

/**
 * @param {unknown} boardName
 * @returns {string | null}
 */
export function decodeAndValidateBoardName(boardName) {
  const decodedBoardName = decodeBoardName(boardName);
  return decodedBoardName !== null && isValidBoardName(decodedBoardName)
    ? decodedBoardName
    : null;
}
