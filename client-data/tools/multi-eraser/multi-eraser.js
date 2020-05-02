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

(function multi_eraser() { //Code isolation

    var erasing = false;

    var curTool = "single";
    var end = false;
    var lastTime = performance.now(); //The time at which the last point was drawn
    var makeRect = false;
    var textElem;
    var oldScale = Tools.getScale();

    var msg = {
        "type": "delete",
        "id": null,
        "x": 0,
        "y": 0
    };

    var rect = {
        x: 0,
        y: 0,
        x2: 0,
        y2: 0
    };

    function startErasing(x, y, evt) {

        //Prevent the press from being interpreted by the browser
        evt.preventDefault();
        var shape = Tools.createSVGElement("rect");

        shape.id = "erase-rect";

        shape.setAttribute("stroke", "red");
        shape.setAttribute("fill", "gray");
        shape.setAttribute("stroke-width",.5/Tools.getScale());
        shape.setAttribute("fill-opacity",.1);

        Tools.svg.appendChild(shape);
        if(!textElem){
            textElem = Tools.createSVGElement("text");
            textElem.setAttribute("x", -1000);
            textElem.setAttribute("y", 100);

            textElem.setAttribute("font-size", 32/Tools.getScale());
            textElem.setAttribute("fill", "black");
            textElem.setAttribute("opacity",.1);
            textElem.textContent = "Kaboom!";
            Tools.svg.appendChild(textElem);
        }
        rect.x = x;
        rect.y = y;
        makeRect = true;
    }

    function stopErasing(x, y) {
        //Add a last point to the shape
        if (makeRect) {
            end = true;
            erase(x, y);
            end = false;
            var shape = svg.getElementById("erase-rect");
            erase_rect = shape.getBoundingClientRect();
            shape.remove();
            textElem.setAttribute("x", -1000);
            textElem.setAttribute("y", 100);
            textElem.style.visibility = "hidden";
            makeRect = false;
            var targets = [];
            for (var i = 0; i < Tools.drawingArea.children.length; i++) {
                var el = Tools.drawingArea.children[i];
                var r = el.getBoundingClientRect();
                if (r.left >= erase_rect.left && r.right <= erase_rect.right
                    && r.top >= erase_rect.top && r.bottom <= erase_rect.bottom) {
                    targets.push(el);
                }
            }
            console.log(targets);
            if (targets.length > 0) {
                msg.id = [];
                for (var i = 0; i < targets.length; i++) {
                    msg.id.push(targets[i].id);
                }
                Tools.drawAndSend(msg);
            }
        }
    }

    function erase(x, y, evt) {
        if (makeRect) {
            rect['x2'] = x;
            rect['y2'] = y;
            if (performance.now() - lastTime > 20 || end) {
                var shape = svg.getElementById("erase-rect");
                shape.x.baseVal.value = Math.min(rect['x2'], rect['x']);
                shape.y.baseVal.value = Math.min(rect['y2'], rect['y']);
                shape.width.baseVal.value = Math.abs(rect['x2'] - rect['x']);
                shape.height.baseVal.value = Math.abs(rect['y2'] - rect['y']);
                var scale;
                if ((scale = Tools.getScale()) !== oldScale) {
                    oldScale = scale;
                    textElem.setAttribute("font-size", 32/scale);
                    shape.setAttribute("stroke-width",1/Tools.getScale());
                }
                var text_bbox = textElem.getBBox();
                if (shape.width.baseVal.value > text_bbox.width * 1.5 && shape.height.baseVal.value > text_bbox.height * 1.5) {
                    textElem.setAttribute("x", shape.x.baseVal.value + (shape.width.baseVal.value - text_bbox.width) / 2);
                    textElem.setAttribute("y", shape.y.baseVal.value + shape.height.baseVal.value / 2 + text_bbox.height / 4);
                    textElem.style.visibility = "visible";
                } else {
                    textElem.setAttribute("x", -1000);
                    textElem.setAttribute("y", 100);
                    textElem.style.visibility = "hidden";
                }
                lastTime = performance.now();
            }
            if (evt) evt.preventDefault();
        }
    }

    function draw (data) {
        var elem;
        switch (data.type) {
            //TODO: add the ability to erase only some points in a line
            case "delete":
                if(Array.isArray(data.id)){
                    for(var i = 0; i<data.id.length; i++){
                        elem = svg.getElementById(data.id[i]);
                        if (elem !== null){ //console.error("Eraser: Tried to delete an element that does not exist.");
                            elem.remove();
                        }
                    }
                }else{
                    elem = svg.getElementById(data.id);
                    if (elem === null) return; //console.error("Eraser: Tried to delete an element that does not exist.");
                    elem.remove();
                }
                break;
            default:
                console.error("Eraser: 'delete' instruction with unknown type. ", data);
                break;
        }
    }

    var svg = Tools.svg;

    Tools.add({ //The new tool
        "name": "Remove in Area",
        "shortcut": "m",
        "listeners": {
            "press": startErasing,
            "move": erase,
            "release": stopErasing,
        },
        "draw": draw,
        "icon": "tools/multi-eraser/icon.svg",
        "mouseCursor": "crosshair",
    });

})(); //End of code isolation
