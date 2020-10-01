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

(function () { // Code isolation

    // Allocate half of the maximum server updates to cursor updates
    var MIN_CURSOR_UPDATES_INTERVAL_MS = Tools.server_config.MAX_EMIT_COUNT_PERIOD / Tools.server_config.MAX_EMIT_COUNT * 2;

    var CURSOR_DELETE_AFTER_MS = 1000 * 5;

    var lastCursorUpdate = 0;
    var sending = true;

    var cursorTool = {
        "name": "Cursor",
        "listeners": {
            "press": function () { sending = false },
            "move": handleMarker,
            "release": function () { sending = true },
        },
        "onSizeChange": onSizeChange,
        "draw": draw,
        "mouseCursor": "crosshair",
        "icon": "tools/pencil/icon.svg",
    };
    Tools.register(cursorTool);
    Tools.addToolListeners(cursorTool);

    var message = {
        type: "update",
        x: 0,
        y: 0,
        color: Tools.getColor(),
        size: Tools.getSize(),
    };

    function handleMarker(x, y) {
        // throttle local cursor updates
        message.x = x;
        message.y = y;
        message.color = Tools.getColor();
        message.size = Tools.getSize();
        updateMarker();
    }

    function onSizeChange(size) {
        message.size = size;
        updateMarker();
    }

    function updateMarker() {
        if (!Tools.showMarker || !Tools.showMyCursor) return;
        var cur_time = Date.now();
        if (cur_time - lastCursorUpdate > MIN_CURSOR_UPDATES_INTERVAL_MS &&
            (sending || Tools.curTool.showMarker)) {
            Tools.drawAndSend(message, cursorTool);
            lastCursorUpdate = cur_time;
        } else {
            draw(message);
        }
    }

    var cursorsElem = Tools.svg.getElementById("cursors");

    function createCursor(id) {
        var cursor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        cursor.setAttributeNS(null, "class", "opcursor");
        cursor.setAttributeNS(null, "id", id);
        cursor.setAttributeNS(null, "cx", 0);
        cursor.setAttributeNS(null, "cy", 0);
        cursor.setAttributeNS(null, "r", 10);
        cursorsElem.appendChild(cursor);
        setTimeout(function () {
            cursorsElem.removeChild(cursor);
        }, CURSOR_DELETE_AFTER_MS);
        return cursor;
    }

    function getCursor(id) {
        return document.getElementById(id) || createCursor(id);
    }

    function draw(message) {
        var cursor = getCursor("cursor-" + (message.socket || 'me'));
        cursor.style.transform = "translate(" + message.x + "px, " + message.y + "px)";
        if (Tools.isIE) cursor.setAttributeNS(null, "transform", "translate(" + message.x + " " + message.y + ")");
        cursor.setAttributeNS(null, "fill", message.color);
        cursor.setAttributeNS(null, "r", message.size / 2);
    }
})();