/**
 * @typedef {{
 *   name: string,
 *   visibleWhenReadOnly: boolean,
 *   moderatorOnly: boolean,
 *   updatableFields?: string[],
 *   liveMessageFields?: {[type: string]: {[field: string]: string}},
 *   batchMessageFields?: {[type: string]: {[field: string]: string}},
 *   drawsOnBoard?: boolean,
 *   payloadKind?: "inline" | "text" | "children",
 *   shapeType?: string,
 *   liveCreateType?: string,
 *   storedTagName?: string,
 *   iconFile?: string,
 *   secondaryIconFile?: string,
 *   stylesheetFile?: string,
 * }} ToolCatalogEntry
 */

/** @param {string} name @param {Partial<ToolCatalogEntry>} [options] */
function tool(name, options = {}) {
  return {
    name,
    visibleWhenReadOnly: false,
    moderatorOnly: false,
    ...options,
  };
}

/** @param {string} name @param {Partial<ToolCatalogEntry>} [options] */
function drawingTool(name, options = {}) {
  return tool(name, { drawsOnBoard: true, ...options });
}

/** @param {string} name @param {Partial<ToolCatalogEntry>} [options] */
function inlineShapeTool(name, options = {}) {
  return drawingTool(name, { payloadKind: "inline", ...options });
}

/** @type {ToolCatalogEntry[]} */
export const TOOL_CATALOG = [
  drawingTool("Pencil", {
    payloadKind: "children",
    liveCreateType: "line",
    storedTagName: "path",
    secondaryIconFile: "whiteout_tape.svg",
    stylesheetFile: "pencil.css",
  }),
  inlineShapeTool("Straight line", {
    shapeType: "straight",
    liveCreateType: "straight",
    storedTagName: "line",
    updatableFields: ["x2", "y2"],
    secondaryIconFile: "icon-straight.svg",
    stylesheetFile: "straight-line.css",
  }),
  inlineShapeTool("Rectangle", {
    shapeType: "rect",
    liveCreateType: "rect",
    storedTagName: "rect",
    updatableFields: ["x", "y", "x2", "y2"],
    secondaryIconFile: "icon-square.svg",
    stylesheetFile: "rectangle.css",
  }),
  inlineShapeTool("Ellipse", {
    shapeType: "ellipse",
    liveCreateType: "ellipse",
    storedTagName: "ellipse",
    updatableFields: ["x", "y", "x2", "y2"],
    iconFile: "icon-ellipse.svg",
    secondaryIconFile: "icon-circle.svg",
    stylesheetFile: "ellipse.css",
  }),
  drawingTool("Text", {
    payloadKind: "text",
    liveCreateType: "new",
    storedTagName: "text",
    updatableFields: ["txt"],
    stylesheetFile: "text.css",
  }),
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
