import { createShapeToolBoot } from "../shape_tool.js";
export {
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";
import { MutationType } from "../../js/mutation_type.js";
import {
  defineShapeContract,
  normalizeRectBounds,
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

export const toolId = "rectangle";
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = defineShapeContract({
  toolId,
  storedTagName: "rect",
  updatableFields: ["x", "y", "x2", "y2"],
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
        tool: toolId,
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
  makeCreateMessage: (state, id, x, y) => ({
    type: MutationType.CREATE,
    id,
    color: state.Tools.getColor(),
    size: state.Tools.getSize(),
    opacity: state.Tools.getOpacity(),
    x,
    y,
    x2: x,
    y2: y,
  }),
  makeUpdateMessage: (state, x, y) => {
    const start = state.currentShape;
    if (!start) return null;
    if (state.secondary?.active) {
      const dx = x - start.x;
      const dy = y - start.y;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      x = start.x + (dx > 0 ? d : -d);
      y = start.y + (dy > 0 ? d : -d);
    }
    return {
      type: MutationType.UPDATE,
      id: start.id,
      x: start.x,
      y: start.y,
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
    const rect = /** @type {SVGRectElement} */ (shape);
    rect.x.baseVal.value = Math.min(data.x2, data.x);
    rect.y.baseVal.value = Math.min(data.y2, data.y);
    rect.width.baseVal.value = Math.abs(data.x2 - data.x);
    rect.height.baseVal.value = Math.abs(data.y2 - data.y);
  },
};

export const boot = createShapeToolBoot(config);
