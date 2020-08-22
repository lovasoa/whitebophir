(function () {

    function clear() {
        const needClear = confirm('Вы уверены, что хотите очистить всю доску? Это нельзя отменить.');
        if (needClear) {
            Tools.drawAndSend({
                'type': 'clearBoard',
            });
        }
        Tools.historyRedo.splice(0, Tools.historyRedo.length);
        Tools.history.splice(0, Tools.history.length);
        Tools.disableToolsEl('undo');
        Tools.disableToolsEl('redo');
        Tools.change("Hand");
    }

    function draw() {
        Tools.drawingArea.innerHTML = '';
    }

    var clearBoard = {
        "name": "clearBoard",
        "icon": "tools/clearBoard/clearBoard.svg",
        "draw": draw,
        "shortcut": "m",
        "onstart": clear,
    };

    Tools.add(clearBoard);
})();