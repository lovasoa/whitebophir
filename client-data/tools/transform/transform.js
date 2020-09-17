(function () {
    var transformTool = null;
    var transformEl = null;
    var messageForUndo = null;
    var lastSend = performance.now();
    const panel = document.getElementById('object-panel');
    const transformToolEl = document.getElementById('transform-tool');
    var sendingInverval = null;
    var index = 0;
    const propertiesForSend = ['x', 'width', 'height', 'y', 'transform', 'x1', 'y1', 'x2', 'y2', 'd', 'rx', 'cx', 'ry', 'cy'];

    function press(x, y, evt) {
        if (!evt.target || !Tools.drawingArea.contains(evt.target)) {
            if (transformEl) {
                transformTool[0].disable();
                Tools.send({type: "update", unSelectElement: transformEl.id}, "Cursor");
                transformEl = null;
                panel.classList.add('hide');
            }
            return;
        }
        if (transformEl && evt.target.id !== transformEl.id) {
            transformTool[0].disable();
            Tools.send({type: "update", unSelectElement: transformEl.id}, "Cursor");
            transformEl = null;
            panel.classList.add('hide');
        }
        if (transformEl === null && !evt.target.classList.contains('selectedEl')) {
            selectElement(evt.target);
        }
    }

    function actionsForEvent(evt) {
        if (evt.keyCode === 46 || evt.keyCode === 8) { // Delete key
            deleteElement();
        }
    }

    function deleteElement() {
        Tools.drawAndSend({
            "type": "delete",
            "id": transformEl.id,
            "sendBack": true,
        }, Tools.list.Eraser);
        Tools.change("Hand");
        Tools.change("Transform");
    }

    function selectElement(el, offset) {
        if (transformEl) {
            transformTool[0].disable();
        }
        panel.classList.remove('hide');
        transformEl = el;
        transformTool = subjx(el).drag({
            container: Tools.svg,
            snap: {
                x: 1,
                y: 1,
                angle: 1
            },
            onInit: function () {
                messageForUndo = createMessage();
            },
            onMove: createAndSendMessage,
            onRotate: createAndSendMessage,
            onResize: createAndSendMessage,
            onDrop: function () {
                if (transformEl) {
                    var msg = createMessage();
                    if (JSON.stringify(msg) !== JSON.stringify(messageForUndo)) {
                        Tools.addActionToHistory(messageForUndo);
                        setTimeout(function () {
                            messageForUndo = createMessage();
                        }, 100);
                        createAndSendMessage();
                    }
                }
            },
        });
        if (offset) {
            transformTool[0].exeDrag({dx: offset.dx, dy: offset.dy});
            messageForUndo = createMessage();
            Tools.drawAndSend(createMessage());
        }
        Tools.send({type: "update", selectElement: transformEl.id}, "Cursor");
    }

    function createAndSendMessage() {
        if (performance.now() - lastSend > 20) {
            lastSend = performance.now();
            Tools.send(createMessage());
        }
    }

    function createMessage() {
        var msg = { type: "update", _children: [], id: transformEl.id, properties: [] };
        for (var i = 0; i < propertiesForSend.length; i++) {
            if (transformEl.hasAttribute(propertiesForSend[i])) {
                msg.properties.push([propertiesForSend[i], transformEl.getAttribute(propertiesForSend[i])]);
            }
        }
        return msg;
    }

    function onStart() {
        document.addEventListener('keydown', enableProportions);
        document.addEventListener('keyup', enableProportions);
        document.addEventListener('keydown', actionsForEvent);
        document.getElementById('object-delete').addEventListener('click', deleteElement);
        document.getElementById('object-dublicate').addEventListener('click', dublicateObject);
        sendingInverval = setInterval(sendInInterval, 1000);
    }

    function sendInInterval () {
        if (transformEl && transformEl.id) Tools.send({type: "update", selectElement: transformEl.id}, "Cursor");
    }

    function enableProportions(evt) {
        transformTool[0].options.proportions = evt.shiftKey && transformEl;
    }

    function dublicateObject() {
        Tools.send({
            "type": "dublicate",
            "id": transformEl.id,
        });
    }

    function onQuit() {
        if (transformEl) {
            transformTool[0].disable();
            Tools.send({type: "update", unSelectElement: transformEl.id}, "Cursor");
        }
        document.removeEventListener('keydown', enableProportions);
        document.removeEventListener('keyup', enableProportions);
        document.removeEventListener('keydown', actionsForEvent);
        document.getElementById('object-delete').removeEventListener('click', deleteElement);
        panel.classList.add('hide');
        clearInterval(sendingInverval);
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

    function checkAndDisable(id) {
        if (transformEl && transformEl.id === id) transformTool[0].disable();
    }

    Tools.add({ //The new tool
        "name": "Transform",
        "shortcut": "v",
        "listeners": {
            "press": press,
        },
        "selectElement": selectElement,
        "checkAndDisable": checkAndDisable, // Проверить если элемент удалили, то прекратить выделение и убрать панель
        "onstart": onStart,
        "onquit": onQuit,
        "draw": draw,
        "mouseCursor": "move",
        "showMarker": true,
    });
})();