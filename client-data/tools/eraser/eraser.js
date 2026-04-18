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
/** @typedef {import("../../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

export default class EraserTool {
  static toolName = "Eraser";

  /**
   * @param {AppToolsState} tools
   */
  constructor(tools) {
    this.tools = tools;
    this.erasing = false;
    this.name = "Eraser";
    this.shortcut = "e";
    this.icon = "tools/eraser/icon.svg";
    this.mouseCursor = "crosshair";
    this.showMarker = true;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {EraserPointerEvent} evt
   */
  press(x, y, evt) {
    evt.preventDefault();
    this.erasing = true;
    this.move(x, y, evt);
  }

  /**
   * @param {EventTarget | null} elem
   * @returns {elem is Element}
   */
  isElement(elem) {
    return !!(elem && typeof elem === "object" && "parentNode" in elem);
  }

  /**
   * @param {EventTarget | null} elem
   * @returns {elem is Element & {id: string}}
   */
  isErasableElement(elem) {
    return !!(
      this.isElement(elem) &&
      typeof elem.id === "string" &&
      elem.id !== ""
    );
  }

  /**
   * @param {EventTarget | null} elem
   * @returns {boolean}
   */
  inDrawingArea(elem) {
    return !!(
      this.tools.drawingArea &&
      this.isElement(elem) &&
      this.tools.drawingArea.contains(elem)
    );
  }

  /**
   * @param {EraserPointerEvent} evt
   * @returns {EventTarget | null}
   */
  resolveTarget(evt) {
    let target = evt.target;
    if (evt.type === "touchmove" || evt.type === "touchstart") {
      const touch = evt.touches && evt.touches[0];
      if (touch) {
        target = document.elementFromPoint(touch.clientX, touch.clientY);
      }
    }
    return target;
  }

  /**
   * @param {number} _x
   * @param {number} _y
   * @param {EraserPointerEvent} evt
   */
  move(_x, _y, evt) {
    const target = this.resolveTarget(evt);
    if (
      this.erasing &&
      target !== null &&
      target !== this.tools.svg &&
      target !== this.tools.drawingArea &&
      this.isErasableElement(target) &&
      this.inDrawingArea(target)
    ) {
      this.tools.drawAndSend({
        type: "delete",
        id: target.id,
      });
    }
  }

  release() {
    this.erasing = false;
  }

  /** @param {EraserMessage | {type?: string, id?: string}} data */
  draw(data) {
    switch (data.type) {
      case "delete": {
        if (!data.id) {
          console.error("Eraser: Missing id for delete message.", data);
          break;
        }
        if (!this.tools.svg) {
          throw new Error("Eraser: Missing SVG canvas.");
        }
        const elem = this.tools.svg.getElementById(data.id);
        if (elem === null) {
          console.error(
            "Eraser: Tried to delete an element that does not exist.",
          );
        } else if (!this.tools.drawingArea) {
          throw new Error("Eraser: Missing drawing area.");
        } else {
          this.tools.drawingArea.removeChild(elem);
        }
        break;
      }
      default:
        console.error("Eraser: 'delete' instruction with unknown type. ", data);
        break;
    }
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<EraserTool>}
   */
  static async boot(ctx) {
    return new EraserTool(ctx.runtime.Tools);
  }
}
