import { MutationType } from "../js/mutation_type.js";

/**
 * @typedef {{
 *   toolId: string,
 *   id: number,
 *   translationKey: string,
 *   label: string,
 *   iconPath: string,
 *   stylesheetPath: string | null,
 *   moduleImportPath: string,
 *   visibleWhenReadOnly: boolean,
 *   moderatorOnly: boolean,
 *   drawsOnBoard: boolean,
 *   toolbar: boolean,
 *   shapeTool?: boolean,
 *   storedTagName?: string,
 *   payloadKind?: "inline" | "text" | "children",
 *   updatableFields?: ReadonlyArray<string>,
 *   liveMessageFields?: Readonly<Record<number, Readonly<Record<string, string>>>>,
 *   batchMessageFields?: Readonly<Record<number, Readonly<Record<string, string>>>>,
 *   shortcut?: string,
 *   oneTouch?: boolean,
 *   alwaysOn?: boolean,
 *   requiresWritableBoard?: boolean,
 *   mouseCursor?: string,
 *   helpText?: string,
 *   showMarker?: boolean,
 * }} ToolManifestEntry
 */

export const TOOL_CODE_BY_ID = Object.freeze(
  /** @type {const} */ ({
    pencil: 1,
    "straight-line": 2,
    rectangle: 3,
    ellipse: 4,
    text: 5,
    eraser: 6,
    hand: 7,
    grid: 8,
    download: 9,
    zoom: 10,
    clear: 11,
    cursor: 12,
  }),
);
/** @typedef {keyof typeof TOOL_CODE_BY_ID} ToolId */
/** @typedef {(typeof TOOL_CODE_BY_ID)[ToolId]} ToolCode */

/**
 * @param {string} toolId
 * @returns {string}
 */
export function getToolTranslationKey(toolId) {
  return toolId.replace(/-/g, "_");
}

/**
 * @param {string} toolId
 * @returns {string}
 */
export function getDefaultToolLabel(toolId) {
  return toolId
    .split("-")
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toUpperCase() + part.slice(1)
        : part.toLowerCase(),
    )
    .join(" ");
}

/**
 * @param {string} toolId
 * @returns {string}
 */
export function getToolIconPath(toolId) {
  return `tools/${toolId}/icon.svg`;
}

/**
 * @param {string} toolId
 * @param {boolean} drawsOnBoard
 * @returns {string | null}
 */
export function getToolStylesheetPath(toolId, drawsOnBoard) {
  return drawsOnBoard ? `tools/${toolId}/${toolId}.css` : null;
}

/**
 * @param {string} toolId
 * @param {string} assetFile
 * @returns {string}
 */
export function getToolRuntimeAssetPath(toolId, assetFile) {
  return `tools/${toolId}/${assetFile}`;
}

/**
 * @param {string} toolId
 * @returns {string}
 */
export function getToolModuleImportPath(toolId) {
  return `../tools/${toolId}/index.js`;
}

/**
 * @param {Omit<ToolManifestEntry, "translationKey" | "label" | "iconPath" | "stylesheetPath" | "moduleImportPath" | "visibleWhenReadOnly" | "moderatorOnly" | "drawsOnBoard" | "toolbar"> & Partial<Pick<ToolManifestEntry, "visibleWhenReadOnly" | "moderatorOnly" | "drawsOnBoard" | "toolbar">>} entry
 * @returns {Readonly<ToolManifestEntry>}
 */
function defineTool(entry) {
  const toolId = entry.toolId;
  const drawsOnBoard = entry.drawsOnBoard === true;
  return Object.freeze({
    ...entry,
    translationKey: getToolTranslationKey(toolId),
    label: getDefaultToolLabel(toolId),
    iconPath: getToolIconPath(toolId),
    stylesheetPath: getToolStylesheetPath(toolId, drawsOnBoard),
    moduleImportPath: getToolModuleImportPath(toolId),
    visibleWhenReadOnly: entry.visibleWhenReadOnly === true,
    moderatorOnly: entry.moderatorOnly === true,
    drawsOnBoard,
    toolbar: entry.toolbar !== false,
  });
}

