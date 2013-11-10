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
 
(function(){ //Code isolation
	var board = Tools.board, svg = Tools.svg;

	var input = document.createElement("input");
	input.id="textToolInput";
	board.appendChild(input);

	var curText = {
		"x":0,
		"y":0,
		"size" : 0,
		"id" : 0,
		"sentText" : "",
		"lastSending" : 0
	};

	function clickHandler (x,y, evt) {
		if (evt && evt.target == input) return;
		stopEdit()
		curText.id = Tools.generateUID("t");
		curText.x=x; curText.y=y;
		curText.size = parseInt(Tools.getSize()*1.5 + 12);

		//If the user clicked where there was no text, then create a new text field
		Tools.drawAndSend({
			'type' : 'new',
			'id' : curText.id, //"t" for text
			'color' : Tools.getColor(),
			'size' : curText.size,
			'x' : x,
			'y' : y+curText.size/2
		});

		startEdit();
		if (evt) evt.preventDefault();
	}

	function startEdit () {
		input.value="";
		input.focus();
		input.addEventListener("keyup", textChangeHandler);
		input.addEventListener("blur", inputBlurHandler);
	}
	function stopEdit () {
		input.blur();
		input.removeEventListener("keyup", textChangeHandler);
	}

	function textChangeHandler (evt) {
		if (evt && evt.which===13) {
			clickHandler(curText.x,curText.y + 1.5*curText.size);
		}
		if (performance.now() - curText.lastSending > 100) {
			if (curText.sentText !== input.value) {
				Tools.drawAndSend({
					'type' : "update",
					'field' : curText.id,
					'txt' : input.value
				});
				curText.sentText = input.value;
				curText.lastSending = performance.now();
			}
		} else {
			clearTimeout(curText.timeout);
			curText.timeout = setTimeout(textChangeHandler, 200);
		}
	}

	function inputBlurHandler (evt) {
		if (input.value.trim() === "") {
			Tools.drawAndSend({
				"type" : "delete",
				"field" : curText.id
			});
		}
	}

	function draw(data, isLocal) {
		switch(data.type) {
			case "new":
				createTextField(data);
				break;
			case "update":
				var textField = document.getElementById(data.field);
				if (textField===null) {
					console.log("Text: Hmmm... I received text that belongs to an unknown text field");
					return false;
				}
				updateText(textField, data.txt);
				break;
			case "delete":
				var textField = document.getElementById(data.field);
				if (textField===null) {
					console.log("Text: Hmmm... I'm trying to delete an unknown text field");
					return false;
				}
				board.removeChild(textField);
				break;
			default:
				console.log("Text: Draw instruction with unknown type. ", data);
				break;
		}
	}

	function updateText (textField, text) {
		textField.textContent = text;
	}

	function createTextField (fieldData) {
		var elem = Tools.createSVGElement("text");
		elem.id = fieldData.id;
		elem.setAttribute("x", fieldData.x);
		elem.setAttribute("y", fieldData.y);
		elem.setAttribute("font-size", fieldData.size);
		elem.style.fill = fieldData.color;
		if (fieldData.text) elem.textContent = fieldData.text;
		svg.appendChild(elem);
		return elem;
	}

	Tools.add({ //The new tool
	 	"name" : "Text",
	 	"listeners" : {
	 		"press" : clickHandler,
	 	},
	 	"draw" : draw,
	 	"stylesheet" : "tools/text/text.css"
	});

})(); //End of code isolation
