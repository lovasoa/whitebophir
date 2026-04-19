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
/** @typedef {import("../../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {{type: "straight", id: string, x: number, y: number, x2?: number, y2?: number, color?: string, size?: number, opacity?: number}} LineStartData */
/** @typedef {{type: "update", id: string, x2: number, y2: number}} LineUpdateData */
/** @typedef {LineStartData | LineUpdateData} LineMessage */
/** @typedef {{id: string, x: number, y: number, x2?: number, y2?: number, color?: string, size?: number, opacity?: number}} LineShapeData */
/** @typedef {SVGLineElement & {id: string}} ExistingLine */

export default class StraightLineTool {
  static toolName = "Straight line";

  /**
   * @param {AppToolsState} tools
   */
  constructor(tools) {
    this.tools = tools;
    /** @type {LineStartData | null} */
    this.curLine = null;
    this.lastTime = performance.now();
    this.name = "Straight line";
    this.shortcut = "l";
    this.secondary = {
      name: "Straight line",
      icon: "tools/straight-line/icon-straight.svg",
      active: false,
    };
    this.mouseCursor = "crosshair";
    this.icon = "tools/straight-line/icon.svg";
    this.stylesheet = "tools/straight-line/straight-line.css";
  }

  /**
   * @param {Element | null} element
   * @returns {element is ExistingLine}
   */
  isLineElement(element) {
    return String(element?.tagName).toLowerCase() === "line";
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {LineUpdateData}
   */
  createUpdateMessage(x, y) {
    return {
      type: "update",
      id: this.curLine ? this.curLine.id : "",
      x2: x,
      y2: y,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   */
  press(x, y, evt) {
    evt.preventDefault();
    this.curLine = {
      type: "straight",
      id: this.tools.generateUID("s"),
      color: this.tools.getColor(),
      size: this.tools.getSize(),
      opacity: this.tools.getOpacity(),
      x: x,
      y: y,
    };

    this.tools.drawAndSend(this.curLine, this);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent | undefined} evt
   */
  move(x, y, evt) {
    if (this.curLine !== null) {
      if (this.secondary.active) {
        let alpha = Math.atan2(y - this.curLine.y, x - this.curLine.x);
        const d = Math.hypot(y - this.curLine.y, x - this.curLine.x);
        const increment = (2 * Math.PI) / 16;
        alpha = Math.round(alpha / increment) * increment;
        x = this.tools.toBoardCoordinate(this.curLine.x + d * Math.cos(alpha));
        y = this.tools.toBoardCoordinate(this.curLine.y + d * Math.sin(alpha));
      }
      const update = this.createUpdateMessage(x, y);
      if (performance.now() - this.lastTime > 70) {
        this.tools.drawAndSend(update, this);
        this.lastTime = performance.now();
      } else {
        this.draw(update);
      }
    }
    if (evt) evt.preventDefault();
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  release(x, y) {
    this.move(x, y, undefined);
    this.curLine = null;
  }

  /**
   * @param {import("../../../types/app-runtime").BoardMessage} data
   * @param {boolean} [isLocal]
   */
  draw(data, isLocal) {
    void isLocal;
    const lineMessage = /** @type {LineMessage} */ (data);
    switch (lineMessage.type) {
      case "straight":
        this.createLine(lineMessage);
        break;
      case "update": {
        if (!this.tools.svg) {
          throw new Error("Straight line: Missing SVG canvas.");
        }
        let line = this.tools.svg.getElementById(lineMessage.id);
        if (!line) {
          console.error(
            "Straight line: Hmmm... I received a point of a line that has not been created (%s).",
            lineMessage.id,
          );
          line = this.createLine({
            id: lineMessage.id,
            x: lineMessage.x2,
            y: lineMessage.y2,
            x2: lineMessage.x2,
            y2: lineMessage.y2,
          });
        }
        this.updateLine(/** @type {ExistingLine} */ (line), lineMessage);
        break;
      }
      default:
        console.error(
          "Straight Line: Draw instruction with unknown type. ",
          lineMessage,
        );
        break;
    }
  }

  /**
   * @param {LineShapeData} lineData
   * @returns {ExistingLine}
   */
  createLine(lineData) {
    if (!this.tools.svg) {
      throw new Error("Straight line: Missing SVG canvas.");
    }
    if (!this.tools.drawingArea) {
      throw new Error("Straight line: Missing drawing area.");
    }

    const existingLine = this.tools.svg.getElementById(lineData.id);
    const line = this.isLineElement(existingLine)
      ? existingLine
      : /** @type {ExistingLine} */ (this.tools.createSVGElement("line"));
    line.id = lineData.id;
    line.x1.baseVal.value = lineData.x;
    line.y1.baseVal.value = lineData.y;
    line.x2.baseVal.value = lineData.x2 || lineData.x;
    line.y2.baseVal.value = lineData.y2 || lineData.y;
    line.setAttribute("stroke", lineData.color || "black");
    line.setAttribute("stroke-width", String(lineData.size || 10));
    line.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, lineData.opacity || 1))),
    );
    this.tools.drawingArea.appendChild(line);
    return line;
  }

  /**
   * @param {ExistingLine} line
   * @param {LineUpdateData} data
   */
  updateLine(line, data) {
    line.x2.baseVal.value = data.x2;
    line.y2.baseVal.value = data.y2;
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<StraightLineTool>}
   */
  static async boot(ctx) {
    return new StraightLineTool(ctx.runtime.Tools);
  }
}
