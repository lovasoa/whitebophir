import { StraightLineContract } from "../contracts.js";
import {
  createShapeToolBoot,
  makeLineShapeUpdateMessage,
  makeSeedShapeCreateMessage,
} from "../shape_tool.js";

export {
  cancelShapeToolTouchGesture as cancelTouchGesture,
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";

export const toolId = "straight-line";
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = StraightLineContract;

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
