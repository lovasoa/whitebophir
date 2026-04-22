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
import { TOOLBAR_TOOL_IDS, TOOL_IDS } from "./tool-order.js";
import {
  getDefaultToolLabel,
  getToolIconPath,
  getToolModuleImportPath,
  getToolStylesheetPath,
  getToolTranslationKey,
  withVersion,
} from "./tool-defaults.js";
/** @typedef {import("../../types/app-runtime").ToolCode} ToolCode */

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
 *   updatableFields?: string[],
 *   liveMessageFields?: {[type: number]: {[field: string]: string}},
 *   batchMessageFields?: {[type: number]: {[field: string]: string}},
 *   storedFields?: {[field: string]: string},
 *   normalizeStoredItemData?: Function,
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
 *   getIconUrl: (version: string) => string,
 *   getStylesheetUrl: (version: string) => string | null,
 *   getModuleImportPath: (version?: string) => string,
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
    getIconUrl(version) {
      return withVersion(`../${getToolIconPath(definition.toolId)}`, version);
    },
    getStylesheetUrl(version) {
      const stylesheetPath = getToolStylesheetPath(
        definition.toolId,
        definition.drawsOnBoard === true,
      );
      return stylesheetPath
        ? withVersion(`../${stylesheetPath}`, version)
        : null;
    },
    getModuleImportPath(version = "") {
      return withVersion(getToolModuleImportPath(definition.toolId), version);
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

export const TOOLS = TOOL_IDS.map((toolId, index) =>
  defineTool(
    /** @type {ToolModuleLike} */ (TOOL_MODULES_BY_ID[toolId]),
    /** @type {ToolCode} */ (index + 1),
  ),
);

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

export const Pencil = getRequiredTool("pencil");
export const StraightLine = getRequiredTool("straight-line");
export const Rectangle = getRequiredTool("rectangle");
export const Ellipse = getRequiredTool("ellipse");
export const Text = getRequiredTool("text");
export const Eraser = getRequiredTool("eraser");
export const Hand = getRequiredTool("hand");
export const Grid = getRequiredTool("grid");
export const Download = getRequiredTool("download");
export const Zoom = getRequiredTool("zoom");
export const Clear = getRequiredTool("clear");
export const Cursor = getRequiredTool("cursor");
export const TOOLBAR_TOOLS = TOOLBAR_TOOL_IDS.map((toolId) =>
  getRequiredTool(toolId),
);
export const TOOL_BY_STORED_TAG_NAME = Object.fromEntries(
  TOOLS.filter((tool) => typeof tool.storedTagName === "string").map((tool) => [
    tool.storedTagName,
    tool,
  ]),
);
