import { EllipseContract } from "../contracts.js";
import {
  constrainEqualSpanToBoard,
  createShapeToolBoot,
  makeBoxShapeUpdateMessage,
  makeSeedShapeCreateMessage,
  moveShapeTool,
} from "../shape_tool.js";

export {
  cancelShapeToolTouchGesture as cancelTouchGesture,
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";

export const toolId = "ellipse";
export const drawsOnBoard = true;
export const mouseCursor = "crosshair";

const contract = EllipseContract;

/** @typedef {import("../shape_tool.js").ShapeCreateMessage<typeof contract.toolCode>} EllipseCreateMessage */
/** @typedef {import("../shape_tool.js").ShapeBoxUpdateMessage<typeof contract.toolCode>} EllipseUpdateMessage */
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
    return makeSeedShapeCreateMessage(state, id, x, y);
  },
  makeUpdateMessage: (state, x, y, evt) => {
    const start = state.currentShape;
    if (!start) return null;
    const secondary = state.secondary;
    if (evt && secondary) {
      secondary.active = secondary.active || evt.shiftKey;
    }
    state.lastPos = { x, y };
    if (secondary?.active) {
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
  applyShapeGeometry: (shape, data) => {
    const ellipse = /** @type {SVGEllipseElement} */ (shape);
    const x = data.x ?? data.x2;
    const y = data.y ?? data.y2;
    ellipse.cx.baseVal.value = Math.round((data.x2 + x) / 2);
    ellipse.cy.baseVal.value = Math.round((data.y2 + y) / 2);
    ellipse.rx.baseVal.value = Math.abs(data.x2 - x) / 2;
    ellipse.ry.baseVal.value = Math.abs(data.y2 - y) / 2;
  },
};
export const secondary = config.secondary;
export const boot = createShapeToolBoot(config);
