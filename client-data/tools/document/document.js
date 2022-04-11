(function documents() { //Code isolation
    const toolName = "Image"; //This appears in the UI when the button expands to show the name

    var xlinkNS = "http://www.w3.org/1999/xlink";
    var imgCount = 1;

    function assert_count() {
        if (Tools.svg.querySelectorAll("image").length >= Tools.server_config.MAX_DOCUMENT_COUNT) {
            alert("Too many documents exist already");
            throw new Error("Too many documents exist already");
        }
    }

    function onstart() {
        if (!window.confirm("Delete this board, and open a new image?")) return;

        var fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.click();
        fileInput.addEventListener("change", function () {
            assert_count();

            var reader = new FileReader();
            const filename = fileInput.files[0].name;
            const filetype = fileInput.files[0].type;
            const filesize = fileInput.files[0].size;
            reader.readAsDataURL(fileInput.files[0]);

            reader.onload = function (e) {
                // use canvas to compress image
                var image = new Image();
                image.src = e.target.result;
                image.onerror = function () {
                    alert(`Could not load image from file "${filename}" of type "${filetype}"`);
                }
                image.onload = function () {
                    Tools.logToServer({
                        m: "opened image file",
                        name: filename,
                        type: filetype,
                        size: filesize,
                        w: image.width,
                        h: image.height
                    });

                    assert_count();

                    var uid = Tools.generateUID("doc"); // doc for document

                    var ctx, size;
                    // find the initial scale, for an image that is larger than the whiteboard size
                    var scaleW = Math.min(1, 2*Tools.svg.width.baseVal.value/image.width);
                    var scaleH = Math.min(1, 2*Tools.svg.height.baseVal.value/image.height);
                    var scale = Math.min(scaleW, scaleH);
                    var scale_used = scale;

                    do {
                        // Todo give feedback of processing effort

                        console.log(`render image scaledW:${scale*image.width} scaledH:${scale*image.height} scale:${scale}`);
                        ctx = document.createElement("canvas").getContext("2d");
                        ctx.canvas.width = image.width * scale;
                        ctx.canvas.height = image.height * scale;
                        ctx.drawImage(image, 0, 0, image.width * scale, image.height * scale);
                        var dataURL = ctx.canvas.toDataURL("image/jpeg", 0.7);
                        scale_used = scale;

                        // Compressed file size as data url, approximately 1/3 larger than as bytestream
                        size = dataURL.length;

                        // attempt again with an image that is at least 10% smaller
                        scale = scale * Math.sqrt(Math.min(
                                0.9,
                                Tools.server_config.MAX_DOCUMENT_SIZE / size
                        ));
                    } while (size > Tools.server_config.MAX_DOCUMENT_SIZE);

                    console.log(`load image size:${size} type:${dataURL.substring(0, dataURL.indexOf(';'))}`);
                    var msg = {
                        id: uid,
                        type: "doc",
                        data: dataURL,
                        size: size,
                        filename: filename, //for logging on server side
                        filetype: filetype, //for logging on server side
                        w: this.width * scale_used || 300,
                        h: this.height * scale_used || 300,
                    };

                    assert_count();

                    // This probably should be in tools/clear.js with some way to trigger it from here
                    Tools.drawAndSend({
                        'type': 'deleteall',
                        },
                        Tools.list.Clear
                    );

                    draw(msg);
                    Tools.send(msg, toolName);
                    imgCount++;
                    Tools.robotTools.showKeepout(false);
                };
            };
            // Tools.change(Tools.prevToolName);
        });
    }

    function draw(msg) {
        var aspect_image = msg.w/msg.h;
        const canvas_width = Tools.svg.width.baseVal.value; 
        const canvas_height = Tools.svg.height.baseVal.value; 
        var aspect_canvas = canvas_width/canvas_height;
        var width, height;
        var x, y;
        if (aspect_image >= aspect_canvas) {
            width = canvas_width;
            height = width/aspect_image;
        } else {
            height = canvas_height;
            width = height*aspect_image;
        }
        var img = Tools.createSVGElement("image");
        img.id=msg.id;
        img.setAttribute("class", "layer-"+Tools.layer);
        img.setAttributeNS(xlinkNS, "href", msg.data);
        // Center the image on the canvas
        x = (canvas_width - width) / 2;
        y = (canvas_height - height) / 2;
        img.x.baseVal.value = x;
        img.y.baseVal.value = y;
        img.setAttribute("width", width);
        img.setAttribute("height", height);
        Tools.drawingArea.appendChild(img);
    }

    Tools.add({
        "name": toolName,
        "draw": draw,
        "onstart": onstart,
        "oneTouch":true,
        "icon": "/tools/document/icon.svg",
    });

})(); //End of code isolation
