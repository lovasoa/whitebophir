(function documents() { //Code isolation
    var xlinkNS = "http://www.w3.org/1999/xlink";
    const fileTypes = ['jpeg', 'jpg', 'webp', 'png'];
    function preventDefault(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    Tools.svg.addEventListener('dragenter', preventDefault, false);
    Tools.svg.addEventListener('dragleave', preventDefault, false);
    Tools.svg.addEventListener('dragover', preventDefault, false);
    Tools.svg.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const data = e.dataTransfer;
        const file = data.files[0];
        const fileType = file.name.split('.')[file.name.split('.').length - 1].toLowerCase();

        if (fileTypes.includes(fileType)) {
            var reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = workWithImage;
        } else {
            alert('Неподдерживаемый тип изображения! Поддерживаются: ' + fileTypes.join(', '));
        }
        preventDefault(e);
    }

    function onstart() {
        var fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.multiple = false;
        fileInput.click();
        fileInput.addEventListener("change", function () {
            var reader = new FileReader();
            reader.readAsDataURL(fileInput.files[0]);
            reader.onload = workWithImage;
            // Tools.change(Tools.prevToolName);
        });
    }

    function workWithImage(e) {
        // use canvas to compress image
        var image = new Image();
        image.src = e.target.result;
        image.onload = function () {
            var uid = Tools.generateUID("doc"); // doc for document

            var ctx, size;
            var scale = 1;

            do {
                // Todo give feedback of processing effort

                ctx = document.createElement("canvas").getContext("2d");
                ctx.canvas.width = image.width * scale;
                ctx.canvas.height = image.height * scale;
                ctx.drawImage(image, 0, 0, image.width * scale, image.height * scale);
                var dataURL = ctx.canvas.toDataURL("image/webp", 0.8);

                // Compressed file size as data url, approximately 1/3 larger than as bytestream
                size = dataURL.length;

                // attempt again with an image that is at least 10% smaller
                scale = scale * Math.sqrt(Math.min(
                    0.9,
                    Tools.server_config.MAX_DOCUMENT_SIZE / size
                ));
            } while (size > Tools.server_config.MAX_DOCUMENT_SIZE);

            var msg = {
                id: uid,
                type: "doc",
                data: dataURL,
                size: size,
                w: this.width * scale || 300,
                h: this.height * scale || 300,
                x: (100 + document.documentElement.scrollLeft) / Tools.scale + 10,
                y: (100 + document.documentElement.scrollTop) / Tools.scale + 10,
                select: true
                //fileType: fileInput.files[0].type
            };

            draw(msg);
            msg.select = false;
            Tools.send(msg,"Document");
        };
    };

    function draw(msg) {
        var aspect = msg.w/msg.h;
        var img = Tools.createSVGElement("image");
        img.id=msg.id;
        img.setAttributeNS(xlinkNS, "href", msg.data);
        img.x.baseVal.value = msg['x'];
        img.y.baseVal.value = msg['y'];
        img.setAttribute("width", 400*aspect);
        img.setAttribute("height", 400);
        if (msg.properties) {
            for (var i = 0; i < msg.properties.length; i++) {
                img.setAttribute(msg.properties[i][0], msg.properties[i][1]);
            }
        }
        Tools.drawingArea.appendChild(img);
        if (msg.select) {
            Tools.change("Transform", 1);
            Tools.list.Transform.selectElement(img);
        }
    }

    Tools.add({
        "name": "Document",
        "draw": draw,
        "onstart": onstart,
        "oneTouch":true,
    });

})(); //End of code isolation