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

(function () { //Code isolation
    var curUpdate = { //The data of the message that will be sent for every new point
        'type': 'update',
        'id': "",
        'x': 0,
        'y': 0,
        'x2': 0,
        'y2': 0
    },
        lastPos = { x: 0, y: 0 },
        lastTime = performance.now(); //The time at which the last point was drawn

    function start(x, y, evt) {

        //Prevent the press from being interpreted by the browser
        evt.preventDefault();

        curUpdate.id = Tools.generateUID("e"); //"e" for ellipse

        Tools.drawAndSend({
            'type': 'ellipse',
            'id': curUpdate.id,
            'color': Tools.getColor(),
            'size': Tools.getSize(),
            'opacity': Tools.getOpacity(),
            'x': x,
            'y': y,
            'x2': x,
            'y2': y
        });

        curUpdate.id = curUpdate.id;
        curUpdate.x = x;
        curUpdate.y = y;
    }

    function move(x, y, evt) {
        if (!curUpdate.id) return; // Not currently drawing
        if (evt) {
            circleTool.secondary.active = circleTool.secondary.active || evt.shiftKey;
            evt.preventDefault(); 
        }
        lastPos.x = x;
        lastPos.y = y;
        doUpdate();
    }

    function doUpdate(force) {
        if (!curUpdate.id) return; // Not currently drawing
        if (drawingCircle()) {
            var x0 = curUpdate['x'], y0 = curUpdate['y'];
            var deltaX = lastPos.x - x0, deltaY = lastPos.y - y0;
            var diameter = Math.max(Math.abs(deltaX), Math.abs(deltaY));
            curUpdate['x2'] = x0 + (deltaX > 0 ? diameter : -diameter);
            curUpdate['y2'] = y0 + (deltaY > 0 ? diameter : -diameter);
        } else {
            curUpdate['x2'] = lastPos.x;
            curUpdate['y2'] = lastPos.y;
        }

        if (performance.now() - lastTime > 70 || force) {
            Tools.drawAndSend(curUpdate);
            lastTime = performance.now();
        } else {
            draw(curUpdate);
        }
    }

    function stop(x, y) {
        lastPos.x = x;
        lastPos.y = y;
        doUpdate(true);
        curUpdate.id = "";
    }

    function draw(data) {
        Tools.drawingEvent = true;
        switch (data.type) {
            case "ellipse":
                createShape(data);
                break;
            case "update":
                var shape = svg.getElementById(data['id']);
                if (!shape) {
                    console.error("Ellipse: Hmmm... I received an update for a shape that has not been created (%s).", data['id']);
                    createShape({ //create a new shape in order not to loose the points
                        "id": data['id'],
                        "x": data['x2'],
                        "y": data['y2']
                    });
                }
                updateShape(shape, data);
                break;
            default:
                console.error("Ellipse: Draw instruction with unknown type. ", data);
                break;
        }
    }

    var svg = Tools.svg;
    function createShape(data) {
        //Creates a new shape on the canvas, or update a shape that already exists with new information
        var shape = svg.getElementById(data.id) || Tools.createSVGElement("ellipse");
        updateShape(shape, data);
        shape.id = data.id;
        //If some data is not provided, choose default value. The shape may be updated later
        shape.setAttribute("stroke", data.color || "black");
        shape.setAttribute("stroke-width", data.size || 10);
        shape.setAttribute("opacity", Math.max(0.1, Math.min(1, data.opacity)) || 1);
        Tools.drawingArea.appendChild(shape);
        return shape;
    }

    function updateShape(shape, data) {
        shape.cx.baseVal.value = Math.round((data['x2'] + data['x']) / 2);
        shape.cy.baseVal.value = Math.round((data['y2'] + data['y']) / 2);
        shape.rx.baseVal.value = Math.abs(data['x2'] - data['x']) / 2;
        shape.ry.baseVal.value = Math.abs(data['y2'] - data['y']) / 2;
    }

    function drawingCircle() {
        return circleTool.secondary.active;
    }

    var circleTool = { //The new tool
        "name": "Ellipse",
        "icon": "tools/ellipse/icon-ellipse.svg",
        "secondary": {
            "name": "Circle",
            "icon": "tools/ellipse/icon-circle.svg",
            "active": false,
            "switch": doUpdate,
        },
        "shortcut": "c",
        "listeners": {
            "press": start,
            "move": move,
            "release": stop,
        },
        "draw": draw,
        "mouseCursor": "crosshair",
        "stylesheet": "tools/ellipse/ellipse.css"
    };
    Tools.add(circleTool);

})(); //End of code isolation
