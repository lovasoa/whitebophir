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

(() => {
  //Code isolation
  /** @typedef {{type: "rect", id: string, x: number, y: number, x2: number, y2: number, color?: string, size?: number, opacity?: number}} RectangleStartData */
  /** @typedef {{type: "update", id: string, x: number, y: number, x2: number, y2: number}} RectangleUpdateData */
  /** @typedef {RectangleStartData | RectangleUpdateData} RectangleMessage */
  /** @typedef {{id: string, x: number, y: number, x2: number, y2: number, color?: string, size?: number, opacity?: number}} RectangleShapeData */
  /** @typedef {SVGRectElement & {id: string}} ExistingRect */

  /**
   * @param {Element | null} element
   * @returns {element is ExistingRect}
   */
  function isRectElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "x" in element &&
      "y" in element &&
      "width" in element &&
      "height" in element
    );
  }
  //Indicates the id of the shape the user is currently drawing or an empty string while the user is not drawing
  var end = false,
    curId = "",
    /** @type {RectangleUpdateData} */
    curUpdate = {
      //The data of the message that will be sent for every new point
      type: "update",
      id: "",
      x: 0,
      y: 0,
      x2: 0,
      y2: 0,
    },
    lastTime = performance.now(); //The time at which the last point was drawn

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   */
  function start(x, y, evt) {
    //Prevent the press from being interpreted by the browser
    evt.preventDefault();

    curId = Tools.generateUID("r"); //"r" for rectangle

    Tools.drawAndSend({
      type: "rect",
      id: curId,
      color: Tools.getColor(),
      size: Tools.getSize(),
      opacity: Tools.getOpacity(),
      x: x,
      y: y,
      x2: x,
      y2: y,
    });

    curUpdate.id = curId;
    curUpdate.x = x;
    curUpdate.y = y;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent | undefined} evt
   */
  function move(x, y, evt) {
    /*Wait 70ms before adding any point to the currently drawing shape.
		This allows the animation to be smother*/
    if (curId !== "") {
      if (rectangleTool.secondary.active) {
        const dx = x - curUpdate.x;
        const dy = y - curUpdate.y;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        x = curUpdate.x + (dx > 0 ? d : -d);
        y = curUpdate.y + (dy > 0 ? d : -d);
      }
      curUpdate.x2 = x;
      curUpdate.y2 = y;
      if (performance.now() - lastTime > 70 || end) {
        Tools.drawAndSend(curUpdate);
        lastTime = performance.now();
      } else {
        draw(curUpdate);
      }
    }
    if (evt) evt.preventDefault();
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function stop(x, y) {
    //Add a last point to the shape
    end = true;
    move(x, y, undefined);
    end = false;
    curId = "";
  }

  /** @param {RectangleMessage} data */
  function draw(data) {
    Tools.drawingEvent = true;
    switch (data.type) {
      case "rect":
        createShape(data);
        break;
      case "update": {
        let shape = svg.getElementById(data.id);
        if (!shape) {
          console.error(
            "Straight shape: Hmmm... I received a point of a rect that has not been created (%s).",
            data.id,
          );
          shape = createShape({
            //create a new shape in order not to loose the points
            id: data.id,
            x: data.x2,
            y: data.y2,
            x2: data.x2,
            y2: data.y2,
          });
        }
        updateShape(/** @type {ExistingRect} */ (shape), data);
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

  var svg = Tools.svg;
  /**
   * @param {RectangleShapeData} data
   * @returns {ExistingRect}
   */
  function createShape(data) {
    //Creates a new shape on the canvas, or update a shape that already exists with new information
    var existingShape = svg.getElementById(data.id);
    var shape = isRectElement(existingShape)
      ? existingShape
      : /** @type {ExistingRect} */ (Tools.createSVGElement("rect"));
    shape.id = data.id;
    updateShape(shape, data);
    //If some data is not provided, choose default value. The shape may be updated later
    shape.setAttribute("stroke", data.color || "black");
    shape.setAttribute("stroke-width", String(data.size || 10));
    shape.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, data.opacity || 1))),
    );
    if (!Tools.drawingArea) {
      throw new Error("Rectangle: Missing drawing area.");
    }
    Tools.drawingArea.appendChild(shape);
    return shape;
  }

  /**
   * @param {ExistingRect} shape
   * @param {RectangleShapeData} data
   */
  function updateShape(shape, data) {
    shape.x.baseVal.value = Math.min(data.x2, data.x);
    shape.y.baseVal.value = Math.min(data.y2, data.y);
    shape.width.baseVal.value = Math.abs(data.x2 - data.x);
    shape.height.baseVal.value = Math.abs(data.y2 - data.y);
  }

  var rectangleTool = {
    name: "Rectangle",
    shortcut: "r",
    listeners: {
      press: start,
      move: move,
      release: stop,
    },
    secondary: {
      name: "Square",
      icon: "tools/rect/icon-square.svg",
      active: false,
    },
    draw: draw,
    mouseCursor: "crosshair",
    icon: "tools/rect/icon.svg",
    stylesheet: "tools/rect/rect.css",
  };
  Tools.add(rectangleTool);
})(); //End of code isolation
