(function mover() {
    var selected = null;
    var last_sent = 0;

    function startMovingElement(x, y, evt) {
        //Prevent the press from being interpreted by the browser
        evt.preventDefault();
        if (!evt.target || !Tools.drawingArea.contains(evt.target)) return;
        var tmatrix = get_translate_matrix(evt.target);
        selected = { x: x - tmatrix.e, y: y - tmatrix.f, elem: evt.target };
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
        if (now - last_sent > 70) {
            last_sent = now;
            Tools.drawAndSend(msg);
        } else {
            draw(msg);
        }
    }

    function release(x, y, evt, isTouchEvent) {
        move(x, y, evt, isTouchEvent);
        selected = null;
    }

    function switchTool() {
        selected = null;
    }

    function press(x, y, evt, isTouchEvent) {
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

    var moverTool = { //The new tool
        "name": "Mover",
        "shortcut": "p",
        "listeners": {
            "press": press,
            "move": move,
            "release": release,
        },
        "onquit": switchTool,
        "draw": draw,
        "icon": "tools/mover/mover.svg",
        "mouseCursor": "move",
        "showMarker": true,
    };
    Tools.add(moverTool);
})();