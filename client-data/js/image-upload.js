(function () {
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
})()
