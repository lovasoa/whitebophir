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
(function selector() { //Code isolation

    var dragging = false;
    let select = new Map();
    var oldX = 0;
    var oldY = 0;

    var svg = Tools.svg;

    function pressed(x, y, evt) {
        //Prevent the press from being interpreted by the browser
        evt.preventDefault();
        dragging = true;
        var target = evt.target;
        if (evt.type === "touchmove") {
            // ... the target of touchmove events is the element that was initially touched,
            // not the one **currently** being touched
            var touch = evt.touches[0];
            target = document.elementFromPoint(touch.clientX, touch.clientY);
        }
        if (target !== Tools.svg) {
            //target.setAttribute("stroke", "#00FF00");
            //target.setAttribute("stroke-dasharray", "5.5");
            var object = svg.getElementById(target.id);
            select.set(target.id, object);
        }
        oldX = x;
        oldY = y;
        move(x, y, evt);
    }
    function getPositionOfSvgElement(v) {
        var x;
        var y;
        switch (v.tagName) {
            case "line":
                x = v.x1.baseVal.value;
                y = v.y2.baseVal.value;
                break;
            case "rect":
                x = v.x.baseVal.value;
                y = v.y.baseVal.value;
                break;
            case "text":
                x = v.x.baseVal[0].value;
                y = v.y.baseVal[0].value;
                break;
            case "path":
                break;
            default:
                console.log("Move not implemented for this object type: " + v.type);
                break;
        }
        return [x, y];
    }

    function translateSvgElement(v, difX, difY) {
        switch (v.tagName) {
            case "line":
                v.x1.baseVal.value += difX;
                v.y1.baseVal.value += difY;
                v.x2.baseVal.value += difX;
                v.y2.baseVal.value += difY;
                break;
            case "rect":
                v.x.baseVal.value += difX;
                v.y.baseVal.value += difY;
                break;
            case "text":
                v.x.baseVal[0].value += difX;
                v.y.baseVal[0].value += difY;
                break;
            case "path":
                break;
            default:
                console.log("Move not implemented for this object type: " + v.type);
                break;
        }
    }


    const msg = {
        "type": "modify",
        "id": "",
        'x': 0,
        'y': 0
    };
    function move(x, y, evt) {
        const difX = x - oldX;
        const difY = y - oldY;
        for (let [k, v] of select) {
            msg.id = k;
            msg.x = difX;
            msg.y = difY;
            translateSvgElement(v, difX, difY);
            Tools.drawAndSend(msg);
        }
        oldX = x;
        oldY = y;
    }

    function released() {
        dragging = false;
        select.clear();
    }

    function draw(data) {
        // no need to draw
    }

    Tools.add({ //The new tool
        "name": "Selector",
        "icon": "↖",
        "shortcut": "s",
        "listeners": {
            "press": pressed,
            "move": move,
            "release": released,
        },
        "draw": draw,
        "mouseCursor": "auto",
    });

})(); //End of code isolation
