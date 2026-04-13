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

(function () {
  // Code isolation
  /** @typedef {{type: "update", x: number, y: number, color: string, size: number, socket?: string}} CursorMessage */
  /** @typedef {{name: string, listeners: {press: () => void, move: typeof handleMarker, release: () => void}, onSizeChange: typeof onSizeChange, draw: typeof draw, mouseCursor: string, icon: string, showMarker: boolean}} CursorTool */

  /**
   * @param {unknown} value
   * @param {number} fallback
   * @returns {number}
   */
  function getPositiveNumber(value, fallback) {
    var number = Number(value);
    return number > 0 ? number : fallback;
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
  var MIN_CURSOR_UPDATES_INTERVAL_MS =
    (getPositiveNumber(Tools.server_config.MAX_EMIT_COUNT_PERIOD, 4096) /
      getPositiveNumber(Tools.server_config.MAX_EMIT_COUNT, 192)) *
    2;

  var CURSOR_DELETE_AFTER_MS = 1000 * 5;

  var lastCursorUpdate = 0;
  var sending = true;

  /** @type {CursorTool} */
  var cursorTool = {
    name: "Cursor",
    listeners: {
      press: function () {
        sending = false;
      },
      move: handleMarker,
      release: function () {
        sending = true;
      },
    },
    onSizeChange: onSizeChange,
    draw: draw,
    mouseCursor: "crosshair",
    icon: "tools/pencil/icon.svg",
    showMarker: true,
  };
  Tools.register(cursorTool);
  Tools.addToolListeners(cursorTool);

  /** @type {CursorMessage} */
  var message = {
    type: "update",
    x: 0,
    y: 0,
    color: Tools.getColor(),
    size: Tools.getSize(),
  };

  /**
   * @param {number} x
   * @param {number} y
   */
  function handleMarker(x, y) {
    // throttle local cursor updates
    message.x = x;
    message.y = y;
    message.color = Tools.getColor();
    message.size = Tools.getSize();
    updateMarker();
  }

  /** @param {number} size */
  function onSizeChange(size) {
    message.size = size;
    updateMarker();
  }

  function updateMarker() {
    var activeTool = /** @type {{showMarker?: boolean} | null} */ (
      Tools.curTool
    );
    if (!Tools.showMarker || !Tools.showMyCursor) return;
    var cur_time = Date.now();
    if (
      cur_time - lastCursorUpdate > MIN_CURSOR_UPDATES_INTERVAL_MS &&
      (sending || (activeTool && activeTool.showMarker === true))
    ) {
      Tools.drawAndSend(message, cursorTool);
      lastCursorUpdate = cur_time;
    } else {
      draw(message);
    }
  }

  function getCursorsLayer() {
    var existingLayer = Tools.svg.getElementById("cursors");
    if (existingLayer instanceof SVGGElement) return existingLayer;
    var createdLayer = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    createdLayer.setAttributeNS(null, "id", "cursors");
    Tools.svg.appendChild(createdLayer);
    return createdLayer;
  }

  /** @param {string} id */
  function createCursor(id) {
    var cursorsElem = getCursorsLayer();
    var cursor = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    cursor.setAttributeNS(null, "class", "opcursor");
    cursor.setAttributeNS(null, "id", id);
    cursor.setAttributeNS(null, "cx", "0");
    cursor.setAttributeNS(null, "cy", "0");
    cursor.setAttributeNS(null, "r", "10");
    cursorsElem.appendChild(cursor);
    setTimeout(function () {
      cursorsElem.removeChild(cursor);
    }, CURSOR_DELETE_AFTER_MS);
    return cursor;
  }

  /** @param {string} id */
  function getCursor(id) {
    var existingCursor = document.getElementById(id);
    return isCursorElement(existingCursor) ? existingCursor : createCursor(id);
  }

  /** @param {CursorMessage} message */
  function draw(message) {
    var cursor = getCursor("cursor-" + (message.socket || "me"));
    cursor.style.transform =
      "translate(" + message.x + "px, " + message.y + "px)";
    if (Tools.isIE)
      cursor.setAttributeNS(
        null,
        "transform",
        "translate(" + message.x + " " + message.y + ")",
      );
    cursor.setAttributeNS(null, "fill", message.color);
    cursor.setAttributeNS(null, "r", String(message.size / 2));
  }
})();
