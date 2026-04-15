/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

export default class RectangleTool {
  static toolName = "Rectangle";

  /**
   * @param {any} Tools
   */
  constructor(Tools) {
    this.Tools = Tools;
    this.end = false;
    this.curId = "";
    this.curUpdate = {
      type: "update",
      id: "",
      x: 0,
      y: 0,
      x2: 0,
      y2: 0,
    };
    this.lastTime = performance.now();
    this.name = "Rectangle";
    this.shortcut = "r";
    this.secondary = {
      name: "Square",
      icon: "tools/rectangle/icon-square.svg",
      active: false,
    };
    this.mouseCursor = "crosshair";
    this.icon = "tools/rectangle/icon.svg";
    this.stylesheet = "tools/rectangle/rectangle.css";
  }

  /**
   * @param {Element | null} element
   * @returns {element is SVGRectElement & {id: string}}
   */
  isRectElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "x" in element &&
      "y" in element &&
      "width" in element &&
      "height" in element
    );
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   */
  press(x, y, evt) {
    evt.preventDefault();

    this.curId = this.Tools.generateUID("r");

    this.Tools.drawAndSend({
      type: "rect",
      id: this.curId,
      color: this.Tools.getColor(),
      size: this.Tools.getSize(),
      opacity: this.Tools.getOpacity(),
      x: x,
      y: y,
      x2: x,
      y2: y,
    });

    this.curUpdate.id = this.curId;
    this.curUpdate.x = x;
    this.curUpdate.y = y;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent | undefined} evt
   */
  move(x, y, evt) {
    if (this.curId !== "") {
      if (this.secondary.active) {
        const dx = x - this.curUpdate.x;
        const dy = y - this.curUpdate.y;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        x = this.curUpdate.x + (dx > 0 ? d : -d);
        y = this.curUpdate.y + (dy > 0 ? d : -d);
      }
      this.curUpdate.x2 = x;
      this.curUpdate.y2 = y;
      if (performance.now() - this.lastTime > 70 || this.end) {
        this.Tools.drawAndSend(this.curUpdate, this);
        this.lastTime = performance.now();
      } else {
        this.draw(this.curUpdate);
      }
    }
    if (evt) evt.preventDefault();
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  release(x, y) {
    this.end = true;
    this.move(x, y, undefined);
    this.end = false;
    this.curId = "";
  }

  /** @param {{type: "rect" | "update", id: string, x: number, y: number, x2: number, y2: number, color?: string, size?: number, opacity?: number}} data */
  draw(data) {
    this.Tools.drawingEvent = true;
    switch (data.type) {
      case "rect":
        this.createShape(data);
        break;
      case "update": {
        const svg = this.Tools.svg;
        let shape = svg.getElementById(data.id);
        if (!shape) {
          console.error(
            "Straight shape: Hmmm... I received a point of a rect that has not been created (%s).",
            data.id,
          );
          shape = this.createShape({
            id: data.id,
            x: data.x2,
            y: data.y2,
            x2: data.x2,
            y2: data.y2,
          });
        }
        this.updateShape(
          /** @type {SVGRectElement & {id: string}} */ (shape),
          data,
        );
        break;
      }
      default:
        console.error(
          "Straight shape: Draw instruction with unknown type. ",
          data,
        );
        break;
    }
  }

  /**
   * @param {{id: string, x: number, y: number, x2: number, y2: number, color?: string, size?: number, opacity?: number}} data
   * @returns {SVGRectElement & {id: string}}
   */
  createShape(data) {
    const existingShape = this.Tools.svg.getElementById(data.id);
    const shape = this.isRectElement(existingShape)
      ? existingShape
      : /** @type {SVGRectElement & {id: string}} */ (
          this.Tools.createSVGElement("rect")
        );
    shape.id = data.id;
    this.updateShape(shape, data);
    shape.setAttribute("stroke", data.color || "black");
    shape.setAttribute("stroke-width", String(data.size || 10));
    shape.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, data.opacity || 1))),
    );
    if (!this.Tools.drawingArea) {
      throw new Error("Rectangle: Missing drawing area.");
    }
    this.Tools.drawingArea.appendChild(shape);
    return shape;
  }

  /**
   * @param {SVGRectElement & {id: string}} shape
   * @param {{x: number, y: number, x2: number, y2: number}} data
   */
  updateShape(shape, data) {
    shape.x.baseVal.value = Math.min(data.x2, data.x);
    shape.y.baseVal.value = Math.min(data.y2, data.y);
    shape.width.baseVal.value = Math.abs(data.x2 - data.x);
    shape.height.baseVal.value = Math.abs(data.y2 - data.y);
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<RectangleTool>}
   */
  static async boot(ctx) {
    return new RectangleTool(ctx.runtime.Tools);
  }
}
