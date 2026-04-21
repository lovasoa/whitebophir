import {
  normalizeRectBounds,
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

const toolName = "Rectangle";
/** @type {import("../shape_contract.js").ShapeContract} */
const rectangleContract = {
  toolName,
  storedTagName: "rect",
  liveCreateType: "rect",
  updatableFields: ["x", "y", "x2", "y2"],
  drawsOnBoard: true,
  shapeType: "rect",
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x"));
    const y = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y"));
    const width = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "width"),
    );
    const height = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "height"),
    );
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      size === undefined
    ) {
      return null;
    }
    return summarizeStoredShape(
      {
        id: helpers.id,
        tool: toolName,
        paintOrder,
        data: {
          x,
          y,
          x2: x + width,
          y2: y + height,
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        localBounds: {
          minX: x,
          minY: y,
          maxX: x + width,
          maxY: y + height,
        },
      },
      helpers.opacity,
      helpers.transform,
      helpers.decorateStoredItemData,
    );
  },
  serializeStoredSvgItem(item, helpers) {
    const bounds = normalizeRectBounds(
      helpers.numberOrZero(item.x),
      helpers.numberOrZero(item.y),
      helpers.numberOrZero(item.x2),
      helpers.numberOrZero(item.y2),
    );
    return serializeStoredShapeTag(
      "rect",
      ` x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"`,
      item,
      helpers,
    );
  },
  renderBoardSvg(shape, helpers) {
    const bounds = normalizeRectBounds(shape.x, shape.y, shape.x2, shape.y2);
    return (
      "<rect " +
      (shape.id ? `id="${helpers.htmlspecialchars(shape.id)}" ` : "") +
      `x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" ` +
      `stroke="${helpers.htmlspecialchars(shape.color)}" stroke-width="${helpers.numberOrZero(shape.size) | 0}" ` +
      helpers.renderTranslate(shape) +
      "/>"
    );
  },
};

export default rectangleContract;
