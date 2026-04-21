import { TOOL_CATALOG_BY_NAME } from "../../js/tool_catalog.js";

const toolName = /** @type {string} */ (TOOL_CATALOG_BY_NAME.Text?.name);

/**
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} textLength
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
function textBoundsFromLength(x, y, size, textLength) {
  return {
    minX: x,
    minY: y - size,
    maxX: x + size * textLength,
    maxY: y,
  };
}

/** @type {import("../shape_contract.js").ToolContract} */
const textContract = {
  toolName,
  liveMessageFields: {
    new: {
      id: "id",
      color: "color",
      size: "size",
      opacity: "opacity?",
      x: "coord",
      y: "coord",
    },
    update: {
      id: "id",
      txt: "text",
    },
  },
  storedFields: {
    color: "color",
    size: "size",
    opacity: "opacity?",
    x: "coord",
    y: "coord",
    txt: "text?",
    transform: "transform?",
    time: "time?",
  },
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x"));
    const y = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y"));
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "font-size"),
    );
    if (x === undefined || y === undefined || size === undefined) {
      return null;
    }
    const textLength = helpers.decodedTextLength(entry.content || "");
    return {
      id: helpers.id,
      tool: toolName,
      paintOrder,
      data: helpers.decorateStoredItemData(
        {
          x,
          y,
          size,
          color: helpers.readStoredSvgAttribute(entry, "fill") || "#000000",
        },
        helpers.opacity,
        helpers.transform,
      ),
      textLength,
      localBounds: textBoundsFromLength(x, y, size, textLength),
    };
  },
  parseStoredSvgItem(summary, entry, helpers) {
    return {
      id: summary.id,
      tool: toolName,
      ...summary.data,
      txt: helpers.unescapeHtml(entry.content || ""),
    };
  },
  serializeStoredSvgItem(item, helpers) {
    const transform = helpers.renderTransformAttribute(item.transform);
    const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
    const color = helpers.escapeHtml(item.color || "#000000");
    const opacity =
      typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
    const textValue = String(item.txt || "");
    return (
      `<text id="${id}" x="${helpers.numberOrZero(item.x)}" y="${helpers.numberOrZero(item.y)}"` +
      ` font-size="${helpers.numberOrZero(item.size) | 0}" fill="${color}"${opacity}${transform}>` +
      `${helpers.escapeHtml(textValue)}</text>`
    );
  },
  renderBoardSvg(text, helpers) {
    return (
      "<text " +
      'id="' +
      helpers.htmlspecialchars(text.id || "t") +
      '" ' +
      'x="' +
      (text.x | 0) +
      '" ' +
      'y="' +
      (text.y | 0) +
      '" ' +
      'font-size="' +
      (helpers.numberOrZero(text.size) | 0) +
      '" ' +
      'fill="' +
      helpers.htmlspecialchars(text.color || "#000") +
      '" ' +
      helpers.renderTranslate(text) +
      ">" +
      helpers.htmlspecialchars(text.txt || "") +
      "</text>"
    );
  },
};

export default textContract;
