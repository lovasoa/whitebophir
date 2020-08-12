(function () {

    function clear() {
        const needClear = confirm('Вы уверены, что хотите очистить всю доску? Это нельзя отменить.');
        if (needClear) {
            for (let i = 0; i < Tools.drawingArea.children.length; i++) {
                console.log(Tools.drawingArea.children[i].id);
                // Возможно лучше реализовать через отдельный запрос
            }
        }
        Tools.change("Hand");
    }

    var clearBoard = {
        "name": "clearBoard",
        "icon": "tools/clearBoard/clearBoard.svg",
        "shortcut": "/",
        "onstart": clear,
    };

    Tools.add(clearBoard);
})();