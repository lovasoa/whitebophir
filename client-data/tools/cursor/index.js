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
import { createBoardHtmlOverlay } from "../../js/board_html_overlay.js";
import { getConnectedUserDisplayName } from "../../js/board_presence_module.js";
import { getToolRuntimeAssetPath } from "../tool-defaults.js";
import { TOOL_CODE_BY_ID } from "../tool-order.js";

/** @import { ToolBootContext, ToolRuntimeModules } from "../../../types/app-runtime" */
/** @typedef {ReturnType<typeof boot>} CursorState */
/** @typedef {ReturnType<typeof createBoardHtmlOverlay>} BoardHtmlOverlay */

export const toolId = "cursor";
const toolCode = TOOL_CODE_BY_ID[toolId];
export const mouseCursor = "crosshair";
export const showMarker = true;
export const alwaysOn = true;
const CURSOR_TTL_MS = 1000 * 5;

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
 * @param {HTMLElement} element
 * @param {string} name
 * @param {string} value
 */
function setStyleProperty(element, name, value) {
  if (typeof element.style.setProperty === "function") {
    element.style.setProperty(name, value);
    return;
  }
  element.style[/** @type {any} */ (name)] = value;
}

/**
 * @param {CursorState} state
 * @param {HTMLElement} element
 * @param {CursorMessage} message
 */
function updateCursorStyle(state, element, message) {
  const opacity =
    typeof message.opacity === "number" && Number.isFinite(message.opacity)
      ? message.opacity
      : 1;
  const sampleSize =
    getPositiveNumber(message.size, 1) * state.viewport.getScale();
  setStyleProperty(element, "--opcursor-color", message.color);
  setStyleProperty(element, "--opcursor-opacity", String(opacity));
  setStyleProperty(element, "--opcursor-sample-size", `${sampleSize}px`);
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function createCursorElement(id) {
  const cursor = document.createElement("div");
  cursor.id = id;
  cursor.setAttribute("class", "opcursor-html");
  cursor.setAttribute("aria-hidden", "true");

  const tip = document.createElement("span");
  tip.setAttribute("class", "opcursor-tip");
  cursor.appendChild(tip);

  if (id === "cursor-me") return cursor;

  const pill = document.createElement("span");
  pill.setAttribute("class", "opcursor-pill");

  const toolBadge = document.createElement("span");
  toolBadge.setAttribute("class", "opcursor-toolBadge");
  const toolIcon = document.createElement("img");
  toolIcon.setAttribute("class", "opcursor-toolIcon");
  toolIcon.alt = "";
  toolIcon.width = 16;
  toolIcon.height = 16;
  toolBadge.appendChild(toolIcon);

  const name = document.createElement("span");
  name.setAttribute("class", "opcursor-name");

  pill.appendChild(toolBadge);
  pill.appendChild(name);
  cursor.appendChild(pill);
  return cursor;
}

/**
 * @param {CursorState} state
 * @param {string} cursorId
 */
function removeCursor(state, cursorId) {
  const existing = state.cursors.get(cursorId);
  if (!existing) return;
  clearTimeout(existing.timeout);
  existing.overlay.destroy();
  state.cursors.delete(cursorId);
}

/**
 * @param {CursorState} state
 * @param {string} cursorId
 */
function getCursor(state, cursorId) {
  const existing = state.cursors.get(cursorId);
  if (existing) {
    clearTimeout(existing.timeout);
    existing.timeout = setTimeout(
      () => removeCursor(state, cursorId),
      CURSOR_TTL_MS,
    );
    return existing;
  }
  const element = createCursorElement(cursorId);
  const overlay = createBoardHtmlOverlay({
    board: state.board,
    viewport: state.viewport,
    element,
  });
  const entry = {
    element,
    overlay,
    timeout: setTimeout(() => removeCursor(state, cursorId), CURSOR_TTL_MS),
  };
  state.cursors.set(cursorId, entry);
  return entry;
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
  return {
    board: runtime.board,
    viewport: runtime.viewport,
    writes: runtime.writes,
    preferences: runtime.preferences,
    rateLimits: runtime.rateLimits,
    interaction: runtime.interaction,
    toolRegistry: runtime.toolRegistry,
    connection: runtime.connection,
    presence: runtime.presence,
    i18n: runtime.i18n,
    cursors:
      /** @type {Map<string, {element: HTMLElement, overlay: BoardHtmlOverlay, timeout: ReturnType<typeof setTimeout>}>} */ (
        new Map()
      ),
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
export function onSocketDisconnect(state) {
  for (const cursorId of Array.from(state.cursors.keys())) {
    removeCursor(state, cursorId);
  }
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
function getCursorName(state, message) {
  const user = getPresenceUser(state, message.socket);
  const translate = state.i18n?.t
    ? state.i18n.t.bind(state.i18n)
    : (/** @type {string} */ key) => key;
  return user
    ? getConnectedUserDisplayName(user)
    : message.socket
      ? translate("users")
      : "You";
}

/**
 * @param {CursorState} state
 * @param {CursorMessage} message
 */
function getCursorToolId(state, message) {
  const user = getPresenceUser(state, message.socket);
  return message.activeTool || user?.lastTool || getActiveToolId(state);
}

/**
 * @param {CursorState} state
 * @param {CursorMessage} message
 */
function getCursorToolLabel(state, message) {
  const translate = state.i18n?.t
    ? state.i18n.t.bind(state.i18n)
    : (/** @type {string} */ key) => key;
  const toolId = getCursorToolId(state, message);
  return translate(toolId) || toolId;
}

/**
 * @param {Element} element
 * @param {string} className
 * @returns {HTMLElement | null}
 */
function getCursorPart(element, className) {
  if (
    "querySelector" in element &&
    typeof element.querySelector === "function"
  ) {
    return /** @type {HTMLElement | null} */ (
      element.querySelector(`.${className}`)
    );
  }
  const children = Array.isArray(/** @type {any} */ (element).children)
    ? /** @type {any} */ (element).children
    : [];
  for (const child of children) {
    const classAttribute = String(child?.getAttribute?.("class") || "");
    if (classAttribute.split(/\s+/).includes(className)) return child;
    const nested = getCursorPart(child, className);
    if (nested) return nested;
  }
  return null;
}

/**
 * @param {CursorState} state
 * @param {HTMLElement} cursor
 * @param {CursorMessage} message
 */
function updateCursorContent(state, cursor, message) {
  const name = getCursorPart(cursor, "opcursor-name");
  if (name) name.textContent = getCursorName(state, message);

  const toolIcon = /** @type {HTMLImageElement | null} */ (
    getCursorPart(cursor, "opcursor-toolIcon")
  );
  if (toolIcon) {
    const toolId = getCursorToolId(state, message);
    toolIcon.src = `../${getToolRuntimeAssetPath(toolId, "icon.svg")}`;
    toolIcon.title = getCursorToolLabel(state, message);
  }
}

/**
 * @param {CursorState} state
 * @param {CursorMessage} message
 */
export function draw(state, message) {
  if (!message.socket && isOwnCursorSuppressed(state)) return;
  const cursorId = `cursor-${message.socket || "me"}`;
  const { element, overlay } = getCursor(state, cursorId);
  updateCursorContent(state, element, message);
  overlay.syncBoardRect(() => {
    updateCursorStyle(state, element, message);
    return {
      x: message.x,
      y: message.y,
      width: 0,
      height: 0,
    };
  });
}
