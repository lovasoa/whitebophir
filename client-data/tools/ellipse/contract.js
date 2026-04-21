import {
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

const toolName = "Ellipse";
/** @type {import("../shape_contract.js").ShapeContract} */
const ellipseContract = {
  toolName,
  storedTagName: "ellipse",
  liveCreateType: "ellipse",
  updatableFields: ["x", "y", "x2", "y2"],
  drawsOnBoard: true,
  shapeType: "ellipse",
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const cx = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "cx"));
    const cy = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "cy"));
    const rx = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "rx"));
    const ry = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "ry"));
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    if (
      cx === undefined ||
      cy === undefined ||
      rx === undefined ||
      ry === undefined ||
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
          x: cx - rx,
          y: cy - ry,
          x2: cx + rx,
          y2: cy + ry,
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        localBounds: {
          minX: cx - rx,
          minY: cy - ry,
          maxX: cx + rx,
          maxY: cy + ry,
        },
      },
      helpers.opacity,
      helpers.transform,
      helpers.decorateStoredItemData,
    );
  },
  serializeStoredSvgItem(item, helpers) {
    const x = helpers.numberOrZero(item.x);
    const y = helpers.numberOrZero(item.y);
    const x2 = helpers.numberOrZero(item.x2);
    const y2 = helpers.numberOrZero(item.y2);
    return serializeStoredShapeTag(
      "ellipse",
      ` cx="${Math.round((x + x2) / 2)}" cy="${Math.round((y + y2) / 2)}" rx="${Math.abs(x2 - x) / 2}" ry="${Math.abs(y2 - y) / 2}"`,
      item,
      helpers,
    );
  },
  renderBoardSvg(shape, helpers) {
    const cx = Math.round((shape.x2 + shape.x) / 2);
    const cy = Math.round((shape.y2 + shape.y) / 2);
    const rx = Math.abs(shape.x2 - shape.x) / 2;
    const ry = Math.abs(shape.y2 - shape.y) / 2;
    return helpers.renderPath(
      shape,
      `M${cx - rx} ${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 ${rx * -2},0`,
    );
  },
};

export default ellipseContract;
