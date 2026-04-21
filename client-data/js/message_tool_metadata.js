/**
 * @typedef {string} ToolName
 * @typedef {{shapeType?: string, updatableFields: string[], draw?: boolean}} ToolMetadata
 * @typedef {Record<string, ToolMetadata>} ToolMetadataMap
 * @typedef {Record<string, string[]>} UpdatableFieldMap
 * @typedef {Record<string, string>} ShapeTools
 */

/** @type {ToolMetadataMap} */
export const TOOL_METADATA = Object.create(null);
TOOL_METADATA.Pencil = {
  updatableFields: [],
  draw: true,
};
TOOL_METADATA["Straight line"] = {
  shapeType: "straight",
  updatableFields: ["x2", "y2"],
  draw: true,
};
TOOL_METADATA.Rectangle = {
  shapeType: "rect",
  updatableFields: ["x", "y", "x2", "y2"],
  draw: true,
};
TOOL_METADATA.Ellipse = {
  shapeType: "ellipse",
  updatableFields: ["x", "y", "x2", "y2"],
  draw: true,
};
TOOL_METADATA.Text = {
  updatableFields: ["txt"],
  draw: true,
};
TOOL_METADATA.Hand = {
  updatableFields: ["transform"],
};
TOOL_METADATA.Cursor = {
  updatableFields: [],
};
TOOL_METADATA.Eraser = {
  updatableFields: [],
};
TOOL_METADATA.Clear = {
  updatableFields: [],
};

/** @type {string[]} */
export const DRAW_TOOL_NAMES = [];
/** @type {ShapeTools} */
export const SHAPE_TOOL_TYPES = Object.create(null);
/** @type {UpdatableFieldMap} */
export const TOOL_UPDATE_FIELDS = Object.create(null);
for (const toolName in TOOL_METADATA) {
  const metadata = TOOL_METADATA[toolName];
  if (!metadata) continue;
  TOOL_UPDATE_FIELDS[toolName] = metadata.updatableFields;
  if (metadata.draw === true) {
    DRAW_TOOL_NAMES.push(toolName);
  }
  if (metadata.shapeType !== undefined) {
    SHAPE_TOOL_TYPES[toolName] = metadata.shapeType;
  }
}

/**
 * @param {string | undefined} toolName
 * @returns {ToolMetadata | null}
 */
export function getToolMetadata(toolName) {
  return typeof toolName === "string" && Object.hasOwn(TOOL_METADATA, toolName)
    ? (TOOL_METADATA[toolName] ?? null)
    : null;
}

/**
 * @param {string | undefined} toolName
 * @returns {string | undefined}
 */
export function getShapeToolType(toolName) {
  return typeof toolName === "string" ? SHAPE_TOOL_TYPES[toolName] : undefined;
}

/**
 * @param {string | undefined} toolName
 * @returns {string[]}
 */
export function getUpdatableFieldNames(toolName) {
  return typeof toolName === "string"
    ? (TOOL_UPDATE_FIELDS[toolName] || []).slice()
    : [];
}

/**
 * @param {string | undefined} toolName
 * @returns {boolean}
 */
export function isShapeTool(toolName) {
  return getShapeToolType(toolName) !== undefined;
}

/**
 * @returns {string[]}
 */
export function getShapeToolNames() {
  return Object.keys(SHAPE_TOOL_TYPES);
}

/**
 * @param {string | undefined} toolName
 * @param {{[key: string]: unknown}} data
 * @returns {{[key: string]: unknown}}
 */
export function getUpdatableFields(toolName, data) {
  /** @type {{[key: string]: unknown}} */
  const updatable = {};
  for (const field of getUpdatableFieldNames(toolName)) {
    if (Object.hasOwn(data, field)) {
      updatable[field] = data[field];
    }
  }
  return updatable;
}

const messageToolMetadata = {
  getToolMetadata,
  getShapeToolType,
  DRAW_TOOL_NAMES,
  SHAPE_TOOL_TYPES,
  TOOL_UPDATE_FIELDS,
  isShapeTool,
  getShapeToolNames,
  getUpdatableFieldNames,
  getUpdatableFields,
};
export default messageToolMetadata;
