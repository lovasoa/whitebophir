import { createShapeToolClass } from "../shape_tool.js";
import { MutationType } from "../../js/mutation_type.js";
import {
  defineShapeContract,
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

const contract = defineShapeContract({
  toolName: "Straight line",
  payloadKind: "inline",
  shapeType: "straight",
  liveCreateType: "straight",
  storedTagName: "line",
  updatableFields: ["x2", "y2"],
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
        tool: "Straight line",
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
});

export default createShapeToolClass({
  contract,
  shortcut: "l",
  icon: "tools/straight-line/icon.svg",
  stylesheet: "tools/straight-line/straight-line.css",
  secondary: {
    name: "Straight line",
    icon: "tools/straight-line/icon-straight.svg",
    active: false,
  },
  uidPrefix: "s",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === contract.storedTagName,
  makeCreateMessage: (tool, id, x, y) => ({
    type: contract.liveCreateType,
    id,
    color: tool.Tools.getColor(),
    size: tool.Tools.getSize(),
    opacity: tool.Tools.getOpacity(),
    x,
    y,
  }),
  makeUpdateMessage: (tool, x, y) => {
    const start = tool.currentShape;
    if (!start) return null;
    if (tool.secondary?.active) {
      let alpha = Math.atan2(y - start.y, x - start.x);
      const d = Math.hypot(y - start.y, x - start.x);
      const increment = (2 * Math.PI) / 16;
      alpha = Math.round(alpha / increment) * increment;
      x = tool.Tools.toBoardCoordinate(start.x + d * Math.cos(alpha));
      y = tool.Tools.toBoardCoordinate(start.y + d * Math.sin(alpha));
    }
    return {
      type: MutationType.UPDATE,
      id: start.id,
      x2: x,
      y2: y,
    };
  },
  makeFallbackShape: (data) => ({
    id: data.id,
    x: data.x2,
    y: data.y2,
    x2: data.x2,
    y2: data.y2,
  }),
  applyShapeGeometry: (shape, data) => {
    const line = /** @type {SVGLineElement} */ (shape);
    if ("x" in data) {
      line.x1.baseVal.value = data.x;
      line.y1.baseVal.value = data.y;
    }
    line.x2.baseVal.value = data.x2 ?? data.x;
    line.y2.baseVal.value = data.y2 ?? data.y;
  },
});
