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

(function grid() { //Code isolation

    var index = 0; //grid off by default
    var states = ["none", "url(../tools/grid/patterns.svg#grid)", "url(../tools/grid/patterns.svg#dots)"];

    function toggleGrid(evt) {
        index = (index + 1) % states.length;
        gridContainer.setAttributeNS(null, "fill", states[index]);
    }

    function createSVGElement(name, attrs) {
        var elem = document.createElementNS("http://www.w3.org/2000/svg", name);
        Object.keys(attrs).forEach(function (key, i) {
            elem.setAttributeNS(null, key, attrs[key]);
        });
        return elem;
    }

    var gridContainer = (function init() {
        // create grid container
        var gridContainer = createSVGElement("rect", {
            id: "gridContainer",
            width: "100%", height: "100%",
            fill: states[index]
        });
        Tools.svg.insertBefore(gridContainer, Tools.drawingArea);
        return gridContainer;
    })();

    Tools.add({ //The new tool
        "name": "Grid",
        "shortcut": "g",
        "listeners": {},
        "icon": "tools/grid/icon.svg",
        "oneTouch": true,
        "onstart": toggleGrid,
        "mouseCursor": "crosshair",
    });

})(); //End of code isolation