const BOARD_NAME_INVALID_RUN = /[^\p{L}\p{N}_~()-]+/gu;
const BOARD_NAME_REPEATED_DASHES = /-+/g;
const BOARD_NAME_TRIMMED_DASHES = /^-+|-+$/g;

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
    canonicalizeBoardName(boardName) === boardName
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
