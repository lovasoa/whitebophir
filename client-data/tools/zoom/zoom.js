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
/** @typedef {import("../../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

export default class ZoomTool {
  static toolName = "Zoom";
  static ZOOM_FACTOR = 0.5;

  /**
   * @param {AppToolsState} tools
   */
  constructor(tools) {
    this.tools = tools;
    this.name = "Zoom";
    this.shortcut = "z";
    this.mouseCursor = "zoom-in";
    this.icon = "tools/zoom/icon.svg";
    this.helpText = "click_to_zoom";
    this.showMarker = true;
    /** @type {ZoomOrigin} */
    this.origin = {
      scrollX: document.documentElement.scrollLeft,
      scrollY: document.documentElement.scrollTop,
      x: 0.0,
      y: 0.0,
      clientY: 0,
      scale: 1.0,
      distance: null,
    };
    this.moved = false;
    this.pressed = false;
    /** @type {number | null} */
    this.animation = null;
    /** @type {ZoomKeyHandler} */
    this.keydown = this.handleShiftKey.bind(this, true);
    /** @type {ZoomKeyHandler} */
    this.keyup = this.handleShiftKey.bind(this, false);
    this.installBoardListeners();
  }

  /**
   * @param {number} scale
   */
  zoom(scale) {
    const oldScale = this.origin.scale;
    const newScale = this.tools.setScale(scale);
    window.scrollTo(
      this.origin.scrollX + this.origin.x * (newScale - oldScale),
      this.origin.scrollY + this.origin.y * (newScale - oldScale),
    );
  }

  /** @param {number} scale */
  animate(scale) {
    if (this.animation !== null) cancelAnimationFrame(this.animation);
    this.animation = requestAnimationFrame(() => {
      this.zoom(scale);
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ZoomPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  setOrigin(x, y, evt, isTouchEvent) {
    this.origin.scrollX = document.documentElement.scrollLeft;
    this.origin.scrollY = document.documentElement.scrollTop;
    this.origin.x = x;
    this.origin.y = y;
    this.origin.clientY = this.getClientY(evt, isTouchEvent);
    this.origin.scale = this.tools.getScale();
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ZoomPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  press(x, y, evt, isTouchEvent) {
    evt.preventDefault();
    this.setOrigin(x, y, evt, isTouchEvent);
    this.moved = false;
    this.pressed = true;
  }

  /**
   * @param {number} _x
   * @param {number} _y
   * @param {ZoomPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  move(_x, _y, evt, isTouchEvent) {
    if (this.pressed) {
      evt.preventDefault();
      const delta = this.getClientY(evt, isTouchEvent) - this.origin.clientY;
      const scale =
        this.origin.scale * (1 + (delta * ZoomTool.ZOOM_FACTOR) / 100);
      if (Math.abs(delta) > 1) this.moved = true;
      this.animate(scale);
    }
  }

  /** @param {Event} evt */
  onwheel(evt) {
    const wheelEvent = /** @type {WheelEvent} */ (evt);
    evt.preventDefault();
    const multiplier =
      wheelEvent.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 30
        : wheelEvent.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? 1000
          : 1;
    const deltaX = wheelEvent.deltaX * multiplier,
      deltaY = wheelEvent.deltaY * multiplier;
    if (!wheelEvent.ctrlKey) {
      // zoom
      const scale = this.tools.getScale();
      const x = wheelEvent.pageX / scale;
      const y = wheelEvent.pageY / scale;
      this.setOrigin(x, y, wheelEvent, false);
      this.animate((1 - deltaY / 800) * this.tools.getScale());
    } else if (wheelEvent.altKey) {
      // make finer changes if shift is being held
      const change = wheelEvent.shiftKey ? 1 : 5;
      // change tool size
      this.tools.setSize(this.tools.getSize() - (deltaY / 100) * change);
    } else if (wheelEvent.shiftKey) {
      // scroll horizontally
      window.scrollTo(
        document.documentElement.scrollLeft + deltaY,
        document.documentElement.scrollTop + deltaX,
      );
    } else {
      // regular scrolling
      window.scrollTo(
        document.documentElement.scrollLeft + deltaX,
        document.documentElement.scrollTop + deltaY,
      );
    }
  }

  installBoardListeners() {
    this.tools.board.addEventListener("wheel", this.onwheel.bind(this), {
      passive: false,
    });

    this.tools.board.addEventListener(
      "touchmove",
      /** @param {Event} evt */
      (evt) => {
        const touchEvent = /** @type {TouchEvent} */ (evt);
        // 2-finger pan to zoom
        const touches = touchEvent.touches;
        if (touches.length !== 2) return;
        const firstTouch = touches[0];
        const secondTouch = touches[1];
        if (!firstTouch || !secondTouch) return;
        const x0 = firstTouch.clientX,
          x1 = secondTouch.clientX,
          y0 = firstTouch.clientY,
          y1 = secondTouch.clientY,
          dx = x0 - x1,
          dy = y0 - y1;
        const x =
          (firstTouch.pageX + secondTouch.pageX) / 2 / this.tools.getScale();
        const y =
          (firstTouch.pageY + secondTouch.pageY) / 2 / this.tools.getScale();
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (!this.pressed) {
          this.pressed = true;
          this.setOrigin(x, y, touchEvent, true);
          this.origin.distance = distance;
        } else {
          const delta = distance - (this.origin.distance || distance);
          const scale =
            this.origin.scale * (1 + (delta * ZoomTool.ZOOM_FACTOR) / 100);
          this.animate(scale);
        }
      },
      { passive: true },
    );
    this.tools.board.addEventListener("touchend", this.touchend.bind(this));
    this.tools.board.addEventListener("touchcancel", this.touchend.bind(this));
  }

  touchend() {
    this.pressed = false;
    this.origin.distance = null;
  }

  /**
   * @param {number} _x
   * @param {number} _y
   * @param {ZoomPointerEvent & {shiftKey?: boolean}} evt
   * @param {boolean} _isTouchEvent
   */
  release(_x, _y, evt, _isTouchEvent) {
    if (this.pressed && !this.moved) {
      const delta = evt.shiftKey === true ? -1 : 1;
      const scale = this.tools.getScale() * (1 + delta * ZoomTool.ZOOM_FACTOR);
      this.zoom(scale);
    }
    this.pressed = false;
    this.origin.distance = null;
  }

  /**
   * @param {boolean} down
   * @param {KeyboardEvent} evt
   */
  handleShiftKey(down, evt) {
    if (evt.key === "Shift") {
      this.tools.svg.style.cursor = `zoom-${down ? "out" : "in"}`;
    }
  }

  /**
   * @param {ZoomPointerEvent} evt
   * @param {boolean} isTouchEvent
   * @returns {number}
   */
  getClientY(evt, isTouchEvent) {
    if (isTouchEvent) {
      const touch = evt.changedTouches && evt.changedTouches[0];
      return touch ? touch.clientY : 0;
    }
    return evt.clientY || 0;
  }

  onstart() {
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
  }
  onquit() {
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<ZoomTool>}
   */
  static async boot(ctx) {
    return new ZoomTool(ctx.runtime.Tools);
  }
}
