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

	function doNothing() {
		return typeof(moving) === 'boolean' && !moving;
	}

	function startMoving(x, y, evt) {
		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		moving = true;
		msg = new emptyMsg();
		move(x, y, evt);
	}

	var msg;
	function emptyMsg() {
		this.type = 'update';
		this.id = '';
	}

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
			coord_screen = { x:x, y:y };
			msg.id = target.id;
			moving = svg.getElementById(target.id);
		}

		if (moverTool.secondary.active) {
			console.log('moving everything!');
		} else {
			if (typeof(moving) === 'object') {
				move_one(x,y);
			}
		}
	}

	const get_coord_f= {
		'rect': function(deltax, deltay) {
			var x =0| moving.getAttribute('x');
			var y =0| moving.getAttribute('y');
			var width =0| moving.getAttribute('width');
			var height =0| moving.getAttribute('height');

			msg.x = (x + deltax);
			msg.y = (y + deltay);
			msg.x2 = (msg.x + width);
			msg.y2 = (msg.y + height);
		},
		'ellipse': function(deltax, deltay) {
			var cx =0| moving.getAttribute('cx');
			var cy =0| moving.getAttribute('cy');
			var rx =0| moving.getAttribute('rx');
			var ry =0| moving.getAttribute('ry');

			msg.x = (cx - rx + deltax);
			msg.y = (cy - ry + deltay);
			msg.x2 = (cx + rx + deltax);
			msg.y2 = (cy + ry + deltay);
		}
	};

	const move_coord_f= {
		'rect': function(obj, msg) {
			obj.setAttribute('x', msg.x);
			obj.setAttribute('y', msg.y);
		},
		'ellipse': function (obj, msg) {
			obj.setAttribute('cx', (msg.x + msg.x2) / 2);
			obj.setAttribute('cy', (msg.y + msg.y2) / 2);
		}
	};

/*
*/

	function move_one(x, y) {
		var deltax = x - coord_screen.x;
		var deltay = y - coord_screen.y;
		if (deltax === 0  &&  deltay === 0) return;

//		  console.log(moving.nodeName, moving);
		get_coord_f[moving.nodeName]( deltax, deltay );

		coord_screen = { x:x, y:y };

		var now = performance.now();
		if (now - lastTime > 70) {
			lastTime = now;
			Tools.drawAndSend(msg);
		} else {
			draw(msg);
		}
	}

	function stopMoving(x, y, evt) {
		if (doNothing()) return;

		Tools.drawAndSend(msg);
		moving = false;
	}

	function draw(msg) {
		var obj;
		switch (msg.type) {
			case "update":
				obj = svg.getElementById(msg.id);
				if (obj == null) return;

				move_coord_f[obj.nodeName](obj, msg);
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
