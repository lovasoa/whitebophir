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
/** @typedef {{name: string, listeners: {press: () => void, move: (x: number, y: number) => void, release: () => void}, onSizeChange: (size: number) => void, draw: (message: CursorMessage) => void, mouseCursor: string, icon: string, showMarker: boolean}} CursorTool */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

/** @param {CursorToolRegistry} tools */
function createCursorTool(tools) {
  /**
   * @param {unknown} value
   * @param {number} fallback
   * @returns {number}
   */
  function getPositiveNumber(value, fallback) {
    const number = Number(value);
    return number > 0 ? number : fallback;
  }

  /**
   * @returns {number}
   */
  function getMinCursorUpdateIntervalMs() {
    const generalLimit =
      (typeof tools.getEffectiveRateLimit === "function"
        ? tools.getEffectiveRateLimit("general")
        : tools.server_config?.RATE_LIMITS?.general) ?? {};
    return (
      (getPositiveNumber(generalLimit.periodMs, 4096) /
        getPositiveNumber(generalLimit.limit, 192)) *
      2
    );
  }

  /**
   * @param {Element | null} element
   * @returns {element is SVGCircleElement}
   */
  function isCursorElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "style" in element &&
      "setAttributeNS" in element
    );
  }

  // Allocate half of the maximum server updates to cursor updates
  const CURSOR_DELETE_AFTER_MS = 1000 * 5;

  let lastCursorUpdate = 0;
  let sending = true;

  /** @type {CursorTool} */
  const cursorTool = {
    name: "Cursor",
    listeners: {
      press: () => {
        sending = false;
      },
      move: handleMarker,
      release: () => {
        sending = true;
      },
    },
    onSizeChange: onSizeChange,
    draw: draw,
    mouseCursor: "crosshair",
    icon: "tools/pencil/icon.svg",
    showMarker: true,
    alwaysOn: true,
  };
  /** @type {CursorMessage} */
  const message = {
    type: "update",
    x: 0,
    y: 0,
    color: tools.getColor(),
    size: tools.getSize(),
  };

  /**
   * @param {number} x
   * @param {number} y
   */
  function handleMarker(x, y) {
    // throttle local cursor updates
    message.x = x;
    message.y = y;
    message.color = tools.getColor();
    message.size = tools.getSize();
    updateMarker();
  }

  /** @param {number} size */
  function onSizeChange(size) {
    message.size = size;
    updateMarker();
  }

  function updateMarker() {
    const activeTool = /** @type {{showMarker?: boolean} | null} */ (
      tools.curTool
    );
    if (!tools.showMarker || !tools.showMyCursor) return;
    const curTime = Date.now();
    if (
      curTime - lastCursorUpdate > getMinCursorUpdateIntervalMs() &&
      (sending || activeTool?.showMarker === true)
    ) {
      tools.drawAndSend(message, cursorTool);
      lastCursorUpdate = curTime;
    } else {
      draw(message);
    }
  }

  function getCursorsLayer() {
    if (!tools.svg) {
      throw new Error("Cursor: Missing SVG canvas.");
    }
    const existingLayer = tools.svg.getElementById("cursors");
    if (existingLayer instanceof SVGGElement) return existingLayer;
    const createdLayer = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    createdLayer.setAttributeNS(null, "id", "cursors");
    tools.svg.appendChild(createdLayer);
    return createdLayer;
  }

  /** @param {string} id */
  function createCursor(id) {
    const cursorsElem = getCursorsLayer();
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
    }, CURSOR_DELETE_AFTER_MS);
    return cursor;
  }

  /** @param {string} id */
  function getCursor(id) {
    const existingCursor = document.getElementById(id);
    return isCursorElement(existingCursor) ? existingCursor : createCursor(id);
  }

  /** @param {CursorMessage} message */
  function draw(message) {
    const cursor = getCursor(`cursor-${message.socket || "me"}`);
    cursor.style.transform = `translate(${message.x}px, ${message.y}px)`;
    if (tools.isIE)
      cursor.setAttributeNS(
        null,
        "transform",
        `translate(${message.x} ${message.y})`,
      );
    cursor.setAttributeNS(null, "fill", message.color);
    cursor.setAttributeNS(null, "r", String(message.size / 2));
  }

  return cursorTool;
}

/** @param {CursorToolRegistry} tools */
export function registerCursorTool(tools) {
  const tool = createCursorTool(tools);
  tools.register(tool);
  tools.addToolListeners(tool);
  return tool;
}

// biome-ignore lint/complexity/noStaticOnlyClass: tool modules intentionally expose static boot entrypoints.
export default class CursorToolClass {
  static toolName = "Cursor";

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<any>}
   */
  static async boot(ctx) {
    return createCursorTool(ctx.runtime.Tools);
  }
}