export const TOOL_MANIFEST = Object.freeze([
  defineTool({
    toolId: "pencil",
    id: TOOL_CODE_BY_ID.pencil,
    drawsOnBoard: true,
    payloadKind: "children",
    storedTagName: "path",
    liveMessageFields: {
      [MutationType.CREATE]: {
        id: "id",
        color: "color",
        size: "size",
        opacity: "opacity?",
      },
      [MutationType.APPEND]: {
        parent: "id",
        x: "coord",
        y: "coord",
      },
    },
    shortcut: "p",
  }),
  defineTool({
    toolId: "straight-line",
    id: TOOL_CODE_BY_ID["straight-line"],
    drawsOnBoard: true,
    shapeTool: true,
    storedTagName: "line",
    updatableFields: ["x2", "y2"],
    shortcut: "l",
    mouseCursor: "crosshair",
  }),
  defineTool({
    toolId: "rectangle",
    id: TOOL_CODE_BY_ID.rectangle,
    drawsOnBoard: true,
    shapeTool: true,
    storedTagName: "rect",
    updatableFields: ["x", "y", "x2", "y2"],
    shortcut: "r",
    mouseCursor: "crosshair",
  }),
  defineTool({
    toolId: "ellipse",
    id: TOOL_CODE_BY_ID.ellipse,
    drawsOnBoard: true,
    shapeTool: true,
    storedTagName: "ellipse",
    updatableFields: ["x", "y", "x2", "y2"],
    shortcut: "c",
    mouseCursor: "crosshair",
  }),
  defineTool({
    toolId: "text",
    id: TOOL_CODE_BY_ID.text,
    drawsOnBoard: true,
    payloadKind: "text",
    storedTagName: "text",
    updatableFields: ["txt"],
    liveMessageFields: {
      [MutationType.CREATE]: {
        id: "id",
        color: "color",
        size: "size",
        opacity: "opacity?",
        x: "coord",
        y: "coord",
      },
      [MutationType.UPDATE]: {
        id: "id",
        txt: "text",
      },
    },
    shortcut: "t",
    mouseCursor: "text",
  }),
  defineTool({
    toolId: "eraser",
    id: TOOL_CODE_BY_ID.eraser,
    liveMessageFields: {
      [MutationType.DELETE]: { id: "id" },
    },
    shortcut: "e",
    mouseCursor: "crosshair",
    showMarker: true,
  }),
  defineTool({
    toolId: "hand",
    id: TOOL_CODE_BY_ID.hand,
    visibleWhenReadOnly: true,
    updatableFields: ["transform"],
    batchMessageFields: {
      [MutationType.UPDATE]: { id: "id", transform: "transform" },
      [MutationType.DELETE]: { id: "id" },
      [MutationType.COPY]: { id: "id", newid: "id" },
    },
    shortcut: "h",
    mouseCursor: "move",
    showMarker: true,
  }),
  defineTool({
    toolId: "grid",
    id: TOOL_CODE_BY_ID.grid,
    visibleWhenReadOnly: true,
    shortcut: "g",
    oneTouch: true,
    mouseCursor: "crosshair",
  }),
  defineTool({
    toolId: "download",
    id: TOOL_CODE_BY_ID.download,
    visibleWhenReadOnly: true,
    shortcut: "d",
    oneTouch: true,
    mouseCursor: "crosshair",
  }),
  defineTool({
    toolId: "zoom",
    id: TOOL_CODE_BY_ID.zoom,
    visibleWhenReadOnly: true,
    shortcut: "z",
    mouseCursor: "zoom-in",
    helpText: "click_to_zoom",
    showMarker: true,
  }),
  defineTool({
    toolId: "clear",
    id: TOOL_CODE_BY_ID.clear,
    moderatorOnly: true,
    liveMessageFields: {
      [MutationType.CLEAR]: {},
    },
    oneTouch: true,
    requiresWritableBoard: true,
    mouseCursor: "crosshair",
  }),
  defineTool({
    toolId: "cursor",
    id: TOOL_CODE_BY_ID.cursor,
    toolbar: false,
    alwaysOn: true,
    mouseCursor: "crosshair",
    showMarker: true,
  }),
]);

export const TOOLS = TOOL_MANIFEST;
export const TOOL_IDS = /** @type {ReadonlyArray<ToolId>} */ (
  Object.freeze(Object.keys(TOOL_CODE_BY_ID))
);
export const TOOL_ID_BY_CODE = Object.freeze(
  Object.fromEntries(TOOL_MANIFEST.map((tool) => [tool.id, tool.toolId])),
);
export const TOOL_BY_ID = Object.freeze(
  Object.fromEntries(TOOL_MANIFEST.map((tool) => [tool.toolId, tool])),
);
export const TOOL_BY_CODE = TOOL_MANIFEST;
export const DRAW_TOOL_IDS = Object.freeze(
  TOOL_MANIFEST.filter((tool) => tool.drawsOnBoard).map((tool) => tool.toolId),
);
export const TOOLBAR_TOOL_IDS = Object.freeze(
  TOOL_MANIFEST.filter((tool) => tool.toolbar).map((tool) => tool.toolId),
);
export const TOOLBAR_TOOLS = Object.freeze(
  TOOL_MANIFEST.filter((tool) => tool.toolbar),
);
export const DRAW_TOOLS = Object.freeze(
  TOOL_MANIFEST.filter((tool) => tool.drawsOnBoard),
);
