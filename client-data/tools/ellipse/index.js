import { createShapeToolBoot, moveShapeTool } from "../shape_tool.js";
export {
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";
import { MutationType } from "../../js/mutation_type.js";
import {
  defineShapeContract,
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

export const toolId = "ellipse";
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = defineShapeContract({
  toolId,
  storedTagName: "ellipse",
  updatableFields: ["x", "y", "x2", "y2"],
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
        tool: toolId,
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
});
export { contract };
export const shortcut = "c";

/** @type {import("../shape_tool.js").ShapeToolConfig} */
const config = {
  contract,
  secondary: {
    name: "Circle",
    icon: "tools/ellipse/icon-circle.svg",
    active: false,
    switch: (state) => {
      if (!state.currentShape) return;
      moveShapeTool(state, state.lastPos.x, state.lastPos.y, undefined);
    },
  },
  uidPrefix: "e",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === contract.storedTagName,
  makeCreateMessage: (state, id, x, y) => {
    state.lastPos = { x, y };
    return {
      type: MutationType.CREATE,
      id,
      color: state.Tools.getColor(),
      size: state.Tools.getSize(),
      opacity: state.Tools.getOpacity(),
      x,
      y,
      x2: x,
      y2: y,
    };
  },
  makeUpdateMessage: (state, x, y, evt) => {
    const start = state.currentShape;
    if (!start) return null;
    if (evt) {
      state.secondary.active = state.secondary.active || evt.shiftKey;
    }
    state.lastPos = { x, y };
    if (state.secondary?.active) {
      const deltaX = x - start.x;
      const deltaY = y - start.y;
      const diameter = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      x = start.x + (deltaX > 0 ? diameter : -diameter);
      y = start.y + (deltaY > 0 ? diameter : -diameter);
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
    const ellipse = /** @type {SVGEllipseElement} */ (shape);
    ellipse.cx.baseVal.value = Math.round((data.x2 + data.x) / 2);
    ellipse.cy.baseVal.value = Math.round((data.y2 + data.y) / 2);
    ellipse.rx.baseVal.value = Math.abs(data.x2 - data.x) / 2;
    ellipse.ry.baseVal.value = Math.abs(data.y2 - data.y) / 2;
  },
};
export const secondary = config.secondary;
export const boot = createShapeToolBoot(config);
