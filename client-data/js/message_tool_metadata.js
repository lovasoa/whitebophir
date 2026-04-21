import { TOOL_CATALOG } from "./tool_catalog.js";

/** @typedef {{updatableFields: string[], draw?: boolean, shapeType?: string}} ToolMetadata */

export const MutationType = Object.freeze({
  CREATE: 1,
  UPDATE: 2,
  DELETE: 3,
  APPEND: 4,
  BATCH: 5,
  CLEAR: 6,
  COPY: 7,
});

/** @type {{[toolName: string]: ToolMetadata}} */
export const TOOL_METADATA = {
  Pencil: { updatableFields: [], draw: true },
  "Straight line": {
    shapeType: "straight",
    updatableFields: ["x2", "y2"],
    draw: true,
  },
  Rectangle: {
    shapeType: "rect",
    updatableFields: ["x", "y", "x2", "y2"],
    draw: true,
  },
  Ellipse: {
    shapeType: "ellipse",
    updatableFields: ["x", "y", "x2", "y2"],
    draw: true,
  },
  Text: { updatableFields: ["txt"], draw: true },
  Hand: { updatableFields: ["transform"] },
  Cursor: { updatableFields: [] },
  Eraser: { updatableFields: [] },
  Clear: { updatableFields: [] },
};

const TOOL_NAMES = TOOL_CATALOG.map((entry) => entry.name);
TOOL_NAMES.push("Cursor");

/** @type {string[]} */
export const DRAW_TOOL_NAMES = [];
/** @type {{[toolName: string]: string}} */
export const SHAPE_TOOL_TYPES = Object.create(null);
for (const [toolName, metadata] of Object.entries(TOOL_METADATA)) {
  if (metadata.draw === true) DRAW_TOOL_NAMES.push(toolName);
  if (metadata.shapeType !== undefined) {
    SHAPE_TOOL_TYPES[toolName] = metadata.shapeType;
  }
}

/** @param {string | undefined} toolName */
export function getToolCode(toolName) {
  if (typeof toolName !== "string") return undefined;
  const index = TOOL_NAMES.indexOf(toolName);
  return index === -1 ? undefined : index + 1;
}

/** @param {string | undefined} toolName */
export function isShapeTool(toolName) {
  return (
    typeof toolName === "string" && SHAPE_TOOL_TYPES[toolName] !== undefined
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
  const metadata =
    typeof toolName === "string" ? TOOL_METADATA[toolName] : undefined;
  for (const field of metadata?.updatableFields || []) {
    if (Object.hasOwn(data, field)) updatable[field] = data[field];
  }
  return updatable;
}

/** @param {{tool?: unknown, type?: unknown, id?: unknown, _children?: unknown} | null | undefined} message */
export function getMutationType(message) {
  if (!message || typeof message !== "object") return undefined;
  if (Array.isArray(message._children)) return MutationType.BATCH;
  switch (message.type) {
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
  const toolName = /** @type {{tool?: string | undefined}} */ (message).tool;
  return typeof toolName === "string" &&
    TOOL_METADATA[toolName] &&
    typeof message.id === "string"
    ? MutationType.CREATE
    : undefined;
}

/** @param {string | undefined} toolName */
export function isToolOwnedBatchTool(toolName) {
  return toolName === "Hand";
}
