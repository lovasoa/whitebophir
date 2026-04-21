import {
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

const toolName = "Straight line";
/** @type {import("../shape_contract.js").ShapeContract} */
const straightLineContract = {
  toolName,
  storedTagName: "line",
  liveCreateType: "straight",
  updatableFields: ["x2", "y2"],
  drawsOnBoard: true,
  shapeType: "straight",
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x1 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x1"));
    const y1 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y1"));
    const x2 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x2"));
    const y2 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y2"));
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    if (
      x1 === undefined ||
      y1 === undefined ||
      x2 === undefined ||
      y2 === undefined ||
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
          x: x1,
          y: y1,
          x2,
          y2,
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        localBounds: {
          minX: Math.min(x1, x2),
          minY: Math.min(y1, y2),
          maxX: Math.max(x1, x2),
          maxY: Math.max(y1, y2),
        },
      },
      helpers.opacity,
      helpers.transform,
      helpers.decorateStoredItemData,
    );
  },
  serializeStoredSvgItem(item, helpers) {
    return serializeStoredShapeTag(
      "line",
      ` x1="${helpers.numberOrZero(item.x)}" y1="${helpers.numberOrZero(item.y)}"` +
        ` x2="${helpers.numberOrZero(item.x2)}" y2="${helpers.numberOrZero(item.y2)}"`,
      item,
      helpers,
    );
  },
  renderBoardSvg(shape, helpers) {
    return helpers.renderPath(
      shape,
      `M${shape.x} ${shape.y}L${shape.x2} ${shape.y2}`,
    );
  },
};

export default straightLineContract;
