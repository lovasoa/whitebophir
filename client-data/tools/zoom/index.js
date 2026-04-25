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

/** @typedef {{pageX: number, pageY: number, clientY: number, scale: number}} ZoomOrigin */
/** @typedef {{preventDefault(): void, clientY?: number, pageX?: number, pageY?: number, shiftKey?: boolean, ctrlKey?: boolean, altKey?: boolean, deltaMode?: number, deltaX?: number, deltaY?: number, changedTouches?: TouchList, touches?: TouchList}} ZoomPointerEvent */
/** @typedef {(evt: KeyboardEvent) => void} ZoomKeyHandler */
/** @import { MountedAppToolsState, ToolBootContext } from "../../../types/app-runtime" */
/** @typedef {{tools: MountedAppToolsState, origin: ZoomOrigin, moved: boolean, pressed: boolean, animation: number | null, keydown: ZoomKeyHandler, keyup: ZoomKeyHandler}} ZoomState */

const ZOOM_FACTOR = 0.5;

export const toolId = "zoom";
export const shortcut = "z";
export const mouseCursor = "zoom-in";
export const helpText = "click_to_zoom";
export const showMarker = true;
export const visibleWhenReadOnly = true;

/**
 * @param {ZoomPointerEvent} evt
 * @param {boolean} isTouchEvent
 * @returns {number}
 */
function getClientY(evt, isTouchEvent) {
  if (isTouchEvent) {
    const touch = evt.changedTouches && evt.changedTouches[0];
    return touch ? touch.clientY : 0;
  }
  return evt.clientY || 0;
}

/**
 * @param {ZoomPointerEvent} evt
 * @param {boolean} isTouchEvent
 * @param {number} fallback
 * @param {"pageX" | "pageY"} axis
 * @returns {number}
 */
function getPageCoordinate(evt, isTouchEvent, fallback, axis) {
  if (isTouchEvent) {
    const touch = evt.changedTouches && evt.changedTouches[0];
    const value = touch && touch[axis];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }
  const value = evt[axis];
  return Number.isFinite(value) ? Number(value) : fallback;
}

/**
 * @param {ZoomState} state
 * @param {number} scale
 */
function zoom(state, scale) {
  state.tools.viewport.zoomAt(scale, state.origin.pageX, state.origin.pageY);
}

/**
 * @param {ZoomState} state
 * @param {number} scale
 */
function animate(state, scale) {
  if (state.animation !== null) cancelAnimationFrame(state.animation);
  state.animation = requestAnimationFrame(() => {
    zoom(state, scale);
  });
}

/**
 * @param {ZoomState} state
 * @param {number} x
 * @param {number} y
 * @param {ZoomPointerEvent} evt
 * @param {boolean} isTouchEvent
 */
function setOrigin(state, x, y, evt, isTouchEvent) {
  const scale = state.tools.getScale();
  state.origin.pageX = getPageCoordinate(evt, isTouchEvent, x * scale, "pageX");
  state.origin.pageY = getPageCoordinate(evt, isTouchEvent, y * scale, "pageY");
  state.origin.clientY = getClientY(evt, isTouchEvent);
  state.origin.scale = scale;
}

/** @param {ZoomState} state */
function touchend(state) {
  state.pressed = false;
}

/**
 * @param {ZoomState} state
 * @param {boolean} down
 * @param {KeyboardEvent} evt
 */
function handleShiftKey(state, down, evt) {
  if (evt.key === "Shift") {
    state.tools.svg.style.cursor = `zoom-${down ? "out" : "in"}`;
  }
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  /** @type {ZoomState} */
  const state = {
    tools: ctx.Tools,
    origin: {
      pageX: 0,
      pageY: 0,
      clientY: 0,
      scale: 1,
    },
    moved: false,
    pressed: false,
    animation: null,
    keydown: () => {},
    keyup: () => {},
  };
  state.keydown = handleShiftKey.bind(null, state, true);
  state.keyup = handleShiftKey.bind(null, state, false);
  return state;
}

/**
 * @param {ZoomState} state
 * @param {number} x
 * @param {number} y
 * @param {ZoomPointerEvent} evt
 * @param {boolean} isTouchEvent
 */
export function press(state, x, y, evt, isTouchEvent) {
  evt.preventDefault();
  setOrigin(state, x, y, evt, isTouchEvent);
  state.moved = false;
  state.pressed = true;
}

/**
 * @param {ZoomState} state
 * @param {number} _x
 * @param {number} _y
 * @param {ZoomPointerEvent} evt
 * @param {boolean} isTouchEvent
 */
export function move(state, _x, _y, evt, isTouchEvent) {
  if (!state.pressed) return;
  evt.preventDefault();
  const delta = getClientY(evt, isTouchEvent) - state.origin.clientY;
  const scale = state.origin.scale * (1 + (delta * ZOOM_FACTOR) / 100);
  if (Math.abs(delta) > 1) state.moved = true;
  animate(state, scale);
}

/**
 * @param {ZoomState} state
 * @param {number} x
 * @param {number} y
 * @param {ZoomPointerEvent & {shiftKey?: boolean}} evt
 */
export function release(state, x, y, evt) {
  void x;
  void y;
  if (state.pressed && !state.moved) {
    const delta = evt.shiftKey === true ? -1 : 1;
    state.tools.viewport.zoomBy(
      1 + delta * ZOOM_FACTOR,
      state.origin.pageX,
      state.origin.pageY,
    );
  }
  touchend(state);
}

/** @param {ZoomState} state */
export function onstart(state) {
  window.addEventListener("keydown", state.keydown);
  window.addEventListener("keyup", state.keyup);
}

/** @param {ZoomState} state */
export function onquit(state) {
  window.removeEventListener("keydown", state.keydown);
  window.removeEventListener("keyup", state.keyup);
}

export function draw() {}
