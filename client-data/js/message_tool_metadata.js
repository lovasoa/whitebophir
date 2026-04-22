import { getMutationTypeCode, MutationType } from "./mutation_type.js";
import { TOOL_BY_ID } from "../tools/index.js";
import { TOOL_IDS } from "../tools/tool-order.js";

export { getMutationTypeCode, MutationType };

/** @param {unknown} tool */
export function getToolCode(tool) {
  if (typeof tool === "number") {
    return Number.isSafeInteger(tool) && tool >= 1 && tool <= TOOL_IDS.length
      ? tool
      : undefined;
  }
  if (typeof tool !== "string") return undefined;
  const index = TOOL_IDS.indexOf(tool);
  return index === -1 ? undefined : index + 1;
}

/** @param {unknown} tool */
export function getToolId(tool) {
  if (typeof tool === "string") {
    return TOOL_BY_ID[tool] ? tool : undefined;
  }
  const toolCode = getToolCode(tool);
  return toolCode === undefined ? undefined : TOOL_IDS[toolCode - 1];
}

/** @param {unknown} tool */
export function getTool(tool) {
  const toolId = getToolId(tool);
  return toolId === undefined ? undefined : TOOL_BY_ID[toolId];
}

/** @param {unknown} tool */
export function isShapeTool(tool) {
  return getTool(tool)?.shapeTool === true;
}

/**
 * @param {unknown} tool
 * @param {{[key: string]: unknown}} data
 * @returns {{[key: string]: unknown}}
 */
export function getUpdatableFields(tool, data) {
  /** @type {{[key: string]: unknown}} */
  const updatable = {};
  const fields = getTool(tool)?.updatableFields || [];
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

/** @param {unknown} tool */
export function isToolOwnedBatchTool(tool) {
  return !!getTool(tool)?.batchMessageFields;
}
