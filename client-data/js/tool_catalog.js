/**
 * Minimal tool catalog shared between the server-rendered toolbar and the
 * client boot sequence.
 * @typedef {{
 *   name: string,
 *   visibleWhenReadOnly: boolean,
 *   moderatorOnly: boolean,
 *   updatableFields?: string[],
 *   liveMessageFields?: {[type: string]: {[field: string]: string}},
 *   batchMessageFields?: {[type: string]: {[field: string]: string}},
 *   iconFile?: string,
 *   secondaryIconFile?: string,
 *   stylesheetFile?: string,
 * }} ToolCatalogEntry
 */

/** @param {string} name @param {Partial<ToolCatalogEntry>} [options] @returns {ToolCatalogEntry} */
function tool(name, options = {}) {
  return {
    name,
    visibleWhenReadOnly: false,
    moderatorOnly: false,
    ...options,
  };
}

/** @type {ToolCatalogEntry[]} */
export const TOOL_CATALOG = [
  tool("Pencil", {
    secondaryIconFile: "whiteout_tape.svg",
    stylesheetFile: "pencil.css",
  }),
  tool("Straight line", {
    secondaryIconFile: "icon-straight.svg",
    stylesheetFile: "straight-line.css",
  }),
  tool("Rectangle", {
    secondaryIconFile: "icon-square.svg",
    stylesheetFile: "rectangle.css",
  }),
  tool("Ellipse", {
    iconFile: "icon-ellipse.svg",
    secondaryIconFile: "icon-circle.svg",
    stylesheetFile: "ellipse.css",
  }),
  tool("Text", { stylesheetFile: "text.css" }),
  tool("Eraser", { liveMessageFields: { delete: { id: "id" } } }),
  tool("Hand", {
    visibleWhenReadOnly: true,
    updatableFields: ["transform"],
    iconFile: "hand.svg",
    secondaryIconFile: "selector.svg",
    batchMessageFields: {
      update: { id: "id", transform: "transform" },
      delete: { id: "id" },
      copy: { id: "id", newid: "id" },
    },
  }),
  tool("Grid", { visibleWhenReadOnly: true }),
  tool("Download", { visibleWhenReadOnly: true, iconFile: "download.svg" }),
  tool("Zoom", { visibleWhenReadOnly: true }),
  tool("Clear", {
    moderatorOnly: true,
    iconFile: "clear.svg",
    liveMessageFields: { clear: {} },
  }),
];

/** @type {{[toolName: string]: ToolCatalogEntry}} */
export const TOOL_CATALOG_BY_NAME = Object.fromEntries(
  TOOL_CATALOG.map((entry) => [entry.name, entry]),
);

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
