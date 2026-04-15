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
/** @typedef {{add: (tool: unknown) => void, board: {addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions | undefined) => void}, getScale: () => number, setScale: (scale:number)=>number, setSize: (size:number)=>void, getSize: ()=>number, svg: SVGSVGElement}} ZoomToolRegistry */

/** @param {ZoomToolRegistry} tools */
export function registerZoomTool(tools) {
  var ZOOM_FACTOR = 0.5;
  /** @type {ZoomOrigin} */
  var origin = {
    scrollX: document.documentElement.scrollLeft,
    scrollY: document.documentElement.scrollTop,
    x: 0.0,
    y: 0.0,
    clientY: 0,
    scale: 1.0,
    distance: null,
  };
  var moved = false,
    pressed = false;

  /**
   * @param {ZoomOrigin} origin
   * @param {number} scale
   */
  function zoom(origin, scale) {
    var oldScale = origin.scale;
    var newScale = tools.setScale(scale);
    window.scrollTo(
      origin.scrollX + origin.x * (newScale - oldScale),
      origin.scrollY + origin.y * (newScale - oldScale),
    );
  }

  /** @type {number | null} */
  var animation = null;
  /** @param {number} scale */
  function animate(scale) {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = requestAnimationFrame(() => {
      zoom(origin, scale);
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ZoomPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  function setOrigin(x, y, evt, isTouchEvent) {
    origin.scrollX = document.documentElement.scrollLeft;
    origin.scrollY = document.documentElement.scrollTop;
    origin.x = x;
    origin.y = y;
    origin.clientY = getClientY(evt, isTouchEvent);
    origin.scale = tools.getScale();
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ZoomPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  function press(x, y, evt, isTouchEvent) {
    evt.preventDefault();
    setOrigin(x, y, evt, isTouchEvent);
    moved = false;
    pressed = true;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ZoomPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  function move(x, y, evt, isTouchEvent) {
    if (pressed) {
      evt.preventDefault();
      const delta = getClientY(evt, isTouchEvent) - origin.clientY;
      const scale = origin.scale * (1 + (delta * ZOOM_FACTOR) / 100);
      if (Math.abs(delta) > 1) moved = true;
      animate(scale);
    }
  }

  /** @param {Event} evt */
  function onwheel(evt) {
    var wheelEvent = /** @type {WheelEvent} */ (evt);
    evt.preventDefault();
    var multiplier =
      wheelEvent.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 30
        : wheelEvent.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? 1000
          : 1;
    var deltaX = wheelEvent.deltaX * multiplier,
      deltaY = wheelEvent.deltaY * multiplier;
    if (!wheelEvent.ctrlKey) {
      // zoom
      const scale = tools.getScale();
      const x = wheelEvent.pageX / scale;
      const y = wheelEvent.pageY / scale;
      setOrigin(x, y, wheelEvent, false);
      animate((1 - deltaY / 800) * tools.getScale());
    } else if (wheelEvent.altKey) {
      // make finer changes if shift is being held
      const change = wheelEvent.shiftKey ? 1 : 5;
      // change tool size
      tools.setSize(tools.getSize() - (deltaY / 100) * change);
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
  tools.board.addEventListener("wheel", onwheel, { passive: false });

  tools.board.addEventListener(
    "touchmove",
    /** @param {Event} evt */
    function ontouchmove(evt) {
      var touchEvent = /** @type {TouchEvent} */ (evt);
      // 2-finger pan to zoom
      var touches = touchEvent.touches;
      if (touches.length === 2) {
        const firstTouch = touches[0];
        const secondTouch = touches[1];
        if (!firstTouch || !secondTouch) return;
        const x0 = firstTouch.clientX,
          x1 = secondTouch.clientX,
          y0 = firstTouch.clientY,
          y1 = secondTouch.clientY,
          dx = x0 - x1,
          dy = y0 - y1;
        const x = (firstTouch.pageX + secondTouch.pageX) / 2 / tools.getScale(),
          y = (firstTouch.pageY + secondTouch.pageY) / 2 / tools.getScale();
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (!pressed) {
          pressed = true;
          setOrigin(x, y, touchEvent, true);
          origin.distance = distance;
        } else {
          const delta = distance - (origin.distance || distance);
          const scale = origin.scale * (1 + (delta * ZOOM_FACTOR) / 100);
          animate(scale);
        }
      }
    },
    { passive: true },
  );
  function touchend() {
    pressed = false;
    origin.distance = null;
  }
  tools.board.addEventListener("touchend", touchend);
  tools.board.addEventListener("touchcancel", touchend);

  /**
   * @param {number} x
   * @param {number} y
   * @param {ZoomPointerEvent & {shiftKey?: boolean}} evt
   * @param {boolean} isTouchEvent
   */
  function release(x, y, evt, isTouchEvent) {
    if (pressed && !moved) {
      const delta = evt.shiftKey === true ? -1 : 1;
      const scale = tools.getScale() * (1 + delta * ZOOM_FACTOR);
      zoom(origin, scale);
    }
    pressed = false;
    origin.distance = null;
  }

  /** @param {boolean} down */
  function key(down) {
    /** @type {ZoomKeyHandler} */
    return (evt) => {
      if (evt.key === "Shift") {
        tools.svg.style.cursor = `zoom-${down ? "out" : "in"}`;
      }
    };
  }

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

  var keydown = key(true);
  var keyup = key(false);

  function onstart() {
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
  }
  function onquit() {
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
  }

  var zoomTool = {
    name: "Zoom",
    shortcut: "z",
    listeners: {
      press: press,
      move: move,
      release: release,
    },
    onstart: onstart,
    onquit: onquit,
    mouseCursor: "zoom-in",
    icon: "tools/zoom/icon.svg",
    helpText: "click_to_zoom",
    showMarker: true,
  };
  tools.add(zoomTool);
}
