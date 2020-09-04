
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

(function transform() { //Code isolation

    var img1 = '<svg id="_x31__x2C_5" enable-background="new 0 0 24 24" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><g><path d="m5.25 6h-4.5c-.414 0-.75-.336-.75-.75v-4.5c0-.414.336-.75.75-.75h4.5c.414 0 .75.336.75.75v4.5c0 .414-.336.75-.75.75zm-3.75-1.5h3v-3h-3z"/></g><g><path d="m23.25 6h-4.5c-.414 0-.75-.336-.75-.75v-4.5c0-.414.336-.75.75-.75h4.5c.414 0 .75.336.75.75v4.5c0 .414-.336.75-.75.75zm-3.75-1.5h3v-3h-3z"/></g><g><path d="m5.25 24h-4.5c-.414 0-.75-.336-.75-.75v-4.5c0-.414.336-.75.75-.75h4.5c.414 0 .75.336.75.75v4.5c0 .414-.336.75-.75.75zm-3.75-1.5h3v-3h-3z"/></g><g><path d="m23.25 24h-4.5c-.414 0-.75-.336-.75-.75v-4.5c0-.414.336-.75.75-.75h4.5c.414 0 .75.336.75.75v4.5c0 .414-.336.75-.75.75zm-3.75-1.5h3v-3h-3z"/></g><g><path d="m21.25 19.5c-.414 0-.75-.336-.75-.75v-13.5c0-.414.336-.75.75-.75s.75.336.75.75v13.5c0 .414-.336.75-.75.75z"/></g><g><path d="m2.75 19.5c-.414 0-.75-.336-.75-.75v-13.5c0-.414.336-.75.75-.75s.75.336.75.75v13.5c0 .414-.336.75-.75.75z"/></g><g><path d="m18.75 22h-13.5c-.414 0-.75-.336-.75-.75s.336-.75.75-.75h13.5c.414 0 .75.336.75.75s-.336.75-.75.75z"/></g><g><path d="m18.75 3.5h-13.5c-.414 0-.75-.336-.75-.75s.336-.75.75-.75h13.5c.414 0 .75.336.75.75s-.336.75-.75.75z"/></g></svg>';
    var img2 = '<svg id="Layer1" enable-background="new 0 0 512 512" height="24" viewBox="0 0 512 512" width="24" xmlns="http://www.w3.org/2000/svg" ><g><path d="m30 30h25.21v-30h-55.21v55.211h30z"/><path d="m0 91.357h30v55.211h-30z"/><path d="m0 182.716h30v55.211h-30z"/><path d="m365.432 0h55.21v30h-55.21z"/><path d="m274.074 0h55.21v30h-55.21z"/><path d="m182.716 0h55.21v30h-55.21z"/><path d="m91.358 0h55.21v30h-55.21z"/><path d="m456.79 0v30h25.21v25.211h30v-55.211z"/><path d="m482 91.357h30v55.211h-30z"/><path d="m482 182.716h30v55.211h-30z"/><path d="m482 274.073h30v55.211h-30z"/><path d="m482 365.432h30v55.211h-30z"/><path d="m482 482h-25.21v30h55.21v-55.211h-30z"/><path d="m365.432 482h55.21v30h-55.21z"/><path d="m274.074 482h55.21v30h-55.21z"/><path d="m0 512h237.926v-237.926h-237.926zm30-207.926h177.926v177.926h-177.926z"/><path d="m359.963 115.934h14.89l-80.528 80.528v-14.89h-30v66.103h66.103v-30h-14.89l80.528-80.529v14.891h30v-66.103h-66.103z"/></g></svg>';
    var transforming = false;
    var currShape = null;
    var curTool = "single";
    var icons = ["<span style='margin-top:-4px;opacity:.5;background-color:#fff'>" + `<img draggable="false" src='data:image/svg+xml;utf8,` + img1 + `' >` + "</span>", "<span style='margin-top:-4px;opacity:.5;background-color:#fff'>" + `<img draggable="false" src='data:image/svg+xml;utf8,` + img2 + `' >` + "</span>"];
    var end = false;
    var lastTime = performance.now(); //The time at which the last point was drawn
    var makeRect = false;
    var lastX = 0;
    var lastY = 0;
    var msgIds = null;
    var gid;

    var rect = {
        x: 0,
        y: 0,
        x2: 0,
        y2: 0
    };

    function onQuit() {
        if (wb_comp.list["Measurement"]) {
            wb_comp.list["Measurement"].resize("small")
        }
        deactivateCurrentShape();
    };

    function start(x, y, evt) {
        //Prevent the press from being interpreted by the browser
        evt.preventDefault();
        // evt.target should be the element over which the mouse is...
        var target = evt.target;
        if (evt.type.startsWith("touch")) D2isTouch = true;
        if (evt.type === "touchmove") {
            // ... the target of touchmove events is the element that was initially touched,
            // not the one **currently** being touched
            var touch = evt.touches[0];
            target = document.elementFromPoint(touch.clientX, touch.clientY);
        }
        initialize(target);
    }

    function move(x, y, evt) {
        /*Wait 20ms before adding any point to the currently drawing shape.
        This allows the animation to be smother*/
        if (curTool == "multi") {
            if (makeRect) {
                rect['x2'] = x;
                rect['y2'] = y;
                if (performance.now() - lastTime > 20 || end) {
                    var shape = svg.getElementById("transform-rect");
                    shape.x.baseVal.value = Math.min(rect['x2'], rect['x']);
                    shape.y.baseVal.value = Math.min(rect['y2'], rect['y']);
                    shape.width.baseVal.value = Math.abs(rect['x2'] - rect['x']);
                    shape.height.baseVal.value = Math.abs(rect['y2'] - rect['y']);
                    lastTime = performance.now();
                }
            }
        }
        if (evt) evt.preventDefault();
        lastX = x;
        lastY = y;
    }

    function stop(x, y, evt) {
        //Add a last point to the shape
        evt.preventDefault();
        if (curTool == "multi") {
            if (makeRect) {
                end = true;
                move(x, y);
                end = false;
                var shape = svg.getElementById("transform-rect");
                shape.remove();
                makeRect = false;
                var targets = [];
                var rects = []
                var rx = rect.x * Tools.scale - document.documentElement.scrollLeft;
                var rx2 = rect.x2 * Tools.scale - document.documentElement.scrollLeft;
                var ry = rect.y * Tools.scale - document.documentElement.scrollTop;
                var ry2 = rect.y2 * Tools.scale - document.documentElement.scrollTop;
                $("#layer-" + Tools.layer).find("*").each(
                    function (i, el) {
                        var r = el.getBoundingClientRect();
                        if (insideRect(r.x, r.y, r.width, r.height, rx, ry, rx2, ry2)) {
                            var r2 = {};
                            var m;
                            var transform = el.getAttributeNS(null, "transform");
                            if (transform) {
                                var t = transform.substr(7, transform.length - 2).split(/[\s,]+/);
                                m = [[parseFloat(t[0]), parseFloat(t[2]), parseFloat(t[4])], [parseFloat(t[1]), parseFloat(t[3]), parseFloat(t[5])], [0, 0, 1]]
                            } else {
                                m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
                            }

                            if (Tools.getMarkerBoundingRect(el, r2, m)) {
                                if (insideRect(r2.x, r2.y, r2.width, r2.height, rx, ry, rx2, ry2)) {
                                    Tools.composeRects(r, r2);
                                    targets.push(el);
                                    Tools.adjustBox(el, r, m);
                                    rects.push(r);
                                }
                            } else {
                                targets.push(el);
                                Tools.adjustBox(el, r, m);
                                rects.push(r);
                            }
                        }
                    }
                );
                if (targets.length > 0) {
                    var x = 0, y = 0, x2 = 0, y2 = 0;
                    for (var i = 0; i < rects.length; i++) {
                        var r = rects[i];
                        if (i == 0) {
                            x = r.x;
                            y = r.y;
                            x2 = r.x + r.width;
                            y2 = r.y + r.height;
                        }

                        x = Math.min(x, r.x);
                        y = Math.min(y, r.y);
                        x2 = Math.max(x2, r.x + r.width);
                        y2 = Math.max(y2, r.y + r.height);
                    }

                    initialize(targets, {x: x, y: y, x2: x2, y2: y2})
                }
            }
        }
        if (transforming) {
            end = true;
            continueTransforming(currShape);
            end = false;
            transforming = false;
        }
        Tools.suppressPointerMsg = false;
    }

    function insideRect(x, y, w, h, rx, ry, rx2, ry2) {
        //console.log(x+' ' + y+ ' ' + w+ ' '+h)
        //console.log(rx+' ' + ry+ ' ' + rx2+ ' '+ry2)
        if (rx <= x && ry <= y) {
            if (rx2 >= x + w && ry2 >= y + h) {
                if (rx2 > rx && ry2 > ry) {
                    return true;
                }
            }
        }
        return false;
    }

    function continueTransforming(shape) {
        if (performance.now() - lastTime > 70 || end) {
            if (!transforming) gid = Tools.generateUID("tr"); //tr" for transform
            transforming = true;
            Tools.suppressPointerMsg = true;
            if (shape) {
                var msg = {
                    "type": "update",
                    "id": msgIds,
                    "gid": gid,
                    "undo": true
                };
                if (Tools.showMyPointer) {
                    msg.tx = lastX;
                    msg.ty = lastY;
                }
                if (Array.isArray(shape.matrix)) {
                    msg.updates = [];
                    for (var i = 0; i < shape.matrix.length; i++) {
                        msg.updates[i] = {transform: shape.matrix[i]};
                    }
                    if (wb_comp.list["Measurement"]) {
                        wb_comp.list["Measurement"].updateTransform(shape)
                    }
                } else {
                    msg.transform = shape.matrix;
                    if (wb_comp.list["Measurement"]) {
                        wb_comp.list["Measurement"].updateTransform()
                    }
                }

                Tools.drawAndSend(msg);
            }
            lastTime = performance.now();
        }

    };


    function draw(data) {
        //console.log(JSON.stringify(data));
        switch (data.type) {
            //TODO: add the ability to erase only some points in a line
            case "update":
                if (Array.isArray(data.id)) {
                    for (var i = 0; i < data.id.length; i++) {
                        var elem = svg.getElementById(data.id[i]);
                        //check if top layer
                        if (Tools.useLayers) {
                            if (elem.getAttribute("class") != "layer" + Tools.layer) {
                                elem.setAttribute("class", "layer-" + Tools.layer);
                                Tools.group.appendChild(elem);
                            }
                        }
                        var idSelected = false;
                        if (currShape) {
                            if (Array.isArray(currShape)) {
                                idSelected = arrayContains(currShape.id, data.id[i])
                            } else {
                                idSelected = (currShape.id == data.id[i]);
                            }
                        }
                        if (!(transforming && idSelected || elem === null)) { //console.error("Eraser: Tried to delete an element that does not exist.");
                            if (idSelected) deactivateCurrentShape();
                            //console.log(data.transform);
                            Tools.drawingEvent = true;
                            elem.setAttribute("transform", data.updates[i].transform);
                        }
                    }
                } else {
                    var elem = svg.getElementById(data.id);
                    if (data.transform) {
                        //check if top layer
                        if (Tools.useLayers) {
                            if (elem.getAttribute("class") != "layer" + Tools.layer) {
                                elem.setAttribute("class", "layer-" + Tools.layer);
                                Tools.group.appendChild(elem);
                            }
                        }
                        var idSelected = false;
                        if (currShape) {
                            if (Array.isArray(currShape)) {
                                idSelected = arrayContains(currShape.id, data.id)
                            } else {
                                idSelected = (currShape.id == data.id);
                            }
                        }
                        if (transforming && idSelected || elem === null) return; //console.error("Eraser: Tried to delete an element that does not exist.");
                        if (idSelected) deactivateCurrentShape();
                        //console.log(data.transform);
                        Tools.drawingEvent = true;
                        elem.setAttribute("transform", data.transform);
                    }
                    if (data.data !== undefined) {
                        if (elem === null) return; //console.error("Tried to update an element that does not exist.");
                        elem.setAttribute("data-lock", data.data);
                        if (lockOpen && currShape.id == data.id) showLock(data.data)
                    }
                }
                break;
            default:
                console.error("Eraser: 'delete' instruction with unknown type. ", data);
                break;
        }
    }

    function initialize(target, rect) {
        var shape;
        if (Array.isArray(target)) {
            shape = new Transform(target, rect);
            msgIds = [];
            shape.id = [];
            for (var i = 0; i < target.length; i++) {
                msgIds.push(target[i].id);
                shape.id.push(target[i].id);
            }
            ;
            if (wb_comp.list["Measurement"]) {
                wb_comp.list["Measurement"].init(
                    "group",
                    null,
                    shape
                )
            }
        } else {
            switch (target.localName) {
                case "circle":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "ellipse":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "polyline":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "text":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "image":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "line":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "path":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "polygon":
                    shape = new Transform(target, null, hideLock);
                    break;
                case "rect":
                    shape = new Transform(target, null, hideLock);
                    break;
                default:
                // do nothing for now
            }

            if (shape != null) {
                msgIds = shape.id = target.id;
                if (wb_comp.list["Measurement"]) {
                    wb_comp.list["Measurement"].init(
                        target.localName,
                        target
                    )
                }
            }
        }
        if (shape != null) {
            shape.realize();
            shape.callback = continueTransforming;
            deactivateCurrentShape();
            mouser.registerShape(shape);
            shape.showHandles(true);
            shape.selectHandles(false);
            currShape = shape;
            if (!Array.isArray(target)) {
                var locked = target.getAttribute("data-lock");
                showLock(locked == 1);
            }
        }
    };

    deactivateCurrentShape = function () {
        if (currShape) {
            hideLock();
            mouser.unregisterShapes();
            currShape.unrealize();
            currShape = null;
        }
    };

    var lockOpen = false;

    //Show lock
    function showLock(locked) {
        lockOpen = true;
        var elem = document.getElementById("shape-lock");
        elem.style.display = "block";
        if (locked) {
            elem.classList.add("locked");
            document.getElementById("shape-lock-icon").setAttribute("class", "fas fa-lock");
        } else {
            elem.classList.remove("locked");
            document.getElementById("shape-lock-icon").setAttribute("class", "fas fa-unlock");
        }
    };

    //Hide lock
    function hideLock() {
        lockOpen = false;
        document.getElementById("shape-lock").style.display = "none";
    };

    var svg = Tools.svg;

    function toggle(elem) {
        var index = 0;
        curTool == "single"
    };

    Tools.add({ //The new tool
        "name": "Transform",
        "icon": "?",
        "iconHTML": icons[0],
        "toggle": toggle,
        "shortcuts": {
            "changeTool": "6"
        },
        "listeners": {
            "press": start,
            "move": move,
            "release": stop,
        },
        "draw": draw,
        "onquit": onQuit,
        "mouseCursor": "crosshair",
    });
})();