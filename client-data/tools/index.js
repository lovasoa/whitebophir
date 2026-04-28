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
/** @typedef {import("./shape_contract.js").ToolContract} ToolContract */
/** @typedef {typeof import("./tool-order.js").TOOL_CODE_BY_ID} ToolCodeById */
/**
 * @typedef {{
 *   toolId: string,
 *   contract?: ToolContract,
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
 * }} ToolModuleLike
 */
/** @typedef {{[TToolId in keyof ToolCodeById]: ToolModuleLike & {toolId: TToolId}}} ToolModulesById */
/** @typedef {(typeof TOOLS)[number]} ToolDefinition */
/** @typedef {{[TToolId in keyof ToolCodeById]: ToolDefinition & {toolId: TToolId, id: ToolCodeById[TToolId]}} & {[toolId: string]: ToolDefinition | undefined}} ToolDefinitionsById */

/**
 * @param {ToolModuleLike} tool
 * @param {ToolCode} toolCode
 * @returns {ToolModuleLike & Partial<ToolContract> & {
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
  const definition = /** @type {ToolModuleLike & Partial<ToolContract>} */ ({
    ...(tool.contract || {}),
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

export const TOOL_MODULES_BY_ID = /** @satisfies {ToolModulesById} */ ({
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
});

export const TOOLS = TOOL_IDS.map((toolId) =>
  defineTool(TOOL_MODULES_BY_ID[toolId], TOOL_CODE_BY_ID[toolId]),
);

export const TOOL_BY_CODE = TOOLS;
export const DRAW_TOOLS = TOOLS.filter((tool) => tool.drawsOnBoard === true);
export const TOOL_BY_ID = /** @type {ToolDefinitionsById} */ (
  Object.fromEntries(TOOLS.map((tool) => [tool.toolId, tool]))
);

export const Pencil = TOOL_BY_ID.pencil;
export const StraightLine = TOOL_BY_ID["straight-line"];
export const Rectangle = TOOL_BY_ID.rectangle;
export const Ellipse = TOOL_BY_ID.ellipse;
export const Text = TOOL_BY_ID.text;
export const Eraser = TOOL_BY_ID.eraser;
export const Hand = TOOL_BY_ID.hand;
export const Grid = TOOL_BY_ID.grid;
export const Download = TOOL_BY_ID.download;
export const Zoom = TOOL_BY_ID.zoom;
export const Clear = TOOL_BY_ID.clear;
export const Cursor = TOOL_BY_ID.cursor;
export const TOOLBAR_TOOLS = /** @type {ReadonlyArray<ToolDefinition>} */ (
  TOOLBAR_TOOL_IDS.map(
    (toolId) => /** @type {ToolDefinition} */ (TOOL_BY_ID[toolId]),
  )
);
export const TOOL_BY_STORED_TAG_NAME = Object.fromEntries(
  TOOLS.filter((tool) => typeof tool.storedTagName === "string").map((tool) => [
    tool.storedTagName,
    tool,
  ]),
);
