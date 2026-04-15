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
/** @typedef {{type: "straight", id: string, x: number, y: number, x2?: number, y2?: number, color?: string, size?: number, opacity?: number}} LineStartData */
/** @typedef {{type: "update", id: string, x2: number, y2: number}} LineUpdateData */
/** @typedef {LineStartData | LineUpdateData} LineMessage */
/** @typedef {{id: string, x: number, y: number, x2?: number, y2?: number, color?: string, size?: number, opacity?: number}} LineShapeData */
/** @typedef {SVGLineElement & {id: string}} ExistingLine */
/** @typedef {{generateUID:(prefix:string)=>string, getColor:()=>string, getSize:()=>number, getOpacity:()=>number, createSVGElement:(name:string)=>Element, drawingArea: Element | null, svg: SVGSVGElement | null, add:(tool:unknown)=>void, drawAndSend:(message:LineMessage, tool:unknown)=>void}} LineToolRegistry */

/**
 * @param {LineToolRegistry} tools
 * @returns {any}
 */
function createLineTool(tools) {
  /**
   * @param {Element | null} element
   * @returns {element is ExistingLine}
   */
  function isLineElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "x1" in element &&
      "y1" in element &&
      "x2" in element &&
      "y2" in element
    );
  }

  //Indicates the id of the line the user is currently drawing or an empty string while the user is not drawing
  /** @type {LineStartData | null} */
  let curLine = null,
    lastTime = performance.now(); //The time at which the last point was drawn

  /**
   * @param {number} x
   * @param {number} y
   * @returns {LineUpdateData}
   */
  function createUpdateMessage(x, y) {
    return {
      type: "update",
      id: curLine ? curLine.id : "",
      x2: x,
      y2: y,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   */
  function startLine(x, y, evt) {
    //Prevent the press from being interpreted by the browser
    evt.preventDefault();

    curLine = {
      type: "straight",
      id: tools.generateUID("s"), //"s" for straight line
      color: tools.getColor(),
      size: tools.getSize(),
      opacity: tools.getOpacity(),
      x: x,
      y: y,
    };

    tools.drawAndSend(curLine, lineTool);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent | undefined} evt
   */
  function continueLine(x, y, evt) {
    /*Wait 70ms before adding any point to the currently drawing line.
		This allows the animation to be smother*/
    if (curLine !== null) {
      if (lineTool.secondary.active) {
        let alpha = Math.atan2(y - curLine.y, x - curLine.x);
        const d = Math.hypot(y - curLine.y, x - curLine.x);
        const increment = (2 * Math.PI) / 16;
        alpha = Math.round(alpha / increment) * increment;
        x = curLine.x + d * Math.cos(alpha);
        y = curLine.y + d * Math.sin(alpha);
      }
      if (performance.now() - lastTime > 70) {
        tools.drawAndSend(createUpdateMessage(x, y), lineTool);
        lastTime = performance.now();
      } else {
        draw(createUpdateMessage(x, y));
      }
    }
    if (evt) evt.preventDefault();
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function stopLine(x, y) {
    //Add a last point to the line
    continueLine(x, y, undefined);
    curLine = null;
  }

  /** @param {LineMessage} data */
  function draw(data) {
    switch (data.type) {
      case "straight":
        createLine(data);
        break;
      case "update": {
        if (!tools.svg) {
          throw new Error("Straight line: Missing SVG canvas.");
        }
        let line = tools.svg.getElementById(data.id);
        if (!line) {
          console.error(
            "Straight line: Hmmm... I received a point of a line that has not been created (%s).",
            data.id,
          );
          line = createLine({
            //create a new line in order not to loose the points
            id: data.id,
            x: data.x2,
            y: data.y2,
            x2: data.x2,
            y2: data.y2,
          });
        }
        updateLine(/** @type {ExistingLine} */ (line), data);
        break;
      }
      default:
        console.error(
          "Straight Line: Draw instruction with unknown type. ",
          data,
        );
        break;
    }
  }

  /**
   * @param {LineShapeData} lineData
   * @returns {ExistingLine}
   */
  function createLine(lineData) {
    if (!tools.svg) {
      throw new Error("Straight line: Missing SVG canvas.");
    }
    if (!tools.drawingArea) {
      throw new Error("Straight line: Missing drawing area.");
    }

    //Creates a new line on the canvas, or update a line that already exists with new information
    const existingLine = tools.svg.getElementById(lineData.id);
    const line = isLineElement(existingLine)
      ? existingLine
      : /** @type {ExistingLine} */ (tools.createSVGElement("line"));
    line.id = lineData.id;
    line.x1.baseVal.value = lineData.x;
    line.y1.baseVal.value = lineData.y;
    line.x2.baseVal.value = lineData.x2 || lineData.x;
    line.y2.baseVal.value = lineData.y2 || lineData.y;
    //If some data is not provided, choose default value. The line may be updated later
    line.setAttribute("stroke", lineData.color || "black");
    line.setAttribute("stroke-width", String(lineData.size || 10));
    line.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, lineData.opacity || 1))),
    );
    tools.drawingArea.appendChild(line);
    return line;
  }

  /**
   * @param {ExistingLine} line
   * @param {LineUpdateData} data
   */
  function updateLine(line, data) {
    line.x2.baseVal.value = data.x2;
    line.y2.baseVal.value = data.y2;
  }

  const lineTool = {
    name: "Straight line",
    shortcut: "l",
    listeners: {
      press: startLine,
      move: continueLine,
      release: stopLine,
    },
    secondary: {
      name: "Straight line",
      icon: "tools/line/icon-straight.svg",
      active: false,
    },
    draw: draw,
    mouseCursor: "crosshair",
    icon: "tools/line/icon.svg",
    stylesheet: "tools/line/line.css",
  };
  return lineTool;
}

/**
 * @param {LineToolRegistry} tools
 * @returns {any}
 */
export function registerLineTool(tools) {
  const tool = createLineTool(tools);
  tools.add(tool);
  return tool;
}

// biome-ignore lint/complexity/noStaticOnlyClass: tool modules intentionally expose static boot entrypoints.
export default class StraightLineTool {
  static toolName = "Straight line";

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<any>}
   */
  static async boot(ctx) {
    return createLineTool(ctx.runtime.Tools);
  }
}
