(function mover() {
    var selected = null;
    var selectedEl = null;
    var last_sent = 0;
    var start_x = 0;
    var start_y = 0;
    const panel = document.getElementById('object-panel');
    function startMovingElement(x, y, evt) {
        //Prevent the press from being interpreted by the browser
        evt.preventDefault();
        var tmatrix = get_translate_matrix(evt.target);
        start_x = tmatrix.e;
        start_y = tmatrix.f;
        selected = { x: x - tmatrix.e, y: y - tmatrix.f, elem: evt.target };
    }

    function actionsForEvent(evt) {
        if (evt.keyCode === 46 || evt.keyCode === 8) { // Delete key
            deleteElement();
        }
    }

    function deleteElement() {
        Tools.drawAndSend({
            "type": "delete",
            "id": selectedEl.id,
            "sendBack": true,
        }, Tools.list.Eraser);
        Tools.change("Hand");
    }

    function dublicateObject() {
        Tools.send({
           "type": "dublicate",
           "id": selectedEl.id,
        });
    }

    function onstart() {
        document.addEventListener('keydown', actionsForEvent);
        document.getElementById('object-delete').addEventListener('click', deleteElement);
        document.getElementById('object-dublicate').addEventListener('click', dublicateObject);
    }

    function get_translate_matrix(elem) {
        // Returns the first translate or transform matrix or makes one
        var translate = null;
        for (var i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
            var baseVal = elem.transform.baseVal[i];
            // quick tests showed that even if one changes only the fields e and f or uses createSVGTransformFromMatrix
            // the brower may add a SVG_TRANSFORM_MATRIX instead of a SVG_TRANSFORM_TRANSLATE
            if (baseVal.type === SVGTransform.SVG_TRANSFORM_TRANSLATE || baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
                translate = baseVal;
                break;
            }
        }
        if (translate == null) {
            translate = elem.transform.baseVal.createSVGTransformFromMatrix(Tools.svg.createSVGMatrix());
            elem.transform.baseVal.appendItem(translate);
        }
        return translate.matrix;
    }

    function move(x, y, evt, isTouchEvent) {
        moveElement(x, y, evt, isTouchEvent);
    }

    function moveElement(x, y) {
        if (!selected) return;
        var deltax = x - selected.x;
        var deltay = y - selected.y;
        var msg = { type: "update", id: selected.elem.id, deltax: deltax, deltay: deltay };
        var now = performance.now();
        if (now - last_sent > 20) {
            last_sent = now;
            Tools.drawAndSend(msg);
        } else {
            draw(msg);
        }
    }

    function release(x, y, evt, isTouchEvent) {
        if (selected) {
            move(x, y, evt, isTouchEvent);
            const matrix = get_translate_matrix(selectedEl);
            if ((matrix.e !== start_x || matrix.f !== start_y) && selected) {
                Tools.addActionToHistory({ type: "update", id: selected.elem.id, deltax: start_x, deltay: start_y });
            }
            selected = null;
        }
    }

    function switchTool() {
        selected = null;
        unSelect();
        document.removeEventListener('keydown', actionsForEvent);
        document.getElementById('object-delete').removeEventListener('click', deleteElement);
        panel.classList.add('hide');
    }

    function unSelect() {
        if (selectedEl) {
            selectedEl.classList.remove('selectedEl');
            selectedEl = null;
            panel.classList.add('hide');
        }
    }

    function selectObject(id) {
        unSelect();
        selectedEl = document.getElementById(id);
        selectedEl.classList.add('selectedEl');
        panel.classList.remove('hide');
    }

    function press(x, y, evt, isTouchEvent) {
        unSelect();
        if (!evt.target || !Tools.drawingArea.contains(evt.target)) return;
        selectObject(evt.target.id);
        startMovingElement(x, y, evt, isTouchEvent);
    }

    function draw(data) {
        switch (data.type) {
            case "update":
                var elem = Tools.svg.getElementById(data.id);
                if (!elem) throw new Error("Mover: Tried to mover an element that does not exist.");
                var tmatrix = get_translate_matrix(elem);
                tmatrix.e = data.deltax || 0;
                tmatrix.f = data.deltay || 0;
                break;
            default:
                throw new Error("Mover: 'mover' instruction with unknown type. ", data);
        }
    }

    Tools.add({ //The new tool
        "name": "SelectorAndMover",
        "shortcut": "v",
        "listeners": {
            "press": press,
            "move": move,
            "release": release,
        },
        "selectObject": selectObject,
        "onstart": onstart,
        "onquit": switchTool,
        "draw": draw,
        "icon": "tools/selectorAndMover/selectorAndMover.svg",
        "mouseCursor": "move",
        "showMarker": true,
    });
})();