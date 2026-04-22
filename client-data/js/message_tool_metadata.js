import { getMutationTypeCode, MutationType } from "./mutation_type.js";
import { TOOL_BY_ID } from "../tools/index.js";
import { TOOL_IDS } from "../tools/tool-order.js";

export { getMutationTypeCode, MutationType };

/** @param {string | undefined} toolId */
export function getToolCode(toolId) {
  if (typeof toolId !== "string") return undefined;
  const index = TOOL_IDS.indexOf(toolId);
  return index === -1 ? undefined : index + 1;
}

/** @param {string | undefined} toolId */
export function isShapeTool(toolId) {
  return typeof toolId === "string" && TOOL_BY_ID[toolId]?.shapeTool === true;
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
  return getMutationTypeCode(message.type);
}

/** @param {string | undefined} toolId */
export function isToolOwnedBatchTool(toolId) {
  return typeof toolId === "string" && !!TOOL_BY_ID[toolId]?.batchMessageFields;
}
