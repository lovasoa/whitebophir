(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  /** @type {any} */ (root).WBOMessageToolMetadata = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /**
   * @typedef {string} ToolName
   * @typedef {Record<string, string[]>} UpdatableFieldMap

   * @typedef {Record<string, string>} ShapeTools
   */

  /** @type {string[]} */
  var DRAW_TOOL_NAMES = [
    "Pencil",
    "Straight line",
    "Rectangle",
    "Ellipse",
    "Text",
  ];
  /** @type {ShapeTools} */
  var SHAPE_TOOL_TYPES = {
    "Straight line": "straight",
    Rectangle: "rect",
    Ellipse: "ellipse",
  };
  /** @type {UpdatableFieldMap} */
  var TOOL_UPDATE_FIELDS = Object.create(null);
  TOOL_UPDATE_FIELDS["Straight line"] = ["x2", "y2"];
  TOOL_UPDATE_FIELDS["Rectangle"] = ["x", "y", "x2", "y2"];
  TOOL_UPDATE_FIELDS["Ellipse"] = ["x", "y", "x2", "y2"];
  TOOL_UPDATE_FIELDS["Text"] = ["txt"];
  TOOL_UPDATE_FIELDS["Hand"] = ["transform"];
  TOOL_UPDATE_FIELDS["Pencil"] = [];
  TOOL_UPDATE_FIELDS["Cursor"] = [];
  TOOL_UPDATE_FIELDS["Eraser"] = [];
  TOOL_UPDATE_FIELDS["Clear"] = [];

  /**
   * @param {string | undefined} toolName
   * @returns {string[]}
   */
  function getUpdatableFieldNames(toolName) {
    if (typeof toolName !== "string") return [];
    if (Object.prototype.hasOwnProperty.call(TOOL_UPDATE_FIELDS, toolName)) {
      return TOOL_UPDATE_FIELDS[toolName] || [];
    }
    return [];
  }

  /**
   * @param {string | undefined} toolName
   * @returns {boolean}
   */
  function isShapeTool(toolName) {
    return (
      typeof toolName === "string" &&
      Object.prototype.hasOwnProperty.call(SHAPE_TOOL_TYPES, toolName)
    );
  }

  /**
   * @returns {string[]}
   */
  function getShapeToolNames() {
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
  function getUpdatableFields(toolName, data) {
    /** @type {{[key: string]: any}} */
    const updatable = {};
    var fields = getUpdatableFieldNames(toolName);
    for (var index = 0; index < fields.length; index++) {
      var field = fields[index];
      if (typeof field !== "string") continue;
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        updatable[field] = data[field];
      }
    }
    return updatable;
  }

  return {
    DRAW_TOOL_NAMES,
    SHAPE_TOOL_TYPES,
    TOOL_UPDATE_FIELDS,
    isShapeTool,
    getShapeToolNames,
    getUpdatableFieldNames,
    getUpdatableFields,
  };
});
