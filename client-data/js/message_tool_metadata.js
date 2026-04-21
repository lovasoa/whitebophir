import { getMutationTypeCode, MutationType } from "./mutation_type.js";
import { TOOL_BY_ID, TOOLS } from "../tools/index.js";
import { DRAW_TOOL_IDS, TOOL_IDS } from "../tools/tool-order.js";

export { getMutationTypeCode, MutationType };

export const DRAW_TOOL_NAMES = DRAW_TOOL_IDS;
/** @type {{[toolId: string]: string}} */
export const SHAPE_TOOL_TYPES = /** @type {{[toolId: string]: string}} */ (
  Object.fromEntries(
    TOOLS.filter((tool) => typeof tool.shapeType === "string").map((tool) => [
      tool.toolId,
      tool.shapeType,
    ]),
  )
);

/** @param {string | undefined} toolId */
export function getToolCode(toolId) {
  if (typeof toolId !== "string") return undefined;
  const index = TOOL_IDS.indexOf(toolId);
  return index === -1 ? undefined : index + 1;
}

/** @param {string | undefined} toolId */
export function isShapeTool(toolId) {
  return typeof toolId === "string" && !!TOOL_BY_ID[toolId]?.shapeType;
}

/**
 * @param {string | undefined} toolId
 * @param {{[key: string]: unknown}} data
 * @returns {{[key: string]: unknown}}
 */
export function getUpdatableFields(toolId, data) {
  /** @type {{[key: string]: unknown}} */
  const updatable = {};
  if (typeof toolId !== "string") return updatable;
  const fields = TOOL_BY_ID[toolId]?.updatableFields || [];
  for (const field of fields) {
    if (Object.hasOwn(data, field)) updatable[field] = data[field];
  }
  return updatable;
}

/** @param {{tool?: unknown, type?: unknown, id?: unknown, _children?: unknown} | null | undefined} message */
export function getMutationType(message) {
  if (!message || typeof message !== "object") return undefined;
  if (Array.isArray(message._children)) return MutationType.BATCH;
  const mutationType = getMutationTypeCode(message.type);
  if (mutationType !== undefined) return mutationType;
  const toolId = /** @type {{tool?: string | undefined}} */ (message).tool;
  return getToolCode(toolId) !== undefined && typeof message.id === "string"
    ? MutationType.CREATE
    : undefined;
}

/** @param {string | undefined} toolId */
export function isToolOwnedBatchTool(toolId) {
  return typeof toolId === "string" && !!TOOL_BY_ID[toolId]?.batchMessageFields;
}
