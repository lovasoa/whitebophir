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

/** @typedef {{getEffectiveRateLimit: (name: "general") => {periodMs?: number, limit?: number} | null, server_config: {RATE_LIMITS?: {[kind: string]: {periodMs?: number, limit?: number}}}, register: (tool: unknown) => void, addToolListeners: (tool: unknown) => void, getColor: () => string, getSize: () => number, drawAndSend: (msg: {type: string}, tool: unknown) => void, showMarker: boolean | undefined, showMyCursor: boolean | undefined, isIE: boolean, svg: SVGSVGElement | null, curTool: {showMarker?: boolean} | null}} CursorToolRegistry */
/** @typedef {{type: "update", x: number, y: number, color: string, size: number, socket?: string}} CursorMessage */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

export default class CursorToolClass {
  static toolName = "Cursor";

  /**
   * @param {CursorToolRegistry} tools
   */
  constructor(tools) {
    this.tools = tools;
    this.lastCursorUpdate = 0;
    this.sending = true;
    this.name = "Cursor";
    this.mouseCursor = "crosshair";
    this.icon = "tools/pencil/icon.svg";
    this.showMarker = true;
    this.alwaysOn = true;
    this.message = {
      type: "update",
      x: 0,
      y: 0,
      color: tools.getColor(),
      size: tools.getSize(),
    };
  }

  /**
   * @param {unknown} value
   * @param {number} fallback
   * @returns {number}
   */
  getPositiveNumber(value, fallback) {
    const number = Number(value);
    return number > 0 ? number : fallback;
  }

  /**
   * @returns {number}
   */
  getMinCursorUpdateIntervalMs() {
    const generalLimit =
      (typeof this.tools.getEffectiveRateLimit === "function"
        ? this.tools.getEffectiveRateLimit("general")
        : this.tools.server_config?.RATE_LIMITS?.general) ?? {};
    return (
      (this.getPositiveNumber(generalLimit.periodMs, 4096) /
        this.getPositiveNumber(generalLimit.limit, 192)) *
      2
    );
  }

  /**
   * @param {Element | null} element
   * @returns {element is SVGCircleElement}
   */
  isCursorElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "style" in element &&
      "setAttributeNS" in element
    );
  }

  press() {
    this.sending = false;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  move(x, y) {
    this.message.x = x;
    this.message.y = y;
    this.message.color = this.tools.getColor();
    this.message.size = this.tools.getSize();
    this.updateMarker();
  }

  release() {
    this.sending = true;
  }

  /** @param {number} size */
  onSizeChange(size) {
    this.message.size = size;
    this.updateMarker();
  }

  updateMarker() {
    const activeTool = /** @type {{showMarker?: boolean} | null} */ (
      this.tools.curTool
    );
    if (!this.tools.showMarker || !this.tools.showMyCursor) return;
    const curTime = Date.now();
    if (
      curTime - this.lastCursorUpdate > this.getMinCursorUpdateIntervalMs() &&
      (this.sending || activeTool?.showMarker === true)
    ) {
      const sent = this.tools.drawAndSend(this.message, this);
      if (sent === false) {
        this.draw(this.message);
      } else {
        this.lastCursorUpdate = curTime;
      }
    } else {
      this.draw(this.message);
    }
  }

  getCursorsLayer() {
    if (!this.tools.svg) {
      throw new Error("Cursor: Missing SVG canvas.");
    }
    const existingLayer = this.tools.svg.getElementById("cursors");
    if (existingLayer instanceof SVGGElement) return existingLayer;
    const createdLayer = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    createdLayer.setAttributeNS(null, "id", "cursors");
    this.tools.svg.appendChild(createdLayer);
    return createdLayer;
  }

  /** @param {string} id */
  createCursor(id) {
    const cursorsElem = this.getCursorsLayer();
    const cursor = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    cursor.setAttributeNS(null, "class", "opcursor");
    cursor.setAttributeNS(null, "id", id);
    cursor.setAttributeNS(null, "cx", "0");
    cursor.setAttributeNS(null, "cy", "0");
    cursor.setAttributeNS(null, "r", "10");
    cursorsElem.appendChild(cursor);
    setTimeout(() => {
      cursorsElem.removeChild(cursor);
    }, CursorToolClass.CURSOR_DELETE_AFTER_MS);
    return cursor;
  }

  /** @param {string} id */
  getCursor(id) {
    const existingCursor = document.getElementById(id);
    return this.isCursorElement(existingCursor)
      ? existingCursor
      : this.createCursor(id);
  }

  /** @param {CursorMessage} message */
  draw(message) {
    const cursor = this.getCursor(`cursor-${message.socket || "me"}`);
    cursor.style.transform = `translate(${message.x}px, ${message.y}px)`;
    if (this.tools.isIE)
      cursor.setAttributeNS(
        null,
        "transform",
        `translate(${message.x} ${message.y})`,
      );
    cursor.setAttributeNS(null, "fill", message.color);
    cursor.setAttributeNS(null, "r", String(message.size / 2));
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<CursorToolClass>}
   */
  static async boot(ctx) {
    return new CursorToolClass(ctx.runtime.Tools);
  }
}

CursorToolClass.CURSOR_DELETE_AFTER_MS = 1000 * 5;

/** @param {CursorToolRegistry} tools */
export function registerCursorTool(tools) {
  const tool = new CursorToolClass(tools);
  tools.register(tool);
  tools.addToolListeners(tool);
  return tool;
}
