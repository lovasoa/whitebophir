import { createShapeToolClass } from "../shape_tool.js";

export default createShapeToolClass({
  toolName: "Rectangle",
  shortcut: "r",
  icon: "tools/rectangle/icon.svg",
  stylesheet: "tools/rectangle/rectangle.css",
  secondary: {
    name: "Square",
    icon: "tools/rectangle/icon-square.svg",
    active: false,
  },
  uidPrefix: "r",
  createType: "rect",
  createElementName: "rect",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === "rect",
  makeCreateMessage: (tool, id, x, y) => ({
    type: "rect",
    id,
    color: tool.Tools.getColor(),
    size: tool.Tools.getSize(),
    opacity: tool.Tools.getOpacity(),
    x,
    y,
    x2: x,
    y2: y,
  }),
  makeUpdateMessage: (tool, x, y) => {
    const start = tool.currentShape;
    if (!start) return null;
    if (tool.secondary?.active) {
      const dx = x - start.x;
      const dy = y - start.y;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      x = start.x + (dx > 0 ? d : -d);
      y = start.y + (dy > 0 ? d : -d);
    }
    return {
      type: "update",
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
});
