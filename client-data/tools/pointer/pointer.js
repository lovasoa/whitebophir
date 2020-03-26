const uid = Tools.generateUID("f"); // f for finger
let lastTime = performance.now();

const pointer = document.createElement("div");
pointer.classList.add("pointer");
pointer.innerHTML = "👆";

Tools.board.appendChild(pointer);

function movePointer(x, y) {
    pointer.style.left = `${x * Tools.scale}px`;
    pointer.style.top = `${y * Tools.scale}px`;

    // TODO: Could find a better solution for JIP
    if (!pointer.classList.contains("visible")) {
        showPointer(true, false);
    }
}

function move(x, y) {
    movePointer(x, y);

    if (performance.now() - lastTime > 70) {
        Tools.send({
            id: uid,
            type: "update",
            action: "move",
            x,
            y
        }, "Pointer");
        lastTime = performance.now();
    }
}

function draw(msg) {
    switch (msg.action) {
        case "move":
            movePointer(msg.x, msg.y);
            break;
        case "show":
            showPointer(true, false);
            break;
        case "hide":
            showPointer(false, false);
            break;
        case "highlight":
            highlightPointer(true, false);
            break;
        case "noHighlight":
            highlightPointer(false, false);
            break;
    }
}

function highlightPointer(highlight, self) {
    pointer.classList.toggle("highlight", highlight);

    if (self) {
        Tools.send({
            id: uid,
            type: "update",
            action: highlight ? "highlight" : "noHighlight"
        }, "Pointer");
    }
}

function showPointer(show, self) {
    pointer.classList.toggle("visible", show);

    if (self) {
        Tools.send({
            id: uid,
            type: "update",
            action: show ? "show" : "hide"
        }, "Pointer");
    }
}

Tools.add({
    "name": "Pointer",
    "icon": "👆",
    "shortcut": "f",
    "listeners": {
        "press": () => highlightPointer(true, true),
        "move": move,
        "release": () => highlightPointer(false, true)
    },
    "draw": draw,
    "onstart": () => showPointer(true, true),
    "onquit": () => showPointer(false, true),
    "mouseCursor": "none",
    "stylesheet": "tools/pointer/pointer.css"
});
