/**
 *						  WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the 
 *	JavaScript code in this page.
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

(function mover() { //Code isolation
	/*
		typeof(moving) === 'boolean'
			&&	moving === false
				do nothing (initial state)

		moverTool.secondary.active === false
			&&	typeof(moving) === 'boolean'
			&&	moving === true
				seeking for an object to move

		moverTool.secondary.active === false
			&&	typeof(moving) === 'object'
				moving the object referred in moving

		moverTool.secondary.active === true
			&&	typeof(moving) === 'boolean'
			&&	moving === true
				moving everything
	*/
	var moving = false;
	var lastTime = performance.now();
	var coord_screen = { x:0, y:0 };
	var coord_server = { x:0, y:0 };

	function doNothing() {
		return typeof(moving) === 'boolean' && !moving;
	}

	function startMoving(x, y, evt) {
		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		moving = true;
		coord_screen = { x:x, y:y };
		coord_server = { x:x, y:y };

		move(x, y, evt);
	}

	var msg = {
		"type": "update",
		"id": ""
	};

	function inDrawingArea(elem) {
		return Tools.drawingArea.contains(elem);
	}

	function move(x, y, evt) {
		if (doNothing()) return;

		// evt.target should be the element over which the mouse is...
		var target = evt.target;
		if (evt.type === "touchmove") {
			// ... the target of touchmove events is the element that was initially touched,
			// not the one **currently** being touched
			var touch = evt.touches[0];
			target = document.elementFromPoint(touch.clientX, touch.clientY);
		}

		if (typeof(moving) === 'boolean' && moving && target !== Tools.svg && target !== Tools.drawingArea && inDrawingArea(target)) {
			msg.id = target.id;
			moving = svg.getElementById(target.id);
		}

		if (moverTool.secondary.active) {
			console.log('moving everything!');
		} else {
			if (typeof(moving) === 'object') {
				console.log(moving);
			}
		}
	}

	function stopMoving(x, y, evt) {
		if (doNothing()) return;

		moving = false;
	}

	function draw(data) {
		var elem;
		switch (data.type) {
			case "update":
				elem = svg.getElementById(data.id);
				if (elem === null) console.error("Mover: Tried to move an element that does not exist.");
				else Tools.drawingArea.removeChild(elem);
				break;
			default:
				console.error("Mover: 'move' instruction with unknown type. ", data);
				break;
		}
	}

	var svg = Tools.svg;

	var moverTool = { //The new tool
		"name": "Mover",
		"shortcut": "m",
		"listeners": {
			"press": startMoving,
			"move": move,
			"release": stopMoving,
		},
		"secondary": {
			"name": "Mover-all",
			"icon": "tools/mover/icon_all.svg",
			"active": false
		},
		"draw": draw,
		"icon": "tools/mover/icon_one.svg",
		"mouseCursor": "move",
		"showMarker": true,
	};
	Tools.add(moverTool);
})(); //End of code isolation
