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

/** @typedef {{type: "delete", id: string}} EraserMessage */
/** @typedef {{preventDefault(): void, target: EventTarget | null, type?: string, touches?: TouchList}} EraserPointerEvent */
/** @typedef {{svg: SVGSVGElement | null, drawingArea: Element | null, drawAndSend: (message: EraserMessage) => void, add: (tool: unknown) => void}} EraserToolRegistry */

/** @param {EraserToolRegistry} tools */
export function registerEraserTool(tools) {
  var erasing = false;

  /**
   * @param {number} x
   * @param {number} y
   * @param {EraserPointerEvent} evt
   */
  function startErasing(x, y, evt) {
    //Prevent the press from being interpreted by the browser
    evt.preventDefault();
    erasing = true;
    erase(x, y, evt);
  }

  /**
   * @param {EventTarget | null} elem
   * @returns {elem is Element}
   */
  function isElement(elem) {
    return !!(elem && typeof elem === "object" && "parentNode" in elem);
  }

  /**
   * @param {EventTarget | null} elem
   * @returns {elem is Element & {id: string}}
   */
  function isErasableElement(elem) {
    return !!(isElement(elem) && typeof elem.id === "string" && elem.id !== "");
  }

  /**
   * @param {EventTarget | null} elem
   * @returns {boolean}
   */
  function inDrawingArea(elem) {
    return !!(
      tools.drawingArea &&
      isElement(elem) &&
      tools.drawingArea.contains(elem)
    );
  }

  /**
   * @param {EraserPointerEvent} evt
   * @returns {EventTarget | null}
   */
  function resolveTarget(evt) {
    var target = evt.target;
    if (evt.type === "touchmove" || evt.type === "touchstart") {
      // The target of touchmove events is the initially touched element, not the one currently touched.
      var touch = evt.touches && evt.touches[0];
      if (touch) {
        target = document.elementFromPoint(touch.clientX, touch.clientY);
      }
    }
    return target;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {EraserPointerEvent} evt
   */
  function erase(x, y, evt) {
    var target = resolveTarget(evt);
    if (
      erasing &&
      target !== null &&
      target !== tools.svg &&
      target !== tools.drawingArea &&
      isErasableElement(target) &&
      inDrawingArea(target)
    ) {
      /** @type {EraserMessage} */
      var msg = {
        type: "delete",
        id: target.id,
      };
      tools.drawAndSend(msg);
    }
  }

  function stopErasing() {
    erasing = false;
  }

  /** @param {EraserMessage | {type?: string, id?: string}} data */
  function draw(data) {
    var elem;
    switch (data.type) {
      //TODO: add the ability to erase only some points in a line
      case "delete":
        if (!data.id) {
          console.error("Eraser: Missing id for delete message.", data);
          break;
        }
        if (!tools.svg) {
          throw new Error("Eraser: Missing SVG canvas.");
        }
        elem = tools.svg.getElementById(data.id);
        if (elem === null) {
          console.error(
            "Eraser: Tried to delete an element that does not exist.",
          );
        } else if (!tools.drawingArea) {
          throw new Error("Eraser: Missing drawing area.");
        } else {
          tools.drawingArea.removeChild(elem);
        }
        break;
      default:
        console.error("Eraser: 'delete' instruction with unknown type. ", data);
        break;
    }
  }

  tools.add({
    //The new tool
    name: "Eraser",
    shortcut: "e",
    listeners: {
      press: startErasing,
      move: erase,
      release: stopErasing,
    },
    draw: draw,
    icon: "tools/eraser/icon.svg",
    mouseCursor: "crosshair",
    showMarker: true,
  });
}
