/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the 
 *  JavaScript code in this page.
 *
 * Copyright (C) 2022  Ava Robotics
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

(function clear() {
    // when new button clicks then calls this function
    function btnClickHandler() {
        if (window.confirm("Delete this whiteboard drawing?")) {
            Tools.drawAndSend({
                'type': 'deleteall',
            },
            clearTool);
            Tools.robotTools.showKeepout(true);
        }
    }
    
    // this is callback handler from socket
    function eraseAll(data) {
        switch (data.type) {
            case "deleteall":
                Tools.drawingArea.innerHTML = '';
                break;
        }
    }

    const clearTool = {
        "name": "Clear",
        "shortcut": "x",
        "listeners": {},
        "icon": "tools/clear/clear.svg",
        "oneTouch": true,
        "onstart": btnClickHandler,
        "draw": eraseAll,
        "mouseCursor": "crosshair",
    }

    Tools.add(clearTool);

})(); 