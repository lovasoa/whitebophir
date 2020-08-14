(function () {

    function clear() {
        const needClear = confirm('Вы уверены, что хотите очистить всю доску? Это нельзя отменить.');
        if (needClear) {
            Tools.drawAndSend({
                'type': 'clearBoard',
            });
        }
        Tools.change("Hand");
    }

    function draw() {
        Tools.drawingArea.innerHTML = '';
    }

    var clearBoard = {
        "name": "clearBoard",
        "icon": "tools/clearBoard/clearBoard.svg",
        "draw": draw,
        "shortcut": "/",
        "onstart": clear,
    };

    Tools.add(clearBoard);
})();