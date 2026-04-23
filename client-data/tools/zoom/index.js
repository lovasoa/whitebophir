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

/** @typedef {{scrollX: number, scrollY: number, x: number, y: number, clientY: number, scale: number, distance: number | null}} ZoomOrigin */
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
 * @param {ZoomState} state
 * @param {number} scale
 */
function zoom(state, scale) {
  const oldScale = state.origin.scale;
  const newScale = state.tools.setScale(scale);
  window.scrollTo(
    state.origin.scrollX + state.origin.x * (newScale - oldScale),
    state.origin.scrollY + state.origin.y * (newScale - oldScale),
  );
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
  state.origin.scrollX = document.documentElement.scrollLeft;
  state.origin.scrollY = document.documentElement.scrollTop;
  state.origin.x = x;
  state.origin.y = y;
  state.origin.clientY = getClientY(evt, isTouchEvent);
  state.origin.scale = state.tools.getScale();
}

/**
 * @param {ZoomState} state
 * @param {Event} evt
 */
function onwheel(state, evt) {
  const wheelEvent = /** @type {WheelEvent} */ (evt);
  evt.preventDefault();
  const multiplier =
    wheelEvent.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 30
      : wheelEvent.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 1000
        : 1;
  const deltaX = wheelEvent.deltaX * multiplier;
  const deltaY = wheelEvent.deltaY * multiplier;
  if (!wheelEvent.ctrlKey) {
    const x = state.tools.pageCoordinateToBoard(wheelEvent.pageX);
    const y = state.tools.pageCoordinateToBoard(wheelEvent.pageY);
    setOrigin(state, x, y, wheelEvent, false);
    animate(state, (1 - deltaY / 800) * state.tools.getScale());
    return;
  }
  if (wheelEvent.altKey) {
    const change = wheelEvent.shiftKey ? 1 : 5;
    state.tools.setSize(state.tools.getSize() - (deltaY / 100) * change);
    return;
  }
  if (wheelEvent.shiftKey) {
    window.scrollTo(
      document.documentElement.scrollLeft + deltaY,
      document.documentElement.scrollTop + deltaX,
    );
    return;
  }
  window.scrollTo(
    document.documentElement.scrollLeft + deltaX,
    document.documentElement.scrollTop + deltaY,
  );
}

/** @param {ZoomState} state */
function touchend(state) {
  state.pressed = false;
  state.origin.distance = null;
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

/** @param {ZoomState} state */
function installBoardListeners(state) {
  const board = state.tools.board;
  board.addEventListener("wheel", (evt) => onwheel(state, evt), {
    passive: false,
  });
  board.addEventListener(
    "touchmove",
    (evt) => {
      const touchEvent = /** @type {TouchEvent} */ (evt);
      const touches = touchEvent.touches;
      if (touches.length !== 2) return;
      const firstTouch = touches[0];
      const secondTouch = touches[1];
      if (!firstTouch || !secondTouch) return;
      const dx = firstTouch.clientX - secondTouch.clientX;
      const dy = firstTouch.clientY - secondTouch.clientY;
      const x = state.tools.pageCoordinateToBoard(
        (firstTouch.pageX + secondTouch.pageX) / 2,
      );
      const y = state.tools.pageCoordinateToBoard(
        (firstTouch.pageY + secondTouch.pageY) / 2,
      );
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!state.pressed) {
        state.pressed = true;
        setOrigin(state, x, y, touchEvent, true);
        state.origin.distance = distance;
      } else {
        const delta = distance - (state.origin.distance || distance);
        animate(state, state.origin.scale * (1 + (delta * ZOOM_FACTOR) / 100));
      }
    },
    { passive: true },
  );
  board.addEventListener("touchend", () => touchend(state));
  board.addEventListener("touchcancel", () => touchend(state));
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  /** @type {ZoomState} */
  const state = {
    tools: ctx.Tools,
    origin: {
      scrollX: document.documentElement.scrollLeft,
      scrollY: document.documentElement.scrollTop,
      x: 0,
      y: 0,
      clientY: 0,
      scale: 1,
      distance: null,
    },
    moved: false,
    pressed: false,
    animation: null,
    keydown: () => {},
    keyup: () => {},
  };
  state.keydown = handleShiftKey.bind(null, state, true);
  state.keyup = handleShiftKey.bind(null, state, false);
  installBoardListeners(state);
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
    zoom(state, state.tools.getScale() * (1 + delta * ZOOM_FACTOR));
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
