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
	var board = Tools.board, svg = Tools.svg;

	var input = document.createElement("input");
	input.id = "textToolInput";
	input.type = "text";
	input.setAttribute("autocomplete", "off");

	var curText = {
		"x": 0,
		"y": 0,
		"size": 0,
		"opacity": 1,
		"color": "#000",
		"id": 0,
		"sentText": "",
		"lastSending": 0
	};

	function clickHandler(x, y, evt) {
		if (evt.target == input) return;
		if (evt.target.tagName === "text") {
			editOldText(evt.target);
			evt.preventDefault();
			return;
		}
		curText.size = parseInt(Tools.getSize() * 1.5 + 12);
		curText.opacity = Tools.getOpacity();
		curText.color = Tools.getColor();
		curText.x = x;
		curText.y = y + curText.size / 2;

		drawCurText();
		evt.preventDefault();
	}

	function editOldText(elem) {
		curText.id = elem.id;
		curText.x = elem.x.baseVal[0].value;
		curText.y = elem.y.baseVal[0].value;
		curText.size = parseInt(elem.getAttribute("font-size"));
		curText.opacity = parseFloat(elem.getAttribute("opacity"));
		curText.color = elem.getAttribute("fill");
		startEdit();
		input.value = elem.textContent;
	}

	function drawCurText() {
		stopEdit();
		//If the user clicked where there was no text, then create a new text field
		curText.id = Tools.generateUID("t"); //"t" for text
		Tools.drawAndSend({
			'type': 'new',
			'id': curText.id,
			'color': curText.color,
			'size': curText.size,
			'opacity': curText.opacity,
			'x': curText.x,
			'y': curText.y
		});
		startEdit();
	}

	function startEdit() {
		if (!input.parentNode) board.appendChild(input);
		input.value = "";
		input.focus();
		input.addEventListener("keyup", textChangeHandler);
		input.addEventListener("blur", textChangeHandler);
	}

	function stopEdit() {
		input.blur();
		input.removeEventListener("keyup", textChangeHandler);
	}

	function textChangeHandler(evt) {
		if (evt.which === 13) { // enter
			curText.y += 1.5 * curText.size;
			return drawCurText();
		} else if (evt.which === 27) { // escape
			stopEdit();
		}
		if (performance.now() - curText.lastSending > 100) {
			if (curText.sentText !== input.value) {
				Tools.drawAndSend({
					'type': "update",
					'id': curText.id,
					'txt': input.value.slice(0, 280)
				});
				curText.sentText = input.value;
				curText.lastSending = performance.now();
			}
		} else {
			clearTimeout(curText.timeout);
			curText.timeout = setTimeout(textChangeHandler, 500, evt);
		}
	}

	function draw(data, isLocal) {
		switch (data.type) {
			case "new":
				createTextField(data);
				break;
			case "update":
				var textField = document.getElementById(data.id);
				if (textField === null) {
					console.error("Text: Hmmm... I received text that belongs to an unknown text field");
					return false;
				}
				updateText(textField, data.txt);
				break;
			default:
				console.error("Text: Draw instruction with unknown type. ", data);
				break;
		}
	}

	function updateText(textField, text) {
		textField.textContent = text;
	}

	function createTextField(fieldData) {
		var elem = Tools.createSVGElement("text");
		elem.id = fieldData.id;
		elem.setAttribute("x", fieldData.x);
		elem.setAttribute("y", fieldData.y);
		elem.setAttribute("font-size", fieldData.size);
		elem.setAttribute("fill", fieldData.color);
		elem.setAttribute("opacity", Math.max(0.1, Math.min(1, fieldData.opacity)) || 1);
		if (fieldData.txt) elem.textContent = fieldData.txt;
		svg.appendChild(elem);
		return elem;
	}

	Tools.add({ //The new tool
		"name": "Text",
		"icon": "T",
		"shortcut": "t",
		"listeners": {
			"press": clickHandler,
		},
		"draw": draw,
		"stylesheet": "tools/text/text.css",
		"mouseCursor": "text"
	});

})(); //End of code isolation
