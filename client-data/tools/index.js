import * as ClearModule from "./clear/index.js";
import * as CursorModule from "./cursor/index.js";
import * as DownloadModule from "./download/index.js";
import * as EllipseModule from "./ellipse/index.js";
import * as EraserModule from "./eraser/index.js";
import * as GridModule from "./grid/index.js";
import * as HandModule from "./hand/index.js";
import * as PencilModule from "./pencil/index.js";
import * as RectangleModule from "./rectangle/index.js";
import * as StraightLineModule from "./straight-line/index.js";
import * as TextModule from "./text/index.js";
import * as ZoomModule from "./zoom/index.js";
import { TOOLBAR_TOOL_IDS, TOOL_CODE_BY_ID, TOOL_IDS } from "./tool-order.js";
import {
  getDefaultToolLabel,
  getToolIconPath,
  getToolModuleImportPath,
  getToolStylesheetPath,
  getToolTranslationKey,
} from "./tool-defaults.js";
/** @typedef {import("../../types/app-runtime").ToolCode} ToolCode */
/** @typedef {typeof import("./tool-order.js").TOOL_CODE_BY_ID} ToolCodeById */

/**
 * @typedef {{
 *   toolId: string,
 *   id?: ToolCode,
 *   visibleWhenReadOnly?: boolean,
 *   moderatorOnly?: boolean,
 *   drawsOnBoard?: boolean,
 *   storedTagName?: string,
 *   shapeTool?: boolean,
 *   payloadKind?: "inline" | "text" | "children",
 *   updatableFields?: ReadonlyArray<string>,
 *   liveMessageFields?: Readonly<Record<number, Readonly<Record<string, string>>>>,
 *   batchMessageFields?: Readonly<Record<number, Readonly<Record<string, string>>>>,
 *   parseStoredSvgItem?: Function,
 *   summarizeStoredSvgItem?: Function,
 *   serializeStoredSvgItem?: Function,
 *   renderBoardSvg?: Function,
 * }} ToolModuleLike
 */

/**
 * @template {ToolModuleLike} T
 * @param {T} tool
 * @param {ToolCode} toolCode
 * @returns {T & {
 *   id: ToolCode,
 *   visibleWhenReadOnly: boolean,
 *   moderatorOnly: boolean,
 *   drawsOnBoard: boolean,
 *   getIconUrl: () => string,
 *   getStylesheetUrl: () => string | null,
 *   getModuleImportPath: () => string,
 *   translationKey: string,
 *   label: string,
 * }}
 */
function defineTool(tool, toolCode) {
  const contract =
    tool && typeof tool === "object" && "contract" in tool ? tool.contract : {};
  const definition = /** @type {T & Partial<ToolModuleLike>} */ ({
    ...(typeof contract === "object" && contract ? contract : {}),
    ...tool,
  });
  const translationKey = getToolTranslationKey(definition.toolId);
  return {
    ...definition,
    id: toolCode,
    visibleWhenReadOnly: definition.visibleWhenReadOnly === true,
    moderatorOnly: definition.moderatorOnly === true,
    drawsOnBoard: definition.drawsOnBoard === true,
    translationKey,
    label: getDefaultToolLabel(definition.toolId),
    getIconUrl() {
      return `../${getToolIconPath(definition.toolId)}`;
    },
    getStylesheetUrl() {
      const stylesheetPath = getToolStylesheetPath(
        definition.toolId,
        definition.drawsOnBoard === true,
      );
      return stylesheetPath ? `../${stylesheetPath}` : null;
    },
    getModuleImportPath() {
      return getToolModuleImportPath(definition.toolId);
    },
  };
}

const TOOL_MODULES_BY_ID =
  /** @type {{[toolId: string]: ToolModuleLike | undefined}} */ (
    /** @type {unknown} */ ({
      pencil: PencilModule,
      "straight-line": StraightLineModule,
      rectangle: RectangleModule,
      ellipse: EllipseModule,
      text: TextModule,
      eraser: EraserModule,
      hand: HandModule,
      grid: GridModule,
      download: DownloadModule,
      zoom: ZoomModule,
      clear: ClearModule,
      cursor: CursorModule,
    })
  );

export const TOOLS = TOOL_IDS.map((toolId) =>
  defineTool(
    /** @type {ToolModuleLike} */ (TOOL_MODULES_BY_ID[toolId]),
    TOOL_CODE_BY_ID[toolId],
  ),
);

export const TOOL_BY_CODE = TOOLS;
export const DRAW_TOOLS = TOOLS.filter((tool) => tool.drawsOnBoard === true);
export const TOOL_BY_ID =
  /** @type {{[toolId: string]: (typeof TOOLS)[number] | undefined}} */ (
    Object.fromEntries(TOOLS.map((tool) => [tool.toolId, tool]))
  );

/**
 * @param {string} toolId
 * @returns {(typeof TOOLS)[number]}
 */
function getRequiredTool(toolId) {
  return /** @type {(typeof TOOLS)[number]} */ (TOOL_BY_ID[toolId]);
}

/**
 * @template {keyof ToolCodeById} TToolId
 * @param {TToolId} toolId
 * @returns {ReturnType<typeof getRequiredTool> & {id: ToolCodeById[TToolId]}}
 */
function getTypedTool(toolId) {
  return /** @type {ReturnType<typeof getRequiredTool> & {id: ToolCodeById[TToolId]}} */ (
    getRequiredTool(toolId)
  );
}

export const Pencil = getTypedTool("pencil");
export const StraightLine = getTypedTool("straight-line");
export const Rectangle = getTypedTool("rectangle");
export const Ellipse = getTypedTool("ellipse");
export const Text = getTypedTool("text");
export const Eraser = getTypedTool("eraser");
export const Hand = getTypedTool("hand");
export const Grid = getTypedTool("grid");
export const Download = getTypedTool("download");
export const Zoom = getTypedTool("zoom");
export const Clear = getTypedTool("clear");
export const Cursor = getTypedTool("cursor");
export const TOOLBAR_TOOLS = TOOLBAR_TOOL_IDS.map((toolId) =>
  getRequiredTool(toolId),
);
export const TOOL_BY_STORED_TAG_NAME = Object.fromEntries(
  TOOLS.filter((tool) => typeof tool.storedTagName === "string").map((tool) => [
    tool.storedTagName,
    tool,
  ]),
);
