// This isn't an HTML5 canvas, it's an old svg hack, (the code is _that_ old!)
const fakeCanvas = document.getElementById("canvas");
const uid = Tools.generateUID("b"); // b for background

function onstart() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];

        Tools.drawAndSend({
            id: uid,
            data: file,
            fileType: file.type
        }, "Background");
        Tools.change(Tools.prevToolName);
    });

    fileInput.click();
}

function draw(msg, self) {
    const file = self ? msg.data : new Blob([msg.data], { type: msg.fileType });
    const fileURL = URL.createObjectURL(file);

    fakeCanvas.style.background = `url("${fileURL}") 170px 0px no-repeat`;
}

Tools.add({
    "name": "Background",
    "icon": "🖼️",
    "shortcut": "b",
    "draw": draw,
    "onstart": onstart
});
