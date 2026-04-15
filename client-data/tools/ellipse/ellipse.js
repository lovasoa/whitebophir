/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2020  Ophir LOJKINE
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

export default class EllipseTool {
  static toolName = "Ellipse";

  /**
   * @param {any} Tools
   */
  constructor(Tools) {
    this.Tools = Tools;
    this.curUpdate = {
      type: "update",
      id: "",
      x: 0,
      y: 0,
      x2: 0,
      y2: 0,
    };
    this.lastPos = { x: 0, y: 0 };
    this.lastTime = performance.now();
    this.name = "Ellipse";
    this.icon = "tools/ellipse/icon-ellipse.svg";
    this.secondary = {
      name: "Circle",
      icon: "tools/ellipse/icon-circle.svg",
      active: false,
      switch: () => {
        this.doUpdate();
      },
    };
    this.shortcut = "c";
    this.mouseCursor = "crosshair";
    this.stylesheet = "tools/ellipse/ellipse.css";
  }

  /**
   * @param {Element | null} element
   * @returns {element is SVGEllipseElement & {id: string}}
   */
  isEllipseElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "cx" in element &&
      "cy" in element &&
      "rx" in element &&
      "ry" in element
    );
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   */
  press(x, y, evt) {
    evt.preventDefault();

    this.curUpdate.id = this.Tools.generateUID("e");

    this.Tools.drawAndSend({
      type: "ellipse",
      id: this.curUpdate.id,
      color: this.Tools.getColor(),
      size: this.Tools.getSize(),
      opacity: this.Tools.getOpacity(),
      x: x,
      y: y,
      x2: x,
      y2: y,
    });

    this.curUpdate.x = x;
    this.curUpdate.y = y;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {(MouseEvent & {shiftKey?: boolean}) | (TouchEvent & {shiftKey?: boolean}) | undefined} evt
   */
  move(x, y, evt) {
    if (!this.curUpdate.id) return;
    if (evt) {
      this.secondary.active = this.secondary.active || evt.shiftKey;
      evt.preventDefault();
    }
    this.lastPos.x = x;
    this.lastPos.y = y;
    this.doUpdate();
  }

  /** @param {boolean} [force] */
  doUpdate(force) {
    if (!this.curUpdate.id) return;
    if (this.secondary.active) {
      const x0 = this.curUpdate.x,
        y0 = this.curUpdate.y;
      const deltaX = this.lastPos.x - x0,
        deltaY = this.lastPos.y - y0;
      const diameter = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      this.curUpdate.x2 = x0 + (deltaX > 0 ? diameter : -diameter);
      this.curUpdate.y2 = y0 + (deltaY > 0 ? diameter : -diameter);
    } else {
      this.curUpdate.x2 = this.lastPos.x;
      this.curUpdate.y2 = this.lastPos.y;
    }

    if (performance.now() - this.lastTime > 70 || force) {
      this.Tools.drawAndSend(this.curUpdate, this);
      this.lastTime = performance.now();
    } else {
      this.draw(this.curUpdate);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  release(x, y) {
    this.lastPos.x = x;
    this.lastPos.y = y;
    this.doUpdate(true);
    this.curUpdate.id = "";
  }

  /** @param {{type: "ellipse" | "update", id: string, x: number, y: number, x2: number, y2: number, color?: string, size?: number, opacity?: number}} data */
  draw(data) {
    this.Tools.drawingEvent = true;
    switch (data.type) {
      case "ellipse":
        this.createShape(data);
        break;
      case "update": {
        const svg = this.Tools.svg;
        let shape = svg.getElementById(data.id);
        if (!shape) {
          console.error(
            "Ellipse: Hmmm... I received an update for a shape that has not been created (%s).",
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
          /** @type {SVGEllipseElement & {id: string}} */ (shape),
          data,
        );
        break;
      }
      default:
        console.error("Ellipse: Draw instruction with unknown type. ", data);
        break;
    }
  }

  /**
   * @param {{id: string, x: number, y: number, x2: number, y2: number, color?: string, size?: number, opacity?: number}} data
   * @returns {SVGEllipseElement & {id: string}}
   */
  createShape(data) {
    const existingShape = this.Tools.svg.getElementById(data.id);
    const shape = this.isEllipseElement(existingShape)
      ? existingShape
      : /** @type {SVGEllipseElement & {id: string}} */ (
          this.Tools.createSVGElement("ellipse")
        );
    this.updateShape(shape, data);
    shape.id = data.id;
    shape.setAttribute("stroke", data.color || "black");
    shape.setAttribute("stroke-width", String(data.size || 10));
    shape.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, data.opacity || 1))),
    );
    if (!this.Tools.drawingArea) {
      throw new Error("Ellipse: Missing drawing area.");
    }
    this.Tools.drawingArea.appendChild(shape);
    return shape;
  }

  /**
   * @param {SVGEllipseElement & {id: string}} shape
   * @param {{x: number, y: number, x2: number, y2: number}} data
   */
  updateShape(shape, data) {
    shape.cx.baseVal.value = Math.round((data.x2 + data.x) / 2);
    shape.cy.baseVal.value = Math.round((data.y2 + data.y) / 2);
    shape.rx.baseVal.value = Math.abs(data.x2 - data.x) / 2;
    shape.ry.baseVal.value = Math.abs(data.y2 - data.y) / 2;
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<EllipseTool>}
   */
  static async boot(ctx) {
    return new EllipseTool(ctx.runtime.Tools);
  }
}
