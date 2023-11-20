
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
  const canvas = document.getElementById('canvas');
  const drawingArea = document.getElementById('drawingArea');
  const newImageDropPoint = {
    x: 0,
    y: 0,
  };

  const fileInput = document.createElement('input');
  fileInput.setAttribute('id', 'imageUpload');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  document.body.appendChild(fileInput);

  function onFileInputChange(event) {
    uploadImage(event.target.files[0], {
      x: newImageDropPoint.x,
      y: newImageDropPoint.y,
    });
  }

  function promptForImage(x, y, event) {
    // Get the position of the click on the canvas so when the user uploads
    // an image, we can draw it at the same position.
    newImageDropPoint.x = x;
    newImageDropPoint.y = y;
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

  /**
    * Gets the absolute URL of a relative URL.  Ensures that the URL points to
    * the same origin as the current page.
    */
  function getAbsoluteImageUrl(relativeUrl) {
    const normalizedUrl = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
    return `${window.location.origin}${normalizedUrl}`;
  }

  var svg = Tools.svg;
  /**
    * Creates a new image element on the canvas, or updates an existing image
    * with new information.
    * @param {Object} data - The data to use to create the image.
    */
  function createImageElement(data) {
    const boardName = getCurrentBoardName();
    const img = svg.getElementById(data.id) || Tools.createSVGElement("image");
    img.setAttribute("id", data.id);
    img.setAttribute("href", `/board-assets/${boardName}/${data.id}`);
    img.setAttribute("x", data.x);
    img.setAttribute("y", data.y);

    updateImageElement(img, data);
    drawingArea.appendChild(img);
    return img;
  }

  function createPreviewImageElement(data) {
    const img = svg.getElementById(data.id) || Tools.createSVGElement("image");
    img.setAttribute("id", data.id);
    img.setAttribute("href", data.href);
    img.setAttribute("x", data.x);
    img.setAttribute("y", data.y);

    updateImageElement(img, data);
    drawingArea.appendChild(img);
    return img;
  }

  /**
    * Updates the image element with new data.
    */
  function updateImageElement(imageElement, data) {
    imageElement.x.baseVal.value = Math.min(data['x2'], data['x']);
    imageElement.y.baseVal.value = Math.min(data['y2'], data['y']);
    imageElement.width.baseVal.value = Math.abs(data['x2'] - data['x']);
    imageElement.height.baseVal.value = Math.abs(data['y2'] - data['y']);
  }

  /**
    * Get the name of the current board based on the current URL.
    * @returns {string} - The name of the current board.
    */
  function getCurrentBoardName() {
    let boardName = window.location.pathname.split('/');
    boardName = boardName[boardName.length - 1];
    boardName = boardName.split('#').shift();
    return boardName;
  }

  /**
    * Loads the image from the filesystem to generate a preview while uploading
    * occurs as well as to get the dimensions of the image.
    * @param {File} image - The image to preview.
    * @returns {Promise} - A promise that resolves with the image preview.
    */
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

  /**
    * Uploads an image to the server, draws it on the canvas optimistically.
    * @param {File} image - The image to upload.
    * @param {Object} position - The position to draw the image on the canvas.
    * @param {number} position.x - The x coordinate of the image.
    * @param {number} position.y - The y coordinate of the image.
    * @returns {Promise} - A promise that resolves when the image has been uploaded.
    */
  async function uploadImage(image, position) {
    const id = Tools.generateUID();

    // Get a preview of the image
    const previewElement = await previewImage(image);

    const dimensions = {
      x: previewElement.width,
      y: previewElement.height
    };

    // Optimistically draw the image on the canvas before uploading.
    createPreviewImageElement({
      id,
      type: "image",
      href: previewElement.src,
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
        alert('An error occurred while attempting to upload the image.')
        console.log('error: ', error);
        reject(error);
      }

      function onProgress(event) {
        // TODO: Show a loading indicator while the image is uploading.
        console.log('progress: ', event);
      }

      function onLoad(response) {
        if (xhr.status >= 400) {
          alert('A server error occurred while uploading the image.')
          reject(response);
          console.log('onLoad: ', response);
        }
        resolve(response);
      }

      xhr.open('POST', `/image-upload/${getCurrentBoardName()}`, true);
      xhr.onerror = onError;
      xhr.onprogress = onProgress;
      xhr.onload = onLoad;
      xhr.send(formData);
    });
  }

  /**
    * Handles the drop event on the canvas.
    * @param {Event} event - The drop event.
    */
  function onUploadEvent(event) {
    const scale = Tools.getScale();
    const position = {
      x: event.clientX / scale,
      y: event.clientY / scale
    };
    uploadImage(event.dataTransfer.files[0], position);
  }

  function checkFileIsImage(file) {
    return file.type.startsWith('image/');
  }

  function onDrop(event) {
    if (!checkFileIsImage(event.dataTransfer.files[0])) {
      alert('File type not supported.');
      return;
    }
    onUploadEvent(event);
  }

  /**
    * Called when the tool is selected.
    */
  function onStart() {
    fileInput.addEventListener('change', onFileInputChange);
  }

  /**
    * Called when the tool is deselected.
    */
  function onQuit() {
    fileInput.removeEventListener('change', onFileInputChange);
  }

  // List of all drag/drop events.
  const events = [
    "drag",
    "dragend",
    "dragenter",
    "dragleave",
    "dragover",
    "dragstart",
    "drop"
  ];

  // Ignore all default handling of drag/drop events on the canvas.
  function preventDefault(e) {
    e.preventDefault();
    e.stopPropagation();
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
    "onstart": onStart,
    "onquit": onQuit,
    "secondary": null,
    "draw": draw,
    "mouseCursor": "cell",
		"icon": "tools/image/icon.svg",
    "stylesheet": ""
  };
  Tools.add(imageTool);

})(); //End of code isolation
