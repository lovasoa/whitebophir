const LEGACY_TOOL_ID_ALIASES = Object.freeze({
  Pencil: "pencil",
  Text: "text",
  Rectangle: "rectangle",
  Ellipse: "ellipse",
  "Straight line": "straight-line",
  Eraser: "eraser",
  Hand: "hand",
  Cursor: "cursor",
  Clear: "clear",
  Download: "download",
  Zoom: "zoom",
  Grid: "grid",
});
/** @typedef {keyof typeof LEGACY_TOOL_ID_ALIASES} LegacyToolId */

/**
 * @param {unknown} toolId
 * @returns {string | undefined}
 */
function normalizeLegacyToolIdForSvg(toolId) {
  if (typeof toolId !== "string" || toolId === "") return undefined;
  return LEGACY_TOOL_ID_ALIASES[/** @type {LegacyToolId} */ (toolId)] || toolId;
}

/**
 * @param {unknown} item
 * @returns {any}
 */
function normalizeLegacyBoardItemForSvg(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }
  const legacyItem = /** @type {{tool?: unknown, [name: string]: any}} */ (
    item
  );
  const normalizedToolId = normalizeLegacyToolIdForSvg(legacyItem.tool);
  if (!normalizedToolId || normalizedToolId === legacyItem.tool) {
    return item;
  }
  return {
    ...legacyItem,
    tool: normalizedToolId,
  };
}

/**
 * @param {{[name: string]: any}} board
 * @returns {{[name: string]: any}}
 */
function normalizeLegacyBoardForSvg(board) {
  /** @type {{[name: string]: any}} */
  const normalizedBoard = {};
  for (const [id, item] of Object.entries(board || {})) {
    normalizedBoard[id] = normalizeLegacyBoardItemForSvg(item);
  }
  return normalizedBoard;
}

export {
  LEGACY_TOOL_ID_ALIASES,
  normalizeLegacyBoardForSvg,
  normalizeLegacyBoardItemForSvg,
  normalizeLegacyToolIdForSvg,
};
