
/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

(function () { //Code isolation
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.addEventListener('change', onFileInputChange);

  function onFileInputChange(event) {
    // TODO: Initialize upload
  }

  function promptForImage() {
    fileInput.click();
  }

  function draw(data) {
    Tools.drawingEvent = true;
    switch (data.type) {
      case "image":
        createImageElement(data);
        break;
      case "update":
        var image = svg.getElementById(data['id']);
        if (!image) {
          console.error("Image: No image provided!", data['id']);
        }
        updateImageElement(image, data);
        break;
      default:
        console.error("Image: Draw instruction with unknown type. ", data);
        break;
    }
  }

  var svg = Tools.svg;
  function createImageElement(data) {
    //Creates a new shape on the canvas, or update a shape that already exists with new information
    var img = svg.getElementById(data.id) || Tools.createSVGElement("image");
    img.setAttribute("id", data.id);
    img.setAttribute("href", data.src);
    img.setAttribute("x", data.x);
    img.setAttribute("y", data.y);

    updateImageElement(img, data);
    Tools.drawingArea.appendChild(img);
    return img;
  }

  function updateImageElement(shape, data) {
    shape.x.baseVal.value = Math.min(data['x2'], data['x']);
    shape.y.baseVal.value = Math.min(data['y2'], data['y']);
    shape.width.baseVal.value = Math.abs(data['x2'] - data['x']);
    shape.height.baseVal.value = Math.abs(data['y2'] - data['y']);
  }

  const canvas = document.getElementById('canvas');

  const events = [
    "drag",
    "dragend",
    "dragenter",
    "dragleave",
    "dragover",
    "dragstart",
    "drop"
  ];

  function getCurrentBoardName() {
    let boardName = window.location.pathname.split('/');
    boardName = boardName[boardName.length - 1];
    boardName = boardName.split('#').shift();
    return boardName;
  }

  async function previewImage(image) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function (event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function () {
          resolve(img);
        }
        img.onerror = function (error) {
          reject(error);
        }
      }
      reader.readAsDataURL(image);
    });
  }

  async function uploadImage(image, position) {
    const id = Tools.generateUID();
    const ImageTool = Tools.list["Image"];

    // Get a preview of the image
    const previewElement = await previewImage(image);

    const dimensions = {
      x: previewElement.width,
      y: previewElement.height
    };

    // Optimistically draw the image on the canvas before uploading.
    ImageTool.draw({
      id,
      type: "image",
      src: previewElement.src,
      opacity: 0.5,
      x: position.x,
      y: position.y,
      x2: position.x + dimensions.x,
      y2: position.y + dimensions.y,
    });

    // Upload the image to the server
    const formData = new FormData();
    formData.append('image', image);
    formData.append('id', id);
    formData.append('position', JSON.stringify(position));
    formData.append('dimensions', JSON.stringify(dimensions));

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      function onError(error) {
        alert('Failed to upload image :`(')
        console.log('error: ', error);
        reject(error);
      }

      function onProgress(event) {
        // TODO: Show a loading indicator while the image is uploading.
        console.log('progress: ', event);
      }

      function onLoad(response) {
        if (xhr.status >= 400) {
          alert('Failed to upload image :`(')
          reject(response);
          console.log('onLoad: ', response);
        }
        resolve(response);
      }

      xhr.open('POST', `/image-upload/${getCurrentBoardName()}`, true);
      xhr.onerror =  onError;
      xhr.onprogress = onProgress;
      xhr.onload = onLoad;
      xhr.send(formData);
    });
  }

  // TODO: Move all canvas event listeners to tool hooks maybe?
  function preventDefault(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onDrop(event) {
    const scale = Tools.getScale();
    const position = {
      x: event.clientX / scale,
      y: event.clientY / scale
    };
    uploadImage(event.dataTransfer.files[0], position);
  }

  events.forEach((eventName) => {
    canvas.addEventListener(eventName, preventDefault, false);
  });

  canvas.addEventListener("drop", onDrop, false);

  var imageTool = {
    "name": "Image",
    "shortcut": "i",
    "listeners": {
      "press": promptForImage,
    },
    "secondary": null,
    "draw": draw,
    "mouseCursor": "crosshair",
    "icon": "",
    "stylesheet": ""
  };
  Tools.add(imageTool);

})(); //End of code isolation
