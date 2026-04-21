import { TOOL_CATALOG, TOOL_CATALOG_BY_NAME } from "./tool_catalog.js";

export const MutationType = Object.freeze({
  CREATE: 1,
  UPDATE: 2,
  DELETE: 3,
  APPEND: 4,
  BATCH: 5,
  CLEAR: 6,
  COPY: 7,
});

/**
 * @param {unknown} type
 * @returns {number | undefined}
 */
export function getMutationTypeCode(type) {
  if (typeof type === "number") {
    return type >= MutationType.CREATE && type <= MutationType.COPY
      ? type
      : undefined;
  }
  switch (type) {
    case "update":
      return MutationType.UPDATE;
    case "delete":
      return MutationType.DELETE;
    case "clear":
      return MutationType.CLEAR;
    case "copy":
      return MutationType.COPY;
    case "child":
      return MutationType.APPEND;
  }
  return undefined;
}

const TOOL_NAMES = [...TOOL_CATALOG.map((entry) => entry.name), "Cursor"];

export const DRAW_TOOL_NAMES = TOOL_CATALOG.filter(
  ({ drawsOnBoard }) => drawsOnBoard === true,
).map(({ name }) => name);
/** @type {{[toolName: string]: string}} */
export const SHAPE_TOOL_TYPES = /** @type {{[toolName: string]: string}} */ (
  Object.fromEntries(
    TOOL_CATALOG.filter((entry) => typeof entry.shapeType === "string").map(
      (entry) => [entry.name, entry.shapeType],
    ),
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
    TOOL_CATALOG_BY_NAME[toolName]?.shapeType !== undefined
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
  for (const field of TOOL_CATALOG_BY_NAME[toolName]?.updatableFields || []) {
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
    TOOL_CATALOG_BY_NAME[toolName]?.batchMessageFields !== undefined
  );
}
