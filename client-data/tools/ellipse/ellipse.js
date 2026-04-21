import { createShapeToolClass } from "../shape_tool.js";
import { MutationType } from "../../js/message_tool_metadata.js";

export default createShapeToolClass({
  toolName: "Ellipse",
  shortcut: "c",
  icon: "tools/ellipse/icon-ellipse.svg",
  stylesheet: "tools/ellipse/ellipse.css",
  secondary: {
    name: "Circle",
    icon: "tools/ellipse/icon-circle.svg",
    active: false,
    /** @this {any} */
    switch() {
      if (!this.currentShape) return;
      this.move(this.lastPos.x, this.lastPos.y, undefined, false);
    },
  },
  uidPrefix: "e",
  createType: "ellipse",
  createElementName: "ellipse",
  isShapeElement: (element) =>
    String(element?.tagName).toLowerCase() === "ellipse",
  makeCreateMessage: (tool, id, x, y) => {
    tool.lastPos = { x, y };
    return {
      type: "ellipse",
      id,
      color: tool.Tools.getColor(),
      size: tool.Tools.getSize(),
      opacity: tool.Tools.getOpacity(),
      x,
      y,
      x2: x,
      y2: y,
    };
  },
  makeUpdateMessage: (tool, x, y, evt) => {
    const start = tool.currentShape;
    if (!start) return null;
    if (evt) {
      tool.secondary.active = tool.secondary.active || evt.shiftKey;
    }
    tool.lastPos = { x, y };
    if (tool.secondary?.active) {
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
});
