(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  /** @type {any} */ (root).WBOMessageToolMetadata = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /**
   * @typedef {"Pencil"|"Straight line"|"Rectangle"|"Ellipse"|"Text"} DrawToolName
   * @typedef {Record<DrawToolName | "Hand", string[]>} UpdatableFieldMap

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
  var TOOL_UPDATE_FIELDS = {
    "Straight line": ["x2", "y2"],
    Rectangle: ["x", "y", "x2", "y2"],
    Ellipse: ["x", "y", "x2", "y2"],
    Text: ["txt"],
    Hand: ["transform"],
    Pencil: [],
    Cursor: [],
    Eraser: [],
    Clear: [],
  };

  /**
   * @param {keyof UpdatableFieldMap} toolName
   * @returns {string[]}
   */
  function getUpdatableFieldNames(toolName) {
    return TOOL_UPDATE_FIELDS[toolName] || [];
  }

  /**
   * @param {string} toolName
   * @param {{[key: string]: any}} data
   * @returns {{[key: string]: any}}
   */
  function getUpdatableFields(toolName, data) {
    const updatable = {};
    var fields = getUpdatableFieldNames(
      /** @type {keyof UpdatableFieldMap} */ (toolName),
    );
    for (var index = 0; index < fields.length; index++) {
      var field = fields[index];
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
    getUpdatableFieldNames,
    getUpdatableFields,
  };
});
