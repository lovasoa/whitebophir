(function(){ //Code isolation
	var board = Tools.board, svg = Tools.svg;

	var curText = {
		"x":0,
		"y":0,
		"size" : 0,
		"id" : 0,
		"sentText" : "",
		"lastSending" : 0
	};

	function clickHandler (x,y, evt) {
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

	var hiddenInput = document.createElement("input");
	hiddenInput.id="hiddenInput";
	board.appendChild(hiddenInput);

	function startEdit () {
		hiddenInput.value="";
		hiddenInput.focus();
		hiddenInput.addEventListener("keyup", textChangeHandler);
	}
	function stopEdit () {
		hiddenInput.removeEventListener("keyup", textChangeHandler);
	}

	function textChangeHandler (evt) {
		if (evt && evt.which===13) {
			clickHandler(curText.x,curText.y + 1.5*curText.size);
		}
		if (performance.now() - curText.lastSending > 100) {
			if (curText.sentText !== hiddenInput.value) {
				Tools.drawAndSend({
					'type' : "update",
					'field' : curText.id,
					'txt' : hiddenInput.value
				});
				curText.sentText = hiddenInput.value;
				curText.lastSending = performance.now();
			}
		} else {
			clearTimeout(curText.timeout);
			curText.timeout = setTimeout(textChangeHandler, 200);
		}
	}

	function fieldBlurHandler (evt) {
		var field = evt.target;
		if (field.textContent.trim() === "") {
			Tools.drawAndSend({
				"type" : "delete",
				"field" : field.id
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
