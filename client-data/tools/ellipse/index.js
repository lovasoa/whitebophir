import { TOOL_BY_ID } from "../manifest.js";
import {
  constrainEqualSpanToBoard,
  createShapeToolBoot,
  makeBoxShapeUpdateMessage,
  makeSeedShapeCreateMessage,
  moveShapeTool,
} from "../shape_tool.js";

export {
  cancelShapeToolTouchGesture as cancelTouchGesture,
  quitShapeTool as onquit,
  disconnectShapeTool as onSocketDisconnect,
  rejectShapeMutation as onMutationRejected,
  shapeToolMessage as onMessage,
  drawShapeTool as draw,
  moveShapeTool as move,
  pressShapeTool as press,
  releaseShapeTool as release,
} from "../shape_tool.js";

const definition = TOOL_BY_ID["ellipse"];

/** @typedef {import("../shape_tool.js").ShapeCreateMessage<typeof definition.id>} EllipseCreateMessage */
/** @typedef {import("../shape_tool.js").ShapeBoxUpdateMessage<typeof definition.id>} EllipseUpdateMessage */

/** @type {import("../shape_tool.js").ShapeToolConfig} */
const config = {
  definition,
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
    String(element?.tagName).toLowerCase() === definition.storedTagName,
  makeCreateMessage: (state, id, x, y) => {
    state.lastPos = { x, y };
    return makeSeedShapeCreateMessage(state, id, x, y);
  },
  constrainEndPosition: (state, x, y, evt) => {
    const start = state.currentShape;
    if (!start) return;
    const secondary = state.secondary;
    if (evt && secondary) {
      secondary.active = secondary.active || evt.shiftKey;
    }
    if (evt) {
      state.lastPos.x = x;
      state.lastPos.y = y;
    }
    if (secondary?.active) {
      constrainEqualSpanToBoard(state, start, x, y);
      x = state.endX;
      y = state.endY;
    }
    state.endX = x;
    state.endY = y;
  },
  makeUpdateMessage: (state, x, y) => {
    const start = state.currentShape;
    return start
      ? makeBoxShapeUpdateMessage(definition.id, start.id, start, x, y)
      : null;
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
export const boot = createShapeToolBoot(config);
