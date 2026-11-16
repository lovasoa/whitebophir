import { TOOL_BY_ID } from "../manifest.js";
import {
  constrainEqualSpanToBoard,
  createShapeToolBoot,
  makeBoxShapeUpdateMessage,
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

const definition = TOOL_BY_ID["rectangle"];

/** @typedef {import("../shape_tool.js").ShapeCreateMessage<typeof definition.id>} RectangleCreateMessage */
/** @typedef {import("../shape_tool.js").ShapeBoxUpdateMessage<typeof definition.id>} RectangleUpdateMessage */
const secondary = {
  name: "Square",
  icon: "tools/rectangle/icon-square.svg",
  active: false,
};

/** @type {import("../shape_tool.js").ShapeToolConfig} */
const config = {
  definition,
  secondary,
  uidPrefix: "r",
  constrainEndPosition: (state, x, y) => {
    const start = state.currentShape;
    if (!start) return;
    if (state.secondary?.active) {
      constrainEqualSpanToBoard(state, start, x, y);
      x = state.endX;
      y = state.endY;
    }
    state.endX = x;
    state.endY = y;
  },
  makeUpdateMessage: makeBoxShapeUpdateMessage,
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
