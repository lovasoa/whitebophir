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
	const selectorStates = {
		pointing: 0,
		selecting: 1,
		moving: 2
	}
	var selected = null;
	var selected_els = [];
	var selectionRect = createSelectorRect();
	var selectionRectTranslation;
	var translation_elements = [];
	var selectorState = selectorStates.pointing;
	var last_sent = 0;

	function getParentMathematics(el) {
		var target
		var a = el
		var els = [];
		while (a) {
			els.unshift(a);
			a = a.parentElement;
		}
		var parentMathematics = els.find(el => el.getAttribute("class") === "MathElement");
		if ((parentMathematics) && parentMathematics.tagName === "svg") {
			target = parentMathematics;
		}
		return target ?? el;
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

	function startMovingElements(x, y, evt) {
		evt.preventDefault();
		selectorState = selectorStates.moving;
		selected = { x: x, y: y };
		// Some of the selected elements could have been deleted
		selected_els = selected_els.filter(el => {
			return Tools.svg.getElementById(el.id) !== null
		});
		translation_elements = selected_els.map(el => {
			let tmatrix = get_translate_matrix(el);
			return { x: tmatrix.e, y: tmatrix.f }
		});
		{
			let tmatrix = get_translate_matrix(selectionRect);
			selectionRectTranslation = { x: tmatrix.e, y: tmatrix.f };
		}
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
		tmatrix = get_translate_matrix(selectionRect);
		tmatrix.e = 0;
		tmatrix.f = 0;
	}


	function calculateSelection() {
		var scale = Tools.drawingArea.getCTM().a;
		var selectionTBBox = selectionRect.transformedBBox(scale);
		return Array.from(Tools.drawingArea.children).filter(el => {
			return transformedBBoxIntersects(
				selectionTBBox,
				el.transformedBBox(scale)
			)
		});
	}

	function moveSelection(x, y) {
		var dx = x - selected.x;
		var dy = y - selected.y;
		var msgs = selected_els.map((el, i) => {
			return {
				type: "update",
				id: el.id,
				deltax: dx + translation_elements[i].x,
				deltay: dy + translation_elements[i].y
			}
		})
		var msg = {
			_children: msgs
		};
		{
			let tmatrix = get_translate_matrix(selectionRect);
			tmatrix.e = dx + selectionRectTranslation.x;
			tmatrix.f = dy + selectionRectTranslation.y;
		}
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

	function get_translate_matrix(elem) {
		// Returns the first translate or transform matrix or makes one
		var translate = null;
		for (var i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
			var baseVal = elem.transform.baseVal[i];
			// quick tests showed that even if one changes only the fields e and f or uses createSVGTransformFromMatrix
			// the brower may add a SVG_TRANSFORM_MATRIX instead of a SVG_TRANSFORM_TRANSLATE
			if (baseVal.type === SVGTransform.SVG_TRANSFORM_TRANSLATE || baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
				translate = baseVal;
				break;
			}
		}
		if (translate == null) {
			translate = elem.transform.baseVal.createSVGTransformFromMatrix(Tools.svg.createSVGMatrix());
			elem.transform.baseVal.appendItem(translate);
		}
		return translate.matrix;
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
					var tmatrix = get_translate_matrix(elem);
					tmatrix.e = data.deltax || 0;
					tmatrix.f = data.deltay || 0;
					break;
				default:
					throw new Error("Mover: 'move' instruction with unknown type. ", data);
			}
		}
	}

	function clickSelector(x, y, evt) {
		var scale = Tools.drawingArea.getCTM().a
		selectionRect = selectionRect ?? createSelectorRect();
		if (pointInTransformedBBox([x, y], selectionRect.transformedBBox(scale))) {
			startMovingElements(x, y, evt);
		} else if (Tools.drawingArea.contains(evt.target)) {
			selectionRect.style.display = "none";
			selected_els = [getParentMathematics(evt.target)];
			startMovingElements(x, y, evt);
		} else {
			startSelector(x, y, evt);
		}
	}

	function releaseSelector(x, y, evt) {
		if (selectorState == selectorStates.selecting) {
			selected_els = calculateSelection();
			if (selected_els.length == 0) {
				selectionRect.style.display = "none";
			}
		}
		translation_elements = [];
		selectorState = selectorStates.pointing;
	}

	function moveSelector(x, y, evt) {
		if (selectorState == selectorStates.selecting) {
			updateRect(x, y, selectionRect);
		} else if (selectorState == selectorStates.moving) {
			moveSelection(x, y, selectionRect);
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

	function switchTool() {
		selected = null;
	}

	var handTool = { //The new tool
		"name": "Hand",
		"shortcut": "h",
		"listeners": {
			"press": press,
			"move": move,
			"release": release,
		},
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
