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
	var coord = { x:0, y:0 };
	var last_sent = 0;


	function startMoving(x, y, evt) {
		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		moving = true;
		coord = { x:x, y:y };

		move(x, y, evt);
	}


	function inDrawingArea(elem) {
		return Tools.drawingArea.contains(elem);
	}

	function move(x, y, evt) {
		if (typeof(moving) === 'boolean' && !moving) return;

		// evt.target should be the element over which the mouse is...
		var target = evt.target;
		if (evt.type === "touchmove") {
			// ... the target of touchmove events is the element that was initially touched,
			// not the one **currently** being touched
			var touch = evt.touches[0];
			target = document.elementFromPoint(touch.clientX, touch.clientY);
		}

		if (moverTool.secondary.active) {
			move_everything(x, y);
		} else {
			move_one(x, y, target);
		}
	}

	function move_one(x,y,target) {
		if (typeof(moving) === 'boolean' && moving && target !== svg && target !== Tools.drawingArea && inDrawingArea(target)) {
			moving = svg.getElementById(target.id);
			coord = { x:x, y:y };
		}
		if (typeof(moving) !== 'object') return;

		send_message(x, y, 'update');
	}

	function move_everything(x,y) {
		if (Tools.drawingArea.children == undefined  ||  Tools.drawingArea.children.length === 0) {
			return;
		}

		moving = Tools.drawingArea.children[0];
		send_message(x, y, 'move-all');
	}

	function send_message(x,y, message_type) {
		var shiftx = x - coord.x;
		var shifty = y - coord.y;
		if (shiftx === 0  &&  shifty === 0) return
		coord = { x:x, y:y };

		var msg = make_msg(moving, shiftx, shifty, message_type);
		var now = performance.now();
		if (now - last_sent > 70) {
			last_sent = now;
			Tools.drawAndSend(msg);
		} else {
			draw(msg);
		}
	}

	function stopMoving(x, y, evt) {
		if (typeof(moving) === 'object') {
			var shiftx = x - coord.x;
			var shifty = y - coord.y;
			if (moverTool.secondary.active) {
			    Tools.drawAndSend(make_msg(moving, shiftx, shifty, 'move-all'));
			} else {
			    Tools.drawAndSend(make_msg(moving, shiftx, shifty, 'update'));
			}
		}
		moving = false;
	}

	function make_msg(elem, shiftx, shifty, type) {
		var tmatrix = Tools.getTranslateMatrix(elem);
		return { type: type, id: elem.id, deltax: shiftx + tmatrix.e, deltay: shifty + tmatrix.f };
	}

	function draw(data) {
		var elem;
		switch (data.type) {
			case "update":
				elem = svg.getElementById(data.id);
				if (elem == null) {
					console.error("Mover: Tried to move an element that does not exist.");
					return;
				}

				var tmatrix = Tools.getTranslateMatrix(elem);
				tmatrix.e = data.deltax||0;
				tmatrix.f = data.deltay||0;

				break;

			case "move-all":
				elem = svg.getElementById(data.id);
				if (elem == null) {
					console.error("Mover: Tried to move everything using an element that does not exist.");
					return;
				}

				var tmatrix = Tools.getTranslateMatrix(elem);
				var shiftx = (data.deltax||0) - tmatrix.e;
				var shifty = (data.deltay||0) - tmatrix.f;

				for (var i = 0; i < Tools.drawingArea.children.length; ++i) {
					var obj = Tools.drawingArea.children[i];
					tmatrix = Tools.getTranslateMatrix(obj);
					tmatrix.e += shiftx;
					tmatrix.f += shifty;
				}

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
