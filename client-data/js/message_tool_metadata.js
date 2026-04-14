/**
 * @typedef {string} ToolName
 * @typedef {{shapeType?: string, updatableFields: string[], draw?: boolean}} ToolMetadata
 * @typedef {Record<string, ToolMetadata>} ToolMetadataMap
 * @typedef {Record<string, string[]>} UpdatableFieldMap
 * @typedef {Record<string, string>} ShapeTools
 */

/** @type {ToolMetadataMap} */
export var TOOL_METADATA = Object.create(null);
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
export var DRAW_TOOL_NAMES = [];
/** @type {ShapeTools} */
export var SHAPE_TOOL_TYPES = Object.create(null);
/** @type {UpdatableFieldMap} */
export var TOOL_UPDATE_FIELDS = Object.create(null);
for (var toolName in TOOL_METADATA) {
  const metadata = TOOL_METADATA[toolName];
  if (metadata === undefined) continue;
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
  if (typeof toolName !== "string") return null;
  if (Object.hasOwn(TOOL_METADATA, toolName)) {
    const metadata = TOOL_METADATA[toolName];
    return metadata === undefined ? null : metadata;
  }
  return null;
}

/**
 * @param {string | undefined} toolName
 * @returns {string | undefined}
 */
export function getShapeToolType(toolName) {
  const metadata = getToolMetadata(toolName);
  return metadata ? metadata.shapeType : undefined;
}

/**
 * @param {string | undefined} toolName
 * @returns {string[]}
 */
export function getUpdatableFieldNames(toolName) {
  const metadata = getToolMetadata(toolName);
  if (!metadata) return [];
  return metadata.updatableFields.slice();
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
  /** @type {string[]} */
  var names = [];
  for (var tool in SHAPE_TOOL_TYPES) {
    names.push(tool);
  }
  return names;
}

/**
 * @param {string | undefined} toolName
 * @param {{[key: string]: any}} data
 * @returns {{[key: string]: any}}
 */
export function getUpdatableFields(toolName, data) {
  /** @type {{[key: string]: any}} */
  const updatable = {};
  var fields = getUpdatableFieldNames(toolName);
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (typeof field !== "string") continue;
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

var root = /** @type {typeof globalThis & {
    WBOMessageToolMetadata?: typeof messageToolMetadata,
  }} */ (typeof globalThis !== "undefined" ? globalThis : this);

root.WBOMessageToolMetadata = messageToolMetadata;
export default messageToolMetadata;
