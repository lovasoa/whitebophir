import { TOOL_BY_ID } from "../manifest.js";
import {
  createShapeToolBoot,
  makeLineShapeUpdateMessage,
  makeSeedShapeCreateMessage,
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

const definition = TOOL_BY_ID["straight-line"];

/** @typedef {import("../shape_tool.js").ShapeCreateMessage<typeof definition.id>} StraightLineCreateMessage */
/** @typedef {import("../shape_tool.js").ShapeLineUpdateMessage<typeof definition.id>} StraightLineUpdateMessage */
const secondary = {
  name: "Straight line",
  icon: "tools/straight-line/icon-straight.svg",
  active: false,
};

/** @type {import("../shape_tool.js").ShapeToolConfig} */
const config = {
  definition,
  secondary,
  uidPrefix: "s",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === definition.storedTagName,
  makeCreateMessage: makeSeedShapeCreateMessage,
  constrainEndPosition: (state, x, y) => {
    const start = state.currentShape;
    if (!start) return;
    if (state.secondary?.active) {
      let alpha = Math.atan2(y - start.y, x - start.x);
      const d = Math.hypot(y - start.y, x - start.x);
      const increment = (2 * Math.PI) / 16;
      alpha = Math.round(alpha / increment) * increment;
      x = state.coordinates.toBoardCoordinate(start.x + d * Math.cos(alpha));
      y = state.coordinates.toBoardCoordinate(start.y + d * Math.sin(alpha));
    }
    state.endX = x;
    state.endY = y;
  },
  makeUpdateMessage: (state, x, y) => {
    const start = state.currentShape;
    return start
      ? makeLineShapeUpdateMessage(definition.id, start.id, x, y)
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
