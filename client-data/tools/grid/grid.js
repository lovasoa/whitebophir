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

(function grid() { //Code isolation

    var index = 0; //grid off by default
    var states = ["none", "url(#grid)", "url(#dots)"];

    function toggleGrid(evt) {
        index = (index+1) % states.length;
        gridContainer.setAttributeNS(null, "fill", states[index]);
    }

    function createSVGElement(name, attrs) {
        var elem = document.createElementNS("http://www.w3.org/2000/svg", name);
        Object.keys(attrs).forEach(function(key, i) {
            elem.setAttributeNS(null, key, attrs[key]);
        });
        return elem;
    }

    function init() {
        // create patterns
        // small (inner) grid
        var smallGrid = createSVGElement("pattern", {id: "smallGrid", width: "30", height: "30", patternUnits: "userSpaceOnUse"});
        smallGrid.appendChild(
            createSVGElement("path", {d: "M 30 0 L 0 0 0 30", fill: "none", stroke: "gray", 'stroke-width': "0.5"})
        );
        // (outer) grid
        var grid = createSVGElement("pattern", {id: "grid", width: "300", height: "300", patternUnits: "userSpaceOnUse"});
        grid.appendChild(createSVGElement("rect", {width: "300", height: "300", fill: "url(#smallGrid)"}));
        grid.appendChild(
            createSVGElement("path", {d: "M 300 0 L 0 0 0 300", fill: "none", stroke: "gray", 'stroke-width': "1"})
        );
        // dots
        var dots = createSVGElement("pattern", {id: "dots", width: "30", height: "30", x: "-10", y: "-10", patternUnits: "userSpaceOnUse"});
        dots.appendChild(createSVGElement("circle", {fill: "gray", cx: "10", cy: "10", r: "2"}));

        var defs = Tools.svg.getElementById("defs");
        defs.appendChild(smallGrid);
        defs.appendChild(grid);
        defs.appendChild(dots);

        // create grid container
        var gridContainer = createSVGElement("rect", {id: "gridContainer", width: "100%", height: "100%", fill: states[index]});
        Tools.svg.insertBefore(gridContainer, Tools.drawingArea);

        return gridContainer;
    }

    var gridContainer = init();

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