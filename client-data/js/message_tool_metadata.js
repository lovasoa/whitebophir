import { getMutationTypeCode, MutationType } from "./mutation_type.js";
import { TOOL_BY_CODE, TOOL_BY_ID } from "../tools/index.js";
import { TOOL_IDS } from "../tools/tool-order.js";
/** @typedef {import("../../types/app-runtime").ToolCode} ToolCode */

export { getMutationTypeCode, MutationType };

const MUTATION_TYPE_NAME_BY_CODE = Object.freeze({
  [MutationType.CREATE]: "create",
  [MutationType.UPDATE]: "update",
  [MutationType.DELETE]: "delete",
  [MutationType.APPEND]: "append",
  [MutationType.BATCH]: "batch",
  [MutationType.CLEAR]: "clear",
  [MutationType.COPY]: "copy",
});

/**
 * @param {unknown} tool
 * @returns {ToolCode | undefined}
 */
export function getToolCode(tool) {
  return typeof tool === "number" &&
    Number.isSafeInteger(tool) &&
    tool >= 1 &&
    tool <= TOOL_IDS.length
    ? /** @type {ToolCode} */ (tool)
    : undefined;
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
  if (typeof tool === "string") return TOOL_BY_ID[tool];
  const toolCode = getToolCode(tool);
  return toolCode === undefined ? undefined : TOOL_BY_CODE[toolCode - 1];
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

/**
 * @param {unknown} type
 * @returns {string | undefined}
 */
export function formatMessageTypeTag(type) {
  if (typeof type === "string" && type) return type;
  const mutationType = getMutationTypeCode(type);
  return mutationType === undefined
    ? undefined
    : MUTATION_TYPE_NAME_BY_CODE[mutationType];
}
