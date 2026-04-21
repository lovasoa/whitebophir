import {
  bootShapeTool,
  drawShapeTool,
  moveShapeTool,
  pressShapeTool,
  releaseShapeTool,
} from "../shape_tool.js";
import { MutationType } from "../../js/mutation_type.js";
import {
  defineShapeContract,
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "../shape_contract.js";

export const toolId = "straight-line";
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = defineShapeContract({
  toolId,
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
  makeCreateMessage: (state, id, x, y) => ({
    type: contract.liveCreateType,
    id,
    color: state.Tools.getColor(),
    size: state.Tools.getSize(),
    opacity: state.Tools.getOpacity(),
    x,
    y,
  }),
  makeUpdateMessage: (state, x, y) => {
    const start = state.currentShape;
    if (!start) return null;
    if (state.secondary?.active) {
      let alpha = Math.atan2(y - start.y, x - start.x);
      const d = Math.hypot(y - start.y, x - start.x);
      const increment = (2 * Math.PI) / 16;
      alpha = Math.round(alpha / increment) * increment;
      x = state.Tools.toBoardCoordinate(start.x + d * Math.cos(alpha));
      y = state.Tools.toBoardCoordinate(start.y + d * Math.sin(alpha));
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
};

/** @param {import("../../../types/app-runtime").ToolBootContext} ctx */
export function boot(ctx) {
  return bootShapeTool(config, ctx);
}

/**
 * @param {any} state
 * @param {any} data
 */
export function draw(state, data) {
  return drawShapeTool(state, data);
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 */
export function press(state, x, y, evt) {
  return pressShapeTool(state, x, y, evt);
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 */
export function move(state, x, y, evt) {
  return moveShapeTool(state, x, y, evt);
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 */
export function release(state, x, y) {
  return releaseShapeTool(state, x, y);
}
