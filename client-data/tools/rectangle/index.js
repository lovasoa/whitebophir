import { RectangleContract } from "../contracts.js";
import {
  constrainEqualSpanToBoard,
  createShapeToolBoot,
  makeBoxShapeUpdateMessage,
  makeSeedShapeCreateMessage,
} from "../shape_tool.js";

export {
  cancelShapeToolTouchGesture as cancelTouchGesture,
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";

export const toolId = "rectangle";
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = RectangleContract;

/** @typedef {import("../shape_tool.js").ShapeCreateMessage<typeof contract.toolCode>} RectangleCreateMessage */
/** @typedef {import("../shape_tool.js").ShapeBoxUpdateMessage<typeof contract.toolCode>} RectangleUpdateMessage */
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
    const x = data.x ?? data.x2;
    const y = data.y ?? data.y2;
    rectangle.x.baseVal.value = Math.min(data.x2, x);
    rectangle.y.baseVal.value = Math.min(data.y2, y);
    rectangle.width.baseVal.value = Math.abs(data.x2 - x);
    rectangle.height.baseVal.value = Math.abs(data.y2 - y);
  },
};

export const boot = createShapeToolBoot(config);
