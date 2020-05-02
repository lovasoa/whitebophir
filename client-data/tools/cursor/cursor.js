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
    var MAX_CURSOR_UPDATES_INTERVAL_MS = Tools.server_config.MAX_EMIT_COUNT_PERIOD / Tools.server_config.MAX_EMIT_COUNT * 2;

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
        "draw": draw,
        "mouseCursor": "crosshair",
        "icon": "tools/pencil/icon.svg",
    };
    Tools.register(cursorTool);
    Tools.addToolListeners(cursorTool);

    function handleMarker(x, y) {
        if (!Tools.showMarker || !Tools.showMyCursor) return;

        // throttle local cursor updates
        var cur_time = Date.now();
        var message = {
            type: "update",
            x: x,
            y: y,
            color: Tools.getColor(),
            size: Tools.getSize(),
        };

        if (cur_time - lastCursorUpdate > MAX_CURSOR_UPDATES_INTERVAL_MS &&
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
        cursorsElem.append(cursor);
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
        cursor.setAttributeNS(null, "fill", message.color);
        cursor.setAttributeNS(null, "r", message.size / 2);
    }
})();