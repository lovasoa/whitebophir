/**
 * Minimal tool catalog shared between the server-rendered toolbar and the
 * client boot sequence.
 * @typedef {{name: string, visibleWhenReadOnly: boolean, moderatorOnly: boolean}} ToolCatalogEntry
 */

/** @type {ToolCatalogEntry[]} */
export const TOOL_CATALOG = [
  { name: "Pencil", visibleWhenReadOnly: false, moderatorOnly: false },
  { name: "Straight line", visibleWhenReadOnly: false, moderatorOnly: false },
  { name: "Rectangle", visibleWhenReadOnly: false, moderatorOnly: false },
  { name: "Ellipse", visibleWhenReadOnly: false, moderatorOnly: false },
  { name: "Text", visibleWhenReadOnly: false, moderatorOnly: false },
  { name: "Eraser", visibleWhenReadOnly: false, moderatorOnly: false },
  { name: "Hand", visibleWhenReadOnly: true, moderatorOnly: false },
  { name: "Grid", visibleWhenReadOnly: true, moderatorOnly: false },
  { name: "Download", visibleWhenReadOnly: true, moderatorOnly: false },
  { name: "Zoom", visibleWhenReadOnly: true, moderatorOnly: false },
  { name: "Clear", visibleWhenReadOnly: false, moderatorOnly: true },
];

/**
 * @param {string} toolName
 * @returns {ToolCatalogEntry | null}
 */
export function getToolCatalogEntry(toolName) {
  return TOOL_CATALOG.find((entry) => entry.name === toolName) || null;
}

/**
 * @param {{readonly?: boolean, canWrite?: boolean} | null | undefined} boardState
 * @param {ToolCatalogEntry} entry
 * @returns {boolean}
 */
function shouldDisplayCatalogTool(boardState, entry) {
  const readonly = boardState?.readonly === true;
  const canWrite = boardState?.canWrite === true;
  return !readonly || canWrite || entry.visibleWhenReadOnly;
}

/**
 * @param {{
 *   blockedTools?: string[] | null,
 *   boardState?: {readonly?: boolean, canWrite?: boolean} | null,
 *   moderator?: boolean,
 * }} options
 * @returns {ToolCatalogEntry[]}
 */
export function getVisibleToolCatalogEntries(options) {
  const blockedTools = new Set(options.blockedTools || []);
  const moderator = options.moderator === true;
  return TOOL_CATALOG.filter((entry) => {
    if (blockedTools.has(entry.name)) return false;
    if (entry.moderatorOnly && !moderator) return false;
    return shouldDisplayCatalogTool(options.boardState, entry);
  });
}
