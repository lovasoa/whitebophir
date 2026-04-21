import {
  DRAW_TOOL_NAMES,
  TOOL_CATALOG,
  getToolCatalogEntry,
} from "./tool_catalog.js";
import { getMutationTypeCode, MutationType } from "./mutation_type.js";
import { TOOL_CONTRACTS_BY_NAME } from "../tools/tool_contracts.js";

export { getMutationTypeCode, MutationType };

const TOOL_NAMES = [...TOOL_CATALOG.map((entry) => entry.name), "Cursor"];
export { DRAW_TOOL_NAMES };
/** @type {{[toolName: string]: string}} */
export const SHAPE_TOOL_TYPES = /** @type {{[toolName: string]: string}} */ (
  Object.fromEntries(
    Object.values(TOOL_CONTRACTS_BY_NAME)
      .filter((contract) => typeof contract.shapeType === "string")
      .map((contract) => [contract.toolName, contract.shapeType]),
  )
);

/** @param {string | undefined} toolName */
export function getToolCode(toolName) {
  if (typeof toolName !== "string") return undefined;
  const index = TOOL_NAMES.indexOf(toolName);
  return index === -1 ? undefined : index + 1;
}

/** @param {string | undefined} toolName */
export function isShapeTool(toolName) {
  return (
    typeof toolName === "string" &&
    !!TOOL_CONTRACTS_BY_NAME[toolName]?.shapeType
  );
}

/**
 * @param {string | undefined} toolName
 * @param {{[key: string]: unknown}} data
 * @returns {{[key: string]: unknown}}
 */
export function getUpdatableFields(toolName, data) {
  /** @type {{[key: string]: unknown}} */
  const updatable = {};
  if (typeof toolName !== "string") return updatable;
  const fields =
    TOOL_CONTRACTS_BY_NAME[toolName]?.updatableFields ||
    getToolCatalogEntry(toolName)?.updatableFields ||
    [];
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
  const toolName = /** @type {{tool?: string | undefined}} */ (message).tool;
  return getToolCode(toolName) !== undefined && typeof message.id === "string"
    ? MutationType.CREATE
    : undefined;
}

/** @param {string | undefined} toolName */
export function isToolOwnedBatchTool(toolName) {
  return (
    typeof toolName === "string" &&
    getToolCatalogEntry(toolName)?.batchMessageFields !== undefined
  );
}
