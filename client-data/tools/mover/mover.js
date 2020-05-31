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
		States:

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
	var coord_screen = null;
	var last_msg = new emptyMsg();

	function doNothing() {
		return typeof(moving) === 'boolean' && !moving;
	}

	function startMoving(x, y, evt) {
		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		moving = true;
		coord_screen = { x:x, y:y };
		move(x, y, evt);
	}

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

		if (moverTool.secondary.active) {
			move_everything(x, y);
		} else {
			move_one(x,y, target);
		}
	}


	function move_everything(x, y) {
		if (Tools.drawingArea.children == undefined  ||  Tools.drawingArea.children.length === 0) {
			return;
		}
		var deltax = x - coord_screen.x;
		var deltay = y - coord_screen.y;
		if (deltax === 0  &&  deltay === 0) return;

		var now = performance.now();
		var reference_obj = Tools.drawingArea.children[0];

		var msg = fillout_msg(reference_obj, deltax, deltay);
		msg.type = 'move_all';
		last_msg = msg;

		if (now - lastTime > 140) {
			lastTime = now;
			Tools.drawAndSend(msg);
		} else {
			draw(msg);
		}

		coord_screen = { x:x, y:y };
	}


	var fillout_msg_table = {
		'path': function(path, deltax, deltay) {
			var new_msg = new emptyMsg();
			var path_data = path.getPathData();
			if (path_data.length > 0) {
				new_msg.pencil_move = 1;
				new_msg.new_x = path_data[0].values[0] + deltax;
				new_msg.new_y = path_data[0].values[1] + deltay;
			}
			return new_msg;
		},
		'line': function(line, deltax, deltay) {
			var new_msg = new emptyMsg();
			var x =0|  line.getAttribute('x1');
			var y =0|  line.getAttribute('y1');
			var x2 =0| line.getAttribute('x2');
			var y2 =0| line.getAttribute('y2');

			new_msg.x = (x + deltax);
			new_msg.y = (y + deltay);
			new_msg.x2 = (x2 + deltax);
			new_msg.y2 = (y2 + deltay);
			return new_msg;
		},
		'rect': function(rect, deltax, deltay) {
			var new_msg = new emptyMsg();
			var x =0| rect.getAttribute('x');
			var y =0| rect.getAttribute('y');
			var width =0| rect.getAttribute('width');
			var height =0| rect.getAttribute('height');

			new_msg.x = (x + deltax);
			new_msg.y = (y + deltay);
			new_msg.x2 = (new_msg.x + width);
			new_msg.y2 = (new_msg.y + height);
			return new_msg;
		},
		'ellipse': function(ellipse, deltax, deltay) {
			var new_msg = new emptyMsg();
			var cx =0| ellipse.getAttribute('cx');
			var cy =0| ellipse.getAttribute('cy');
			var rx =0| ellipse.getAttribute('rx');
			var ry =0| ellipse.getAttribute('ry');

			new_msg.x = (cx - rx + deltax);
			new_msg.y = (cy - ry + deltay);
			new_msg.x2 = (cx + rx + deltax);
			new_msg.y2 = (cy + ry + deltay);
			return new_msg;
		},
		'text': function(text, deltax, deltay) {
			var new_msg = new emptyMsg();
			var x =0| text.getAttribute('x');
			var y =0| text.getAttribute('y');

			new_msg.x = (x + deltax);
			new_msg.y = (y + deltay);
			return new_msg;
		}
	}
	function fillout_msg(obj, deltax, deltay) {
		if (fillout_msg_table[obj.nodeName] == undefined) {
			console.error('Cannot move!', obj.nodeName, obj);
			var empty = new emptyMsg();
			empty.id = obj.id;
			return empty;
		}
		var msg = fillout_msg_table[obj.nodeName]( obj, deltax, deltay );
		msg.id = obj.id;
		return msg;
	}

	function update_xy(obj, msg) {
		obj.setAttribute('x', msg.x);
		obj.setAttribute('y', msg.y);
	}
	var move_coord_table = {
		'line': function(obj, msg) {
			obj.setAttribute('x1', msg.x);
			obj.setAttribute('y1', msg.y);
			obj.setAttribute('x2', msg.x2);
			obj.setAttribute('y2', msg.y2);
		},
		'text': update_xy,
		'rect': update_xy,
		'ellipse': function (obj, msg) {
			obj.setAttribute('cx', (msg.x + msg.x2) / 2);
			obj.setAttribute('cy', (msg.y + msg.y2) / 2);
		},
		'path': function (obj, msg) {
			if (msg.pencil_move == undefined) return;

			var path_data = obj.getPathData();
			if (path_data.length > 0) {
				var deltax = msg.new_x - path_data[0].values[0];
				var deltay = msg.new_y - path_data[0].values[1];

				for (var i = 0; i < path_data.length; ++i) {
					var child = path_data[i];
					var even = true;
					for (var j = 0; j < child.values.length; ++j) {
						if (even) {
							child.values[j] += deltax;
						} else {
							child.values[j] += deltay;
						}
						even = !even;
					}
				}
				obj.setPathData(path_data);
			}
		}
	};
	function move_coord(obj, msg) {
		if (move_coord_table[obj.nodeName] == undefined) {
			console.error('Cannot update coords!', obj.nodeName, obj);
			return;
		}
		move_coord_table[obj.nodeName](obj, msg);
	}

	function move_one(x, y, target) {
		if (typeof(moving) === 'boolean' && moving && target !== Tools.svg && target !== Tools.drawingArea && inDrawingArea(target)) {
			coord_screen = { x:x, y:y };
			moving = svg.getElementById(target.id);
		}
		if (typeof(moving) !== 'object') { return; }

		var deltax = x - coord_screen.x;
		var deltay = y - coord_screen.y;
		if (deltax === 0  &&  deltay === 0) return;

		var msg = fillout_msg(moving, deltax, deltay);
		msg.type = 'update';
		coord_screen = { x:x, y:y };
		last_msg = msg;

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

		Tools.drawAndSend(last_msg);
		moving = false;
	}

	function use_xy(obj, msg) {
		var x =0| obj.getAttribute('x');
		var y =0| obj.getAttribute('y');
		return { deltax: msg.x - x, deltay: msg.y - y }
	}
	var computedelta_table = {
		'ellipse': function (ellipse, msg) {
			var cx =0| ellipse.getAttribute('cx');
			var cy =0| ellipse.getAttribute('cy');
			return {
				deltax: (msg.x + msg.x2) / 2 - cx,
				deltay: (msg.y + msg.y2) / 2 - cy }
		},
		'rect': use_xy,
		'text': use_xy,
		'line': function(line, msg) {
			var x1 = line.getAttribute('x1')
			var y1 = line.getAttribute('y1')
			return { deltax: msg.x - x1, deltay: msg.y - y1 };
		},
		'path': function (path, msg) {
			var path_data = path.getPathData();
			if (path_data.length > 0) {
				return {
					deltax: msg.new_x - path_data[0].values[0],
					deltay: msg.new_y - path_data[0].values[1] }
			}
			return { deltax: 0, deltay: 0 }
		}
	}
	function computedelta(obj, msg) {
		if (computedelta_table[obj.nodeName] == undefined) {
			console.error('Cannot update coords!', obj.nodeName, obj);
			return { deltax:0, deltay:0 };
		}
		return computedelta_table[obj.nodeName](obj, msg);
	}

	function draw(data) {
		var obj;
		switch (data.type) {
			case "update":
				obj = svg.getElementById(data.id);
				if (obj == null) return;

				move_coord(obj, data);
				break;

			case "move_all":
				obj = svg.getElementById(data.id);
				if (obj == null) return;

				var delta = computedelta(obj, data);
				for (var i = 0; i < Tools.drawingArea.children.length; ++i) {
					var shape = Tools.drawingArea.children[i];
					var msg = fillout_msg(shape, delta.deltax, delta.deltay);
					move_coord(shape, msg);
				}
				break;

			default:
				console.error("Mover: 'move' instruction with unknown type. ", data.type, data);
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
