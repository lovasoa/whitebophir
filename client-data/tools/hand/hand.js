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

(function hand() { //Code isolation
	var selectorStates = {
		pointing: 0,
		selecting: 1,
		transform: 2
	}
	var selected = null;
	var selected_els = [];
	var selectionRect = createSelectorRect();
	var selectionRectTransform;
	var currentTransform = null;
	var transform_elements = [];
	var selectorState = selectorStates.pointing;
	var last_sent = 0;
	var blockedSelectionButtons = Tools.server_config.BLOCKED_SELECTION_BUTTONS;
	var selectionButtons = [
		createButton("delete", "delete", 24, 24,
			function (me, bbox, s) {
				me.width.baseVal.value = me.origWidth / s;
				me.height.baseVal.value = me.origHeight / s;
				me.x.baseVal.value = bbox.r[0];
				me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / s;
				me.style.display = "";
			},
			deleteSelection),

		createButton("duplicate", "duplicate", 24, 24,
			function (me, bbox, s) {
				me.width.baseVal.value = me.origWidth / s;
				me.height.baseVal.value = me.origHeight / s;
				me.x.baseVal.value = bbox.r[0] + (me.origWidth + 2) / s;
				me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / s;
				me.style.display = "";
			},
			duplicateSelection),

		createButton("scaleHandle", "handle", 14, 14,
			function (me, bbox, s) {
				me.width.baseVal.value = me.origWidth / s;
				me.height.baseVal.value = me.origHeight / s;
				me.x.baseVal.value = bbox.r[0] + bbox.a[0] - me.origWidth / (2 * s);
				me.y.baseVal.value = bbox.r[1] + bbox.b[1] - me.origHeight / (2 * s);
				me.style.display = "";
			},
			startScalingTransform)
	];

	for (i in blockedSelectionButtons) {
		delete selectionButtons[blockedSelectionButtons[i]];
	}

	var getScale = Tools.getScale;

	function getParentMathematics(el) {
		var target;
		var a = el;
		var els = [];
		while (a) {
			els.unshift(a);
			a = a.parentElement;
		}
		var parentMathematics = els.find(function (el) {
			return el.getAttribute("class") === "MathElement";
		});
		if ((parentMathematics) && parentMathematics.tagName === "svg") {
			target = parentMathematics;
		}
		return target || el;
	}

	function deleteSelection() {
		var msgs = selected_els.map(function (el) {
			return ({
				"type": "delete",
				"id": el.id
			});
		});
		var data = {
			_children: msgs
		}
		Tools.drawAndSend(data);
		selected_els = [];
		hideSelectionUI();
	}

	function duplicateSelection() {
		if (!(selectorState == selectorStates.pointing)
			|| (selected_els.length == 0)) return;
		var msgs = [];
		var newids = [];
		for (var i = 0; i < selected_els.length; i++) {
			var id = selected_els[i].id;
			msgs[i] = {
				type: "copy",
				id: id,
				newid: Tools.generateUID(id[0])
			};
			newids[i] = id;
		}
		Tools.drawAndSend({ _children: msgs });
		selected_els = newids.map(function (id) {
			return Tools.svg.getElementById(id);
		});
	}

	function createSelectorRect() {
		var shape = Tools.createSVGElement("rect");
		shape.id = "selectionRect";
		shape.x.baseVal.value = 0;
		shape.y.baseVal.value = 0;
		shape.width.baseVal.value = 0;
		shape.height.baseVal.value = 0;
		shape.setAttribute("stroke", "black");
		shape.setAttribute("stroke-width", 1);
		shape.setAttribute("vector-effect", "non-scaling-stroke");
		shape.setAttribute("fill", "none");
		shape.setAttribute("stroke-dasharray", "5 5");
		shape.setAttribute("opacity", 1);
		Tools.svg.appendChild(shape);
		return shape;
	}

	function createButton(name, icon, width, height, drawCallback, clickCallback) {
		var shape = Tools.createSVGElement("image", {
			href: "tools/hand/" + icon + ".svg",
			width: width, height: height
		});
		shape.style.display = "none";
		shape.origWidth = width;
		shape.origHeight = height;
		shape.drawCallback = drawCallback;
		shape.clickCallback = clickCallback;
		Tools.svg.appendChild(shape);
		return shape;
	}

	function showSelectionButtons() {
		var scale = getScale();
		var selectionBBox = selectionRect.transformedBBox();
		for (var i = 0; i < selectionButtons.length; i++) {
			selectionButtons[i].drawCallback(selectionButtons[i],
				selectionBBox,
				scale);
		}
	}

	function hideSelectionButtons() {
		for (var i = 0; i < selectionButtons.length; i++) {
			selectionButtons[i].style.display = "none";
		}
	}

	function hideSelectionUI() {
		hideSelectionButtons();
		selectionRect.style.display = "none";
	}

	function startMovingElements(x, y, evt) {
		evt.preventDefault();
		selectorState = selectorStates.transform;
		currentTransform = moveSelection;
		selected = { x: x, y: y };
		// Some of the selected elements could have been deleted
		selected_els = selected_els.filter(function (el) {
			return Tools.svg.getElementById(el.id) !== null;
		});
		transform_elements = selected_els.map(function (el) {
			var tmatrix = get_transform_matrix(el);
			return {
				a: tmatrix.a, b: tmatrix.b, c: tmatrix.c,
				d: tmatrix.d, e: tmatrix.e, f: tmatrix.f
			};
		});
		var tmatrix = get_transform_matrix(selectionRect);
		selectionRectTransform = { x: tmatrix.e, y: tmatrix.f };
	}

	function startScalingTransform(x, y, evt) {
		evt.preventDefault();
		hideSelectionButtons();
		selectorState = selectorStates.transform;
		var bbox = selectionRect.transformedBBox();
		selected = {
			x: bbox.r[0],
			y: bbox.r[1],
			w: bbox.a[0],
			h: bbox.b[1],
		};
		transform_elements = selected_els.map(function (el) {
			var tmatrix = get_transform_matrix(el);
			return {
				a: tmatrix.a, b: tmatrix.b, c: tmatrix.c,
				d: tmatrix.d, e: tmatrix.e, f: tmatrix.f
			};
		});
		var tmatrix = get_transform_matrix(selectionRect);
		selectionRectTransform = {
			a: tmatrix.a, d: tmatrix.d,
			e: tmatrix.e, f: tmatrix.f
		};
		currentTransform = scaleSelection;
	}

	function startSelector(x, y, evt) {
		evt.preventDefault();
		selected = { x: x, y: y };
		selected_els = [];
		selectorState = selectorStates.selecting;
		selectionRect.x.baseVal.value = x;
		selectionRect.y.baseVal.value = y;
		selectionRect.width.baseVal.value = 0;
		selectionRect.height.baseVal.value = 0;
		selectionRect.style.display = "";
		tmatrix = get_transform_matrix(selectionRect);
		tmatrix.e = 0;
		tmatrix.f = 0;
	}


	function calculateSelection() {
		var selectionTBBox = selectionRect.transformedBBox();
		var elements = Tools.drawingArea.children;
		var selected = [];
		for (var i = 0; i < elements.length; i++) {
			if (transformedBBoxIntersects(selectionTBBox, elements[i].transformedBBox()))
				selected.push(Tools.drawingArea.children[i]);
		}
		return selected;
	}

	function moveSelection(x, y) {
		var dx = x - selected.x;
		var dy = y - selected.y;
		var msgs = selected_els.map(function (el, i) {
			var oldTransform = transform_elements[i];
			return {
				type: "update",
				id: el.id,
				transform: {
					a: oldTransform.a,
					b: oldTransform.b,
					c: oldTransform.c,
					d: oldTransform.d,
					e: dx + oldTransform.e,
					f: dy + oldTransform.f
				}
			};
		})
		var msg = {
			_children: msgs
		};
		var tmatrix = get_transform_matrix(selectionRect);
		tmatrix.e = dx + selectionRectTransform.x;
		tmatrix.f = dy + selectionRectTransform.y;
		var now = performance.now();
		if (now - last_sent > 70) {
			last_sent = now;
			Tools.drawAndSend(msg);
		} else {
			draw(msg);
		}
	}

	function scaleSelection(x, y) {
		var rx = (x - selected.x) / (selected.w);
		var ry = (y - selected.y) / (selected.h);
		var msgs = selected_els.map(function (el, i) {
			var oldTransform = transform_elements[i];
			var x = el.transformedBBox().r[0];
			var y = el.transformedBBox().r[1];
			var a = oldTransform.a * rx;
			var d = oldTransform.d * ry;
			var e = selected.x * (1 - rx) - x * a +
				(x * oldTransform.a + oldTransform.e) * rx
			var f = selected.y * (1 - ry) - y * d +
				(y * oldTransform.d + oldTransform.f) * ry
			return {
				type: "update",
				id: el.id,
				transform: {
					a: a,
					b: oldTransform.b,
					c: oldTransform.c,
					d: d,
					e: e,
					f: f
				}
			};
		})
		var msg = {
			_children: msgs
		};

		var tmatrix = get_transform_matrix(selectionRect);
		tmatrix.a = rx;
		tmatrix.d = ry;
		tmatrix.e = selectionRectTransform.e +
			selectionRect.x.baseVal.value * (selectionRectTransform.a - rx)
		tmatrix.f = selectionRectTransform.f +
			selectionRect.y.baseVal.value * (selectionRectTransform.d - ry)
		var now = performance.now();
		if (now - last_sent > 70) {
			last_sent = now;
			Tools.drawAndSend(msg);
		} else {
			draw(msg);
		}
	}

	function updateRect(x, y, rect) {
		rect.x.baseVal.value = Math.min(x, selected.x);
		rect.y.baseVal.value = Math.min(y, selected.y);
		rect.width.baseVal.value = Math.abs(x - selected.x);
		rect.height.baseVal.value = Math.abs(y - selected.y);
	}

	function resetSelectionRect() {
		var bbox = selectionRect.transformedBBox();
		var tmatrix = get_transform_matrix(selectionRect);
		selectionRect.x.baseVal.value = bbox.r[0];
		selectionRect.y.baseVal.value = bbox.r[1];
		selectionRect.width.baseVal.value = bbox.a[0];
		selectionRect.height.baseVal.value = bbox.b[1];
		tmatrix.a = 1; tmatrix.b = 0; tmatrix.c = 0;
		tmatrix.d = 1; tmatrix.e = 0; tmatrix.f = 0;
	}

	function get_transform_matrix(elem) {
		// Returns the first translate or transform matrix or makes one
		var transform = null;
		for (var i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
			var baseVal = elem.transform.baseVal[i];
			// quick tests showed that even if one changes only the fields e and f or uses createSVGTransformFromMatrix
			// the brower may add a SVG_TRANSFORM_MATRIX instead of a SVG_TRANSFORM_TRANSLATE
			if (baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
				transform = baseVal;
				break;
			}
		}
		if (transform == null) {
			transform = elem.transform.baseVal.createSVGTransformFromMatrix(Tools.svg.createSVGMatrix());
			elem.transform.baseVal.appendItem(transform);
		}
		return transform.matrix;
	}

	function draw(data) {
		if (data._children) {
			batchCall(draw, data._children);
		}
		else {
			switch (data.type) {
				case "update":
					var elem = Tools.svg.getElementById(data.id);
					if (!elem) throw new Error("Mover: Tried to move an element that does not exist.");
					var tmatrix = get_transform_matrix(elem);
					for (i in data.transform) {
						tmatrix[i] = data.transform[i]
					}
					break;
				case "copy":
					var newElement = Tools.svg.getElementById(data.id).cloneNode(true);
					newElement.id = data.newid;
					Tools.drawingArea.appendChild(newElement);
					break;
				case "delete":
					data.tool = "Eraser";
					messageForTool(data);
					break;
				default:
					throw new Error("Mover: 'move' instruction with unknown type. ", data);
			}
		}
	}

	function clickSelector(x, y, evt) {
		selectionRect = selectionRect || createSelectorRect();
		for (var i = 0; i < selectionButtons.length; i++) {
			if (selectionButtons[i].contains(evt.target)) {
				var button = selectionButtons[i];
			}
		}
		if (button) {
			button.clickCallback(x, y, evt);
		} else if (pointInTransformedBBox([x, y], selectionRect.transformedBBox())) {
			hideSelectionButtons();
			startMovingElements(x, y, evt);
		} else if (Tools.drawingArea.contains(evt.target)) {
			hideSelectionUI();
			selected_els = [getParentMathematics(evt.target)];
			startMovingElements(x, y, evt);
		} else {
			hideSelectionButtons();
			startSelector(x, y, evt);
		}
	}

	function releaseSelector(x, y, evt) {
		if (selectorState == selectorStates.selecting) {
			selected_els = calculateSelection();
			if (selected_els.length == 0) {
				hideSelectionUI();
			}
		} else if (selectorState == selectorStates.transform)
			resetSelectionRect();
		if (selected_els.length != 0) showSelectionButtons();
		transform_elements = [];
		selectorState = selectorStates.pointing;
	}

	function moveSelector(x, y, evt) {
		if (selectorState == selectorStates.selecting) {
			updateRect(x, y, selectionRect);
		} else if (selectorState == selectorStates.transform && currentTransform) {
			currentTransform(x, y);
		}
	}

	function startHand(x, y, evt, isTouchEvent) {
		if (!isTouchEvent) {
			selected = {
				x: document.documentElement.scrollLeft + evt.clientX,
				y: document.documentElement.scrollTop + evt.clientY,
			}
		}
	}
	function moveHand(x, y, evt, isTouchEvent) {
		if (selected && !isTouchEvent) { //Let the browser handle touch to scroll
			window.scrollTo(selected.x - evt.clientX, selected.y - evt.clientY);
		}
	}

	function press(x, y, evt, isTouchEvent) {
		if (!handTool.secondary.active) startHand(x, y, evt, isTouchEvent);
		else clickSelector(x, y, evt, isTouchEvent);
	}


	function move(x, y, evt, isTouchEvent) {
		if (!handTool.secondary.active) moveHand(x, y, evt, isTouchEvent);
		else moveSelector(x, y, evt, isTouchEvent);
	}

	function release(x, y, evt, isTouchEvent) {
		move(x, y, evt, isTouchEvent);
		if (handTool.secondary.active) releaseSelector(x, y, evt, isTouchEvent);
		selected = null;
	}

	function deleteShortcut(e) {
		if (e.key == "Delete" &&
			!e.target.matches("input[type=text], textarea"))
			deleteSelection();
	}

	function duplicateShortcut(e) {
		if (e.key == "d" &&
			!e.target.matches("input[type=text], textarea"))
			duplicateSelection();
	}

	function switchTool() {
		onquit();
		if (handTool.secondary.active) {
			window.addEventListener("keydown", deleteShortcut);
			window.addEventListener("keydown", duplicateShortcut);
		}
	}

	function onquit() {
		selected = null;
		hideSelectionUI();
		window.removeEventListener("keydown", deleteShortcut);
		window.removeEventListener("keydown", duplicateShortcut);
	}

	var handTool = { //The new tool
		"name": "Hand",
		"shortcut": "h",
		"listeners": {
			"press": press,
			"move": move,
			"release": release,
		},
		"onquit": onquit,
		"secondary": {
			"name": "Selector",
			"icon": "tools/hand/selector.svg",
			"active": false,
			"switch": switchTool,
		},
		"draw": draw,
		"icon": "tools/hand/hand.svg",
		"mouseCursor": "move",
		"showMarker": true,
	};
	Tools.add(handTool);
	Tools.change("Hand"); // Use the hand tool by default
})(); //End of code isolation
