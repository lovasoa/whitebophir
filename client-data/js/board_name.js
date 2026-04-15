const BOARD_NAME_ALLOWED_CHARACTERS = "A-Za-z0-9_%~()\\-";

export const BOARD_NAME_INPUT_PATTERN = `[${BOARD_NAME_ALLOWED_CHARACTERS}]+`;

const BOARD_NAME_PATTERN = new RegExp(`^[${BOARD_NAME_ALLOWED_CHARACTERS}]*$`);
const BOARD_NAME_INVALID_CHARACTERS = new RegExp(
  `[^${BOARD_NAME_ALLOWED_CHARACTERS}]+`,
  "g",
);

/**
 * @param {unknown} boardName
 * @returns {boardName is string}
 */
export function isValidBoardName(boardName) {
  return typeof boardName === "string" && BOARD_NAME_PATTERN.test(boardName);
}

/**
 * @param {unknown} boardName
 * @returns {string}
 */
export function sanitizeBoardName(boardName) {
  if (typeof boardName !== "string") return "";
  return boardName.replace(BOARD_NAME_INVALID_CHARACTERS, "");
}

/**
 * @param {unknown} boardName
 * @returns {string | null}
 */
export function decodeAndValidateBoardName(boardName) {
  if (typeof boardName !== "string") return null;
  try {
    const decodedBoardName = decodeURIComponent(boardName);
    return isValidBoardName(decodedBoardName) ? decodedBoardName : null;
  } catch {
    return null;
  }
}
