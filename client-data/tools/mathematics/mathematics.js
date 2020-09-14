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
	var board = Tools.board;

	var input = document.createElement("textarea");
	input.id = "textToolInput";
	input.setAttribute("autocomplete", "off");

	var curText = {
		"x": 0,
		"y": 0,
		"size": 36,
		"rawSize": 16,
		"oldSize": 0,
		"opacity": 1,
		"color": "#000",
		"id": 0,
		"sentText": "",
		"lastSending": 0
	};

	var active = false;


	function onStart() {
		curText.oldSize = Tools.getSize();
		Tools.setSize(curText.rawSize);
	}

	function onQuit() {
		stopEdit();
		Tools.setSize(curText.oldSize);
	}

	function clickHandler(x, y, evt, isTouchEvent) {
		//if(document.querySelector("#menu").offsetWidth>Tools.menu_width+3) return;
		// Assemble a list of parents of the evt.target and search it to see if any has class "MathElement"
        if (evt.target === input) return;
		var a = evt.target;
		var els = [];
		while (a) {
			els.unshift(a);
			a = a.parentElement;
		}
		var parentMathematics = els.find(el => el.getAttribute("class") === "MathElement");
		if ((parentMathematics) && parentMathematics.tagName === "svg") {
			editOldMathematics(parentMathematics);
			evt.preventDefault();
			return;
		}
		curText.rawSize = Tools.getSize();
		curText.size = parseInt(curText.rawSize * 1.5 + 12);
		curText.opacity = Tools.getOpacity();
		curText.color = Tools.getColor();
		curText.x = x;
		curText.y = y + curText.size / 2;

		stopEdit();
		startEdit();
		evt.preventDefault();
	}

	function editOldMathematics(elem) {
		curText.id = elem.id;
		var r = elem.getBoundingClientRect();
		var x = (r.left + document.documentElement.scrollLeft) / Tools.scale;
		var y = (r.top + r.height + document.documentElement.scrollTop) / Tools.scale;

		curText.x = x;
		curText.y = y;
		curText.sentText = elem.getAttribute("aria-label");
		curText.size = parseInt(elem.getAttribute("font-size"));
		curText.opacity = parseFloat(elem.getAttribute("opacity"));
		curText.color = elem.getAttribute("fill");
		startEdit();
		input.value = elem.getAttribute("aria-label");
	}

	function startEdit() {
		active = true;
		if (!input.parentNode) board.appendChild(input);
		input.value = "";
		var clientW = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
		var x = curText.x * Tools.scale - document.documentElement.scrollLeft;
		if (x < 360) {
			x = Math.max(60, clientW - 320);
		} else {
			x = 60;
		}

		input.style.opacity = '0.5';
		input.style.left = x + 'px';
		input.style.top = curText.y * Tools.scale - document.documentElement.scrollTop - 20 + 'px';
		input.style.height = '150px';
		input.style.width = '300px';
		input.focus();
		input.addEventListener("keyup", textChangeHandler);
		input.addEventListener("blur", textChangeHandler);
		input.addEventListener("blur", blur);
	}

	function stopEdit() {
		try { input.blur(); } catch (e) { /* Internet Explorer */ }
		active = false;
		blur();
		curText.id = 0;
		curText.sentText = "";
		input.value = "";
		input.removeEventListener("keyup", textChangeHandler);
	}

	function blur() {
		if (active) return;
		input.style.top = '-1000px';
	}

	function textChangeHandler(evt) {
		input.value = removeDoubleQuotes(input.value); // remove all double quotes; they are unnecessary in (La)TeX and difficult to escape
        if (evt.which === 27) { // escape
			stopEdit();
		}
		if (performance.now() - curText.lastSending > 1000) {
			if (curText.sentText !== input.value) {
				//If the user clicked where there was no text, then create a new text field
				if (curText.id === 0) {
					curText.id = Tools.generateUID("m"); //"m" for math
					Tools.drawAndSend({
						'type': 'new',
						'id': curText.id,
						'color': curText.color,
						'size': curText.size,
						'opacity': curText.opacity,
						'x': curText.x,
						'y': curText.y
					})
				}
                let mathematicsSVG = getSVGFromMathJax(input.value);
				Tools.drawAndSend({
					'type': "update",
					'id': curText.id,
					'txt': input.value,
                    'mWidth': mathematicsSVG.getAttribute('width'),
                    'mHeight': mathematicsSVG.getAttribute('height'),
                    'mViewBox': mathematicsSVG.getAttribute('viewBox'),
                    'mInnerHTML': mathematicsSVG.innerHTML,
				});
				curText.sentText = input.value;
				curText.lastSending = performance.now();
			}
		} else {
			clearTimeout(curText.timeout);
			curText.timeout = setTimeout(textChangeHandler, 500, evt);
		}
	}
	function removeDoubleQuotes(inStr) {
		return inStr.split('"').join('');
	}
    
	function getSVGFromMathJax(rawTeX) {
		let userColor = Tools.getColor();
        let svgFromMathJax = MathJax.tex2svg("\\color{" + userColor + "}\\begin{align}" + rawTeX + '\\end{align}', {display: true});
		let svgOnly = svgFromMathJax.children[0];
		// Split the viewBox into separate strings
		var strArrViewBox = svgOnly.getAttribute("viewBox").split(" ");
		var clickableRect = Tools.createSVGElement("rect");
		clickableRect.setAttribute("class", "ClickHelper");
		clickableRect.setAttribute("x", strArrViewBox[0]);
		clickableRect.setAttribute("y", strArrViewBox[1]);
		clickableRect.setAttribute("width", strArrViewBox[2]);
		clickableRect.setAttribute("height", strArrViewBox[3]);
		clickableRect.setAttribute("opacity", 0);
		clickableRect.setAttribute("stroke-opacity", 0);
		clickableRect.setAttribute("stroke", userColor);
		svgOnly.appendChild(clickableRect);
		return svgOnly;
	}

	function draw(data, isLocal) {
		Tools.drawingEvent = true;
		switch (data.type) {
			case "new":
				createMathematicsField(data);
				break;
			case "update":
				var mathematicsField = document.getElementById(data.id);
				if (mathematicsField === null) {
					console.error("Mathematics: Hmmm... I received text that belongs to an unknown text field");
					return false;
				}
				updateMathematics(mathematicsField, data.txt, data.mWidth, data.mHeight, data.mViewBox, data.mInnerHTML);
				break;
			default:
				console.error("Mathematics: Draw instruction with unknown type. ", data);
				break;
		}
	}

	function updateMathematics(mathematicsField, rawTeX, mWidth, mHeight, mViewBox, mInnerHTML) {
		mathematicsField.setAttribute('aria-label', rawTeX);
		mathematicsField.setAttribute('width', mWidth);
		mathematicsField.setAttribute('height', mHeight);
		mathematicsField.setAttribute('viewBox', mViewBox);
		mathematicsField.innerHTML = mInnerHTML;
	}

	function createMathematicsField(fieldData) {
		var elem = Tools.createSVGElement("svg");
		elem.id = fieldData.id;
		elem.setAttribute("class", "MathElement");
		elem.setAttribute("x", fieldData.x);
		elem.setAttribute("y", fieldData.y);
		if (fieldData.txt) elem.setAttribute("aria-label", fieldData.txt);
		if ((fieldData.mWidth && fieldData.mHeight) && (fieldData.mViewBox && fieldData.mInnerHTML)) {
			updateMathematics(elem, fieldData.txt, fieldData.mWidth, fieldData.mHeight, fieldData.mViewBox, fieldData.mInnerHTML);
		}
		Tools.drawingArea.appendChild(elem);
		return elem;
	}

	Tools.add({ //The new tool
		"name": "Mathematics",
		"shortcut": "m",
		"listeners": {
			"press": clickHandler,
		},
		"onstart": onStart,
		"onquit": onQuit,
		"draw": draw,
		"stylesheet": "tools/mathematics/mathematics.css",
		"icon": "tools/mathematics/icon.svg",
		"mouseCursor": "mathematics"
	});

})(); //End of code isolation
