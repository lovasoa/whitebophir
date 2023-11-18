
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
  //Indicates the id of the shape the user is currently drawing or an empty string while the user is not drawing
  var end = false,
    curId = "",
    curUpdate = { //The data of the message that will be sent for every new point
      'type': 'update',
      'id': "",
      'x': 0,
      'y': 0,
      'x2': 0,
      'y2': 0
    },
    lastTime = performance.now(); //The time at which the last point was drawn

  function start(x, y, evt) {

    //Prevent the press from being interpreted by the browser
    evt.preventDefault();

    curId = Tools.generateUID("i"); // "i" for image

    Tools.drawAndSend({
      type: 'image',
      tool: "Image",
      id: curId,
      x: x,
      y: y,
      x2: x,
      y2: y
    });

    curUpdate.id = curId;
    curUpdate.x = x;
    curUpdate.y = y;
  }

  function move(x, y, evt) {
    /*Wait 70ms before adding any point to the currently drawing shape.
    This allows the animation to be smother*/
    if (curId !== "") {
      if (imageTool.secondary.active) {
        var dx = x - curUpdate.x;
        var dy = y - curUpdate.y;
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        x = curUpdate.x + (dx > 0 ? d : -d);
        y = curUpdate.y + (dy > 0 ? d : -d);
      }
      curUpdate['x2'] = x; curUpdate['y2'] = y;
      if (performance.now() - lastTime > 70 || end) {
        Tools.drawAndSend(curUpdate);
        lastTime = performance.now();
      } else {
        draw(curUpdate);
      }
    }
    if (evt) evt.preventDefault();
  }

  function stop(x, y) {
    //Add a last point to the shape
    end = true;
    move(x, y);
    end = false;
    curId = "";
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

  var imageTool = {
    "name": "Image",
    "shortcut": "i",
    "listeners": {
      "press": start,
      "move": move,
      "release": stop,
    },
    "secondary": null,
    "draw": draw,
    "mouseCursor": "crosshair",
    "icon": "",
    "stylesheet": ""
  };
  Tools.add(imageTool);

})(); //End of code isolation
