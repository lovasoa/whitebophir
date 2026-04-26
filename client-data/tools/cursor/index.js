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

import { MutationType } from "../../js/mutation_type.js";
import { ToolCodes } from "../tool-order.js";

/** @import { MountedAppToolsState, ToolBootContext } from "../../../types/app-runtime" */
/** @typedef {{tools: MountedAppToolsState, lastCursorUpdate: number, sending: boolean, x: number, y: number, color: string, size: number, minCursorUpdateIntervalMs: number}} CursorState */

export const toolId = "cursor";
export const mouseCursor = "crosshair";
export const showMarker = true;
export const alwaysOn = true;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function getPositiveNumber(value, fallback) {
  const number = Number(value);
  return number > 0 ? number : fallback;
}

/** @param {MountedAppToolsState} tools */
function computeMinCursorUpdateIntervalMs(tools) {
  const generalLimit =
    tools.getEffectiveRateLimit?.("general") ??
    tools.server_config?.RATE_LIMITS?.general ??
    {};
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
  return String(element?.tagName).toLowerCase() === "circle";
}

/** @param {MountedAppToolsState} tools */
function getCursorsLayer(tools) {
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

/**
 * @param {MountedAppToolsState} tools
 * @param {string} id
 */
function createCursor(tools, id) {
  const cursorsElem = getCursorsLayer(tools);
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
    if (cursor.parentNode === cursorsElem) {
      cursorsElem.removeChild(cursor);
    }
  }, 1000 * 5);
  return cursor;
}

/**
 * @param {MountedAppToolsState} tools
 * @param {string} id
 */
function getCursor(tools, id) {
  const existingCursor = document.getElementById(id);
  return isCursorElement(existingCursor)
    ? existingCursor
    : createCursor(tools, id);
}

/** @param {CursorState} state */
function makeCursorMessage(state) {
  return {
    tool: ToolCodes.CURSOR,
    type: MutationType.UPDATE,
    x: state.x,
    y: state.y,
    color: state.color,
    size: state.size,
  };
}
/** @typedef {ReturnType<typeof makeCursorMessage> & {socket?: string}} CursorMessage */

/** @param {CursorState} state */
function updateMarker(state) {
  const activeTool = /** @type {{showMarker?: boolean} | null} */ (
    state.tools.curTool
  );
  if (!state.tools.showMarker || !state.tools.showMyCursor) return;
  const curTime = Date.now();
  if (
    curTime - state.lastCursorUpdate > state.minCursorUpdateIntervalMs &&
    (state.sending || activeTool?.showMarker === true)
  ) {
    const message = makeCursorMessage(state);
    const sent = state.tools.drawAndSend(message);
    if (sent !== true) {
      draw(state, message);
    } else {
      state.lastCursorUpdate = curTime;
    }
    return;
  }
  draw(state, makeCursorMessage(state));
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  const tools = ctx.Tools;
  return {
    tools,
    lastCursorUpdate: 0,
    sending: true,
    x: 0,
    y: 0,
    color: tools.getColor(),
    size: tools.getSize(),
    minCursorUpdateIntervalMs: computeMinCursorUpdateIntervalMs(tools),
  };
}

/** @param {CursorState} state */
export function press(state) {
  state.sending = false;
}

/**
 * @param {CursorState} state
 * @param {number} x
 * @param {number} y
 */
export function move(state, x, y) {
  state.x = x;
  state.y = y;
  state.color = state.tools.getColor();
  state.size = state.tools.getSize();
  updateMarker(state);
}

/** @param {CursorState} state */
export function release(state) {
  state.sending = true;
}

/**
 * @param {CursorState} state
 * @param {number} size
 */
export function onSizeChange(state, size) {
  state.size = size;
  updateMarker(state);
}

/**
 * @param {CursorState} state
 * @param {CursorMessage} message
 */
export function draw(state, message) {
  const cursor = getCursor(state.tools, `cursor-${message.socket || "me"}`);
  cursor.style.transform = `translate(${message.x}px, ${message.y}px)`;
  cursor.setAttributeNS(null, "fill", message.color);
  cursor.setAttributeNS(null, "r", String(message.size / 2));
}
