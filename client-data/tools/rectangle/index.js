import {
  constrainEqualSpanToBoard,
  createShapeToolBoot,
  makeBoxShapeUpdateMessage,
  makeSeedShapeCreateMessage,
} from "../shape_tool.js";
import { ToolCodes } from "../tool-order.js";
export {
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";
import {
  defineShapeContract,
  normalizeRectBounds,
  serializeStoredShapeTag,
  storedShapeAttributeNames,
  summarizeStoredShape,
} from "../shape_contract.js";
/** @typedef {import("../shape_tool.js").ShapeCreateMessage<typeof ToolCodes.RECTANGLE>} RectangleCreateMessage */
/** @typedef {import("../shape_tool.js").ShapeBoxUpdateMessage<typeof ToolCodes.RECTANGLE>} RectangleUpdateMessage */

export const toolId = "rectangle";
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = defineShapeContract({
  toolId,
  toolCode: ToolCodes.RECTANGLE,
  storedTagName: "rect",
  storedAttributeNames: storedShapeAttributeNames([
    "x",
    "y",
    "width",
    "height",
  ]),
  updatableFields: /** @type {const} */ (["x", "y", "x2", "y2"]),
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x = helpers.readStoredSvgNumberAttribute(entry, "x");
    const y = helpers.readStoredSvgNumberAttribute(entry, "y");
    const width = helpers.readStoredSvgNumberAttribute(entry, "width");
    const height = helpers.readStoredSvgNumberAttribute(entry, "height");
    const color = helpers.readStoredSvgAttribute(entry, "stroke") || "#000000";
    const size = helpers.readStoredSvgNumberAttribute(entry, "stroke-width");
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
        tool: toolId,
        paintOrder,
        data: {
          x,
          y,
          x2: x + width,
          y2: y + height,
          color,
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
});
export { contract };
export const shortcut = "r";
export const secondary = {
  name: "Square",
  icon: "tools/rectangle/icon-square.svg",
  active: false,
};

/** @type {import("../shape_tool.js").ShapeToolConfig} */
const config = {
  contract,
  secondary,
  uidPrefix: "r",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === contract.storedTagName,
  makeCreateMessage: makeSeedShapeCreateMessage,
  makeUpdateMessage: (state, x, y) => {
    const start = state.currentShape;
    if (!start) return null;
    if (state.secondary?.active) {
      const constrained = constrainEqualSpanToBoard(state, start, x, y);
      x = constrained.x;
      y = constrained.y;
    }
    return makeBoxShapeUpdateMessage(contract.toolCode, start.id, start, x, y);
  },
  makeFallbackShape: (data) => ({
    id: data.id,
    x: data.x2,
    y: data.y2,
    x2: data.x2,
    y2: data.y2,
  }),
  applyShapeGeometry: (rect, data) => {
    const rectangle = /** @type {SVGRectElement} */ (rect);
    rectangle.x.baseVal.value = Math.min(data.x2, data.x);
    rectangle.y.baseVal.value = Math.min(data.y2, data.y);
    rectangle.width.baseVal.value = Math.abs(data.x2 - data.x);
    rectangle.height.baseVal.value = Math.abs(data.y2 - data.y);
  },
};

export const boot = createShapeToolBoot(config);
