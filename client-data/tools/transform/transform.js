(function () {
    var transformTool = null;
    var transformEl = null;
    var messageForUndo = null;
    const propertiesForSend = ['x', 'width', 'height', 'y', 'transform', 'x1', 'y1', 'x2', 'y2', 'd', 'rx', 'cx', 'ry', 'cy'];

    function press(x, y, evt) {
        if (!evt.target || !Tools.drawingArea.contains(evt.target)) {
            if (transformEl) {
                transformTool[0].disable();
                transformEl = null;
            }
            return;
        }
        if (transformEl && evt.target.id !== transformEl.id) {
            transformTool[0].disable();
            transformEl = null;
        }
        if (transformEl === null) {
            selectElement(evt.target);
        }
    }

    function selectElement(el) {
        transformEl = el;
        transformTool = subjx(el).drag({
            container: Tools.svg,
            snap: {
                x: 1,
                y: 1,
                angle: 1
            },
            onInit: function (el) {
                this.storage._elementId = el.id;
                this.storage.last_sent = performance.now();
                messageForUndo = { type: "update", id: transformEl.id, properties: [] };
                for (var i = 0; i < propertiesForSend.length; i++) {
                    if (transformEl.hasAttribute(propertiesForSend[i])) {
                        messageForUndo.properties.push([propertiesForSend[i], transformEl.getAttribute(propertiesForSend[i])]);
                    }
                }
                Tools.addActionToHistory(messageForUndo);
            },
            onMove: function () {
                if (performance.now() - this.storage.last_sent > 20) {
                    this.storage.last_sent = performance.now();
                    var msg = { type: "update", _children: [], id: transformEl.id, properties: [] };
                    for (var i = 0; i < propertiesForSend.length; i++) {
                        if (transformEl.hasAttribute(propertiesForSend[i])) {
                            msg.properties.push([propertiesForSend[i], transformEl.getAttribute(propertiesForSend[i])]);
                        }
                    }
                    Tools.send(msg);
                }
            },
        });
    }

    function release() {
        if (transformEl) {
            var msg = { type: "update", id: transformEl.id, properties: [] };
            for (var i = 0; i < propertiesForSend.length; i++) {
                if (transformEl.hasAttribute(propertiesForSend[i])) {
                    msg.properties.push([propertiesForSend[i], transformEl.getAttribute(propertiesForSend[i])]);
                }
            }
            Tools.send(msg);
        }
    }

    function selectObject() {
        console.log('select');
    }

    function onStart() {
        document.addEventListener('keydown', enableProportions);
        document.addEventListener('keyup', enableProportions);
    }

    function enableProportions(evt) {
        transformTool[0].options.proportions = evt.ctrlKey && transformEl;
    }

    function onQuit() {
        if (transformEl) {
            transformTool[0].disable();
        }
        document.removeEventListener('keydown', enableProportions);
        document.removeEventListener('keyup', enableProportions);
    }

    function draw(data) {
        switch (data.type) {
            case "update":
                const el = document.getElementById(data.id);
                for (var i = 0; i < data.properties.length; i++) {
                    el.setAttribute(data.properties[i][0] ,data.properties[i][1]);
                }
                if (transformEl) transformTool[0].fitControlsToSize();
                break;
            default:
                throw new Error("Mover: 'mover' instruction with unknown type. ", data);
        }
    }

    Tools.add({ //The new tool
        "name": "Transform",
        "shortcut": "v",
        "listeners": {
            "press": press,
            "release": release,
        },
        "selectObject": selectObject,
        "onstart": onStart,
        "onquit": onQuit,
        "draw": draw,
        "icon": "tools/selectorAndMover/selectorAndMover.svg",
        "mouseCursor": "move",
        "showMarker": true,
    });
})();