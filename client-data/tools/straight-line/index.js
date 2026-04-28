import {
  createShapeToolBoot,
  makeLineShapeUpdateMessage,
  makeSeedShapeCreateMessage,
} from "../shape_tool.js";
import { TOOL_CODE_BY_ID } from "../tool-order.js";
export {
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";
import {
  defineShapeContract,
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

export const toolId = "straight-line";
const toolCode = TOOL_CODE_BY_ID[toolId];
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = defineShapeContract({
  toolId,
  toolCode,
  storedTagName: "line",
  updatableFields: /** @type {const} */ (["x2", "y2"]),
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
        tool: toolId,
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
/** @typedef {import("../shape_tool.js").ShapeCreateMessage<typeof contract.toolCode>} StraightLineCreateMessage */
/** @typedef {import("../shape_tool.js").ShapeLineUpdateMessage<typeof contract.toolCode>} StraightLineUpdateMessage */
export { contract };
export const shortcut = "l";
export const secondary = {
  name: "Straight line",
  icon: "tools/straight-line/icon-straight.svg",
  active: false,
};

/** @type {import("../shape_tool.js").ShapeToolConfig} */
const config = {
  contract,
  secondary,
  uidPrefix: "s",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === contract.storedTagName,
  makeCreateMessage: makeSeedShapeCreateMessage,
  makeUpdateMessage: (state, x, y) => {
    const start = state.currentShape;
    if (!start) return null;
    if (state.secondary?.active) {
      let alpha = Math.atan2(y - start.y, x - start.x);
      const d = Math.hypot(y - start.y, x - start.x);
      const increment = (2 * Math.PI) / 16;
      alpha = Math.round(alpha / increment) * increment;
      x = state.coordinates.toBoardCoordinate(start.x + d * Math.cos(alpha));
      y = state.coordinates.toBoardCoordinate(start.y + d * Math.sin(alpha));
    }
    return makeLineShapeUpdateMessage(contract.toolCode, start.id, x, y);
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
    if (typeof data.x === "number" && typeof data.y === "number") {
      line.x1.baseVal.value = data.x;
      line.y1.baseVal.value = data.y;
    }
    line.x2.baseVal.value = data.x2;
    line.y2.baseVal.value = data.y2;
  },
};

export const boot = createShapeToolBoot(config);
