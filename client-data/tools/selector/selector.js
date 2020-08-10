(function selector() {
    var selectedEl = null;

    function unSelect() {
        if (selectedEl) {
            selectedEl.classList.remove('selectedEl');
            selectedEl = null;
            console.log('Выделение сброшено!');
        }
    }

    function press(x, y, evt, isTouchEvent) {
        unSelect();
        if (!evt.target || !Tools.drawingArea.contains(evt.target)) return;
        console.log('Выбран элемент в id: ' + evt.target.id);
        selectedEl = evt.target;
        selectedEl.classList.add('selectedEl');
    }

    function draw(data) {
        console.log('draw', data);
    }

    var selectorTool = { //The new tool
        "name": "Selector",
        "shortcut": "l",
        "listeners": {
            "press": press,
        },
        "onquit": unSelect,
        "draw": draw,
        "icon": "tools/selector/selector.svg",
        "showMarker": true,
    };
    Tools.add(selectorTool);
})();