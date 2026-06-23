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
import { TOOL_CODE_BY_ID } from "../tool-order.js";

/** @import { ToolBootContext, ToolRuntimeModules } from "../../../types/app-runtime" */
/** @typedef {ReturnType<typeof boot>} CursorState */

const SVG_NS = "http://www.w3.org/2000/svg";
const CURSOR_TEMPLATE_SVG = `
<g class="opcursor">
  <circle class="opcursor-marker" cx="0" cy="0" r="10"></circle>
  <g class="opcursor-label" transform="translate(12 -12)">
    <rect class="opcursor-label-bg" x="0" y="-15" rx="3" ry="3" height="19"></rect>
    <text class="opcursor-label-text" x="6" y="0"></text>
  </g>
</g>`;

export const toolId = "cursor";
const toolCode = TOOL_CODE_BY_ID[toolId];
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

/** @param {ToolRuntimeModules["rateLimits"]} rateLimits */
function computeMinCursorUpdateIntervalMs(rateLimits) {
  const generalLimit = rateLimits.getEffectiveRateLimit("general");
  return (
    (getPositiveNumber(generalLimit.periodMs, 4096) /
      getPositiveNumber(generalLimit.limit, 192)) *
    2
  );
}

/**
 * @param {Element | null} element
 * @returns {element is SVGGElement}
 */
function isCursorElement(element) {
  return (
    element instanceof SVGGElement && element.classList.contains("opcursor")
  );
}

/** @param {ToolRuntimeModules["board"]} board */
function getCursorsLayer(board) {
  const existingLayer = board.svg.getElementById("cursors");
  if (existingLayer instanceof SVGGElement) return existingLayer;
  const createdLayer = document.createElementNS(SVG_NS, "g");
  createdLayer.setAttributeNS(null, "id", "cursors");
  board.svg.appendChild(createdLayer);
  return createdLayer;
}

/**
 * Keep the cursor marker as a literal SVG template so the visual structure is
 * readable and maintainable in one place. Tests use a minimal DOM shim without
 * SVG innerHTML parsing, so callers still tolerate a missing child template.
 * @param {string} id
 * @returns {SVGGElement}
 */
function createCursorElement(id) {
  const templateSvg = document.createElementNS(SVG_NS, "svg");
  templateSvg.innerHTML = CURSOR_TEMPLATE_SVG.trim();
  const cursor = templateSvg.firstElementChild;
  if (!(cursor instanceof SVGGElement)) {
    const fallbackCursor = document.createElementNS(SVG_NS, "g");
    fallbackCursor.setAttributeNS(null, "class", "opcursor");
    fallbackCursor.setAttributeNS(null, "id", id);
    return fallbackCursor;
  }
  cursor.setAttributeNS(null, "id", id);
  return cursor;
}

/**
 * @param {ToolRuntimeModules["board"]} board
 * @param {string} id
 */
function createCursor(board, id) {
  const cursorsElem = getCursorsLayer(board);
  const cursor = createCursorElement(id);
  cursorsElem.appendChild(cursor);
  setTimeout(() => {
    if (cursor.parentNode === cursorsElem) {
      cursorsElem.removeChild(cursor);
    }
  }, 1000 * 5);
  return cursor;
}

/**
 * @param {ToolRuntimeModules["board"]} board
 * @param {string} id
 */
function getCursor(board, id) {
  const existingCursor = document.getElementById(id);
  return isCursorElement(existingCursor)
    ? existingCursor
    : createCursor(board, id);
}

/** @param {CursorState} state */
function makeCursorMessage(state) {
  return {
    tool: toolCode,
    type: MutationType.UPDATE,
    x: state.x,
    y: state.y,
    color: state.color,
    size: state.size,
    opacity: state.opacity,
    activeTool: getActiveToolId(state),
  };
}
/** @typedef {ReturnType<typeof makeCursorMessage> & {socket?: string}} CursorMessage */

/** @param {CursorState} state */
function isOwnCursorSuppressed(state) {
  return (
    typeof state.interaction.isOwnCursorSuppressed === "function" &&
    state.interaction.isOwnCursorSuppressed()
  );
}

/** @param {CursorState} state */
function updateMarker(state) {
  const activeTool = /** @type {{showMarker?: boolean} | null} */ (
    state.toolRegistry.current
  );
  if (
    !state.interaction.showMarker ||
    !state.interaction.showMyCursor ||
    isOwnCursorSuppressed(state)
  ) {
    return;
  }
  const curTime = Date.now();
  if (
    curTime - state.lastCursorUpdate > state.minCursorUpdateIntervalMs &&
    (state.sending || activeTool?.showMarker === true)
  ) {
    const message = makeCursorMessage(state);
    const sent = state.writes.drawAndSend(message);
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
  const runtime = ctx.runtime;
  const runtimeAny = /** @type {any} */ (runtime);
  return {
    board: runtime.board,
    writes: runtime.writes,
    preferences: runtime.preferences,
    rateLimits: runtime.rateLimits,
    interaction: runtime.interaction,
    toolRegistry: runtime.toolRegistry,
    connection:
      /** @type {import("../../../types/app-runtime").AppConnectionModule} */ (
        /** @type {unknown} */ (runtimeAny.connection)
      ),
    presence:
      /** @type {import("../../../types/app-runtime").AppPresenceModule} */ (
        /** @type {unknown} */ (runtimeAny.presence)
      ),
    i18n: runtime.i18n,
    lastCursorUpdate: 0,
    sending: true,
    x: 0,
    y: 0,
    color: runtime.preferences.getColor(),
    size: runtime.preferences.getSize(),
    opacity: runtime.preferences.getOpacity(),
    minCursorUpdateIntervalMs: computeMinCursorUpdateIntervalMs(
      runtime.rateLimits,
    ),
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
  state.color = state.preferences.getColor();
  state.size = state.preferences.getSize();
  state.opacity = state.preferences.getOpacity();
  updateMarker(state);
}

/** @param {CursorState} state */
export function release(state) {
  state.sending = true;
}

/**
 * @param {CursorState} state
 * @param {string} color
 */
export function onColorChange(state, color) {
  state.color = color;
  updateMarker(state);
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
 * @param {number} opacity
 */
export function onOpacityChange(state, opacity) {
  state.opacity = opacity;
  updateMarker(state);
}

/** @param {CursorState} state */
function getActiveToolId(state) {
  return state.toolRegistry.current?.name || "hand";
}

/**
 * @param {CursorState} state
 * @param {string | undefined} socketId
 */
function getPresenceUser(state, socketId) {
  if (!state.presence?.users) return null;
  if (socketId) return state.presence.users.get(socketId) || null;
  const ownSocketId = state.connection?.socket?.id || null;
  return ownSocketId ? state.presence.users.get(ownSocketId) || null : null;
}

/**
 * @param {CursorState} state
 * @param {CursorMessage} message
 */
function getCursorLabel(state, message) {
  const user = getPresenceUser(state, message.socket);
  const translate = state.i18n?.t
    ? state.i18n.t.bind(state.i18n)
    : (/** @type {string} */ key) => key;
  const name = user?.name || (message.socket ? translate("users") : "You");
  const toolId = message.activeTool || user?.lastTool || getActiveToolId(state);
  const toolLabel = translate(toolId);
  return `${name} · ${toolLabel || toolId}`;
}

/**
 * @param {Element | {children?: unknown[]} | null} element
 * @param {string} className
 * @returns {Element | null}
 */
function getCursorPart(element, className) {
  if (!element) return null;
  if (
    "querySelector" in element &&
    typeof element.querySelector === "function"
  ) {
    return element.querySelector(`.${className}`);
  }
  const children = Array.isArray(element.children) ? element.children : [];
  return /** @type {Element | null} */ (
    children.find((child) =>
      String(/** @type {any} */ (child)?.getAttribute?.("class") || "")
        .split(/\s+/)
        .includes(className),
    ) || null
  );
}

/**
 * @param {SVGGElement} cursor
 * @param {string} label
 */
function setCursorLabel(cursor, label) {
  const text = getCursorPart(
    getCursorPart(cursor, "opcursor-label"),
    "opcursor-label-text",
  );
  const background = getCursorPart(
    getCursorPart(cursor, "opcursor-label"),
    "opcursor-label-bg",
  );
  if (!text || !background) return;
  const normalizedLabel = label.length > 48 ? `${label.slice(0, 45)}…` : label;
  text.textContent = normalizedLabel;
  background.setAttributeNS(
    null,
    "width",
    String(12 + normalizedLabel.length * 6.4),
  );
}

/**
 * @param {CursorState} state
 * @param {CursorMessage} message
 */
export function draw(state, message) {
  if (!message.socket && isOwnCursorSuppressed(state)) return;
  const cursor = getCursor(state.board, `cursor-${message.socket || "me"}`);
  cursor.style.transform = `translate(${message.x}px, ${message.y}px)`;
  const marker = getCursorPart(cursor, "opcursor-marker");
  if (!marker) return;
  cursor.setAttributeNS(null, "fill", message.color);
  cursor.setAttributeNS(null, "r", String(message.size / 2));
  marker.setAttributeNS(null, "fill", message.color);
  marker.setAttributeNS(null, "r", String(message.size / 2));
  const opacity =
    typeof message.opacity === "number" && Number.isFinite(message.opacity)
      ? message.opacity
      : 1;
  cursor.setAttributeNS(null, "fill-opacity", String(opacity));
  marker.setAttributeNS(null, "fill-opacity", String(opacity));
  setCursorLabel(cursor, getCursorLabel(state, message));
}
