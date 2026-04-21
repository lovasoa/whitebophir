import { createShapeToolClass } from "../shape_tool.js";
import { MutationType } from "../../js/message_tool_metadata.js";

export default createShapeToolClass({
  toolName: "Straight line",
  shortcut: "l",
  icon: "tools/straight-line/icon.svg",
  stylesheet: "tools/straight-line/straight-line.css",
  secondary: {
    name: "Straight line",
    icon: "tools/straight-line/icon-straight.svg",
    active: false,
  },
  uidPrefix: "s",
  createType: "straight",
  createElementName: "line",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === "line",
  makeCreateMessage: (tool, id, x, y) => ({
    type: "straight",
    id,
    color: tool.Tools.getColor(),
    size: tool.Tools.getSize(),
    opacity: tool.Tools.getOpacity(),
    x,
    y,
  }),
  makeUpdateMessage: (tool, x, y) => {
    const start = tool.currentShape;
    if (!start) return null;
    if (tool.secondary?.active) {
      let alpha = Math.atan2(y - start.y, x - start.x);
      const d = Math.hypot(y - start.y, x - start.x);
      const increment = (2 * Math.PI) / 16;
      alpha = Math.round(alpha / increment) * increment;
      x = tool.Tools.toBoardCoordinate(start.x + d * Math.cos(alpha));
      y = tool.Tools.toBoardCoordinate(start.y + d * Math.sin(alpha));
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
});
