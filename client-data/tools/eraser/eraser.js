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

(function eraser() { //Code isolation

	var erasing = false;

	var currShape = null;
	var curTool = "click";
	var icons = ["tools/eraser/icon-click.svg", "tools/eraser/icon-drag.svg",];
	var toolNames = ["Remove single shape", "Remove all contacted shapes"];

	var msg = {
		"type": "delete",
		"id": null,
		"x": 0,
		"y": 0
	};

	function startErasing(x, y, evt) {
		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		erasing = true;
		erase(x, y, evt);
	}

	function stopErasing(x, y) {
		erasing = false;
	}

	function inDrawingArea(elem) {
		return Tools.drawingArea.contains(elem);
	}

	function erase(x, y, evt) {
		// evt.target should be the element over which the mouse is...
		var target = evt.target;
		if (evt.type === "touchmove") {
			// ... the target of touchmove events is the element that was initially touched,
			// not the one **currently** being touched
			var touch = evt.touches[0];
			target = document.elementFromPoint(touch.clientX, touch.clientY);
		}
		if (erasing) {
			// get points all within a circle of a given radius
			// https://stackoverflow.com/a/26802146
			// TODO: This can be very slow if dragging is enabled, a large tool size has been chosen and the cursor
			//       is inside the bounding box of a svg path or the board is zommed out and the cursor is allowed to
			//       cover a large distance.
			var radius = Tools.getSize()/2,
				r2 = radius*radius;
			for (var dx = -radius; dx <= radius; dx++) {
				var h = Math.sqrt(r2 - dx * dx) | 0;
				for (var dy = -h; dy <= h; dy++) {
					scanForObject(x, y, target, dx, dy);
				}
			}
			if (curTool === "click") {
				erasing = false;
			}
		}
	}

	function draw(data) {
		var elem;
		switch (data.type) {
			//TODO: add the ability to erase only some points in a line
			case "delete":
				if (Array.isArray(data.id)) {
					for(var i = 0; i<data.id.length; i++){
						elem = svg.getElementById(data.id[i]);
						if (elem !== null){ //console.error("Eraser: Tried to delete an element that does not exist.");
							Tools.drawingArea.removeChild(elem);
						}
					}
				} else {
					elem = svg.getElementById(data.id);
					if (elem === null) return; //console.error("Eraser: Tried to delete an element that does not exist.");
					Tools.drawingArea.removeChild(elem);
				}
				break;
			default:
				console.error("Eraser: 'delete' instruction with unknown type. ", data);
				break;
		}
	}

	function scanForObject(x,y,target, i,j){
		target=document.elementFromPoint((x+i)*Tools.scale-document.documentElement.scrollLeft, (y+j)*Tools.scale-document.documentElement.scrollTop);

		if (target && target !== Tools.svg && target !== Tools.drawingArea && inDrawingArea(target)) {
			msg.id = target.id;
			msg.x = x+i;
			msg.y = y+j;
			msg.target = target;
			if(!msg.id.startsWith("layer")&&msg.id!=="defs"&&msg.id!=="rect_1"&&msg.id!=="cursors"){
				var elem = svg.getElementById(msg.id);
				if (elem !== null) Tools.drawAndSend(msg);
			}
		}
	}

	var svg = Tools.svg;

	function toggle(){
		var index = 0;
		if (curTool === "click") {
			curTool = "drag";
			index = 1;
		} else {
			curTool = "click";
		}
		document.getElementById("toolID-" + eraserTool.name).getElementsByClassName("tool-icon")[0].src = icons[index];
		document.getElementById("toolID-" + eraserTool.name).getElementsByClassName("tool-name")[0].textContent = toolNames[index];
	}


	var eraserTool = { //The new tool
		"name": toolNames[0],
		"shortcut": "e",
		"toggle": toggle,
		"listeners": {
			"press": startErasing,
			"move": erase,
			"release": stopErasing,
		},
		"draw": draw,
		"icon": icons[0],
		"mouseCursor": "crosshair",
		"showMarker": true,
	};
	Tools.add(eraserTool);

})(); //End of code isolation
