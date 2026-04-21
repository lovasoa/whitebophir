import * as Clear from "./clear/index.js";
import * as Cursor from "./cursor/index.js";
import * as Download from "./download/index.js";
import * as Ellipse from "./ellipse/index.js";
import * as Eraser from "./eraser/index.js";
import * as Grid from "./grid/index.js";
import * as Hand from "./hand/index.js";
import * as Pencil from "./pencil/index.js";
import * as Rectangle from "./rectangle/index.js";
import * as StraightLine from "./straight-line/index.js";
import * as Text from "./text/index.js";
import * as Zoom from "./zoom/index.js";
import { TOOLBAR_TOOL_IDS, TOOL_IDS } from "./tool-order.js";
import {
  getDefaultToolLabel,
  getToolIconPath,
  getToolModuleImportPath,
  getToolStylesheetPath,
  getToolTranslationKey,
  withVersion,
} from "./tool-defaults.js";

/**
 * @typedef {{
 *   toolId: string,
 *   visibleWhenReadOnly?: boolean,
 *   moderatorOnly?: boolean,
 *   drawsOnBoard?: boolean,
 *   storedTagName?: string,
 *   shapeType?: string,
 *   payloadKind?: "inline" | "text" | "children",
 *   updatableFields?: string[],
 *   liveMessageFields?: {[type: string]: {[field: string]: string}},
 *   batchMessageFields?: {[type: string]: {[field: string]: string}},
 *   storedFields?: {[field: string]: string},
 *   liveCreateType?: string,
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
 * @returns {T & {
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
function defineTool(tool) {
  const contract =
    tool && typeof tool === "object" && "contract" in tool ? tool.contract : {};
  const definition = /** @type {T & Partial<ToolModuleLike>} */ ({
    ...(typeof contract === "object" && contract ? contract : {}),
    ...tool,
  });
  const translationKey = getToolTranslationKey(definition.toolId);
  return {
    ...definition,
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

const TOOL_MODULES_BY_ID = {
  pencil: Pencil,
  "straight-line": StraightLine,
  rectangle: Rectangle,
  ellipse: Ellipse,
  text: Text,
  eraser: Eraser,
  hand: Hand,
  grid: Grid,
  download: Download,
  zoom: Zoom,
  clear: Clear,
  cursor: Cursor,
};

/** @type {{[toolId: string]: ToolModuleLike}} */
const TOOL_MODULES_BY_ID_LOOKUP = TOOL_MODULES_BY_ID;

export const TOOLS = TOOL_IDS.map((toolId) =>
  defineTool(/** @type {ToolModuleLike} */ (TOOL_MODULES_BY_ID_LOOKUP[toolId])),
);

export const DRAW_TOOLS = TOOLS.filter((tool) => tool.drawsOnBoard === true);
export const TOOL_BY_ID = Object.fromEntries(
  TOOLS.map((tool) => [tool.toolId, tool]),
);
export const TOOLBAR_TOOLS = TOOLBAR_TOOL_IDS.map(
  (toolId) => TOOL_BY_ID[toolId],
).filter((tool) => tool);
export const TOOL_BY_STORED_TAG_NAME = Object.fromEntries(
  TOOLS.filter((tool) => typeof tool.storedTagName === "string").map((tool) => [
    tool.storedTagName,
    tool,
  ]),
);
