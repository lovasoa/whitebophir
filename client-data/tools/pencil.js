(function(){ //Code isolation
	//Indicates the id of the line the user is currently drawing or an empty string while the user is not drawing
	var curLineId = "",
		lastTime = performance.now(); //The time at which the last point was drawn

	function startLine (x,y) { 
		curLineId = Tools.generateUID("l"); //"l" for line

		Tools.drawAndSend({
			'type' : 'line',
			'id' : curLineId
		});
		
		//Immediatly add a point to the line
		continueLine(x,y);
	}

	function continueLine (x,y){
		/*Wait 50ms before adding any point to the currently drawing line.
		This allows the animation to be smother*/
		if (curLineId !== "" &&
			performance.now() - lastTime > 50) {
			Tools.drawAndSend({
				'type' : 'point',
				'line' : curLineId,
				'x' : x,
				'y' : y
			});
			lastTime = performance.now();
		}
	}

	function stopLine (x,y){
		//Add a last point to the line
		continueLine(x,y);
		curLineId = "";
	}

	function draw(data) {
		switch(data.type) {
			case "line":
				renderingLine = createLine(data.id);
				break;
			case "point":
				var line = (renderingLine.id == data.line) ? renderingLine : svg.getElementById(data.line);
				if (!line) {
					console.log("Pencil: Hmmm... I received a point of a line I don't know...");
				}
				addPoint(line, data.x, data.y);
				break;
			case "endline":
				//TODO?
				break;
			default:
				console.log("Pencil: Draw instruction with unknown type. ", data);
				break;
		}
	}


	var svg = Tools.svg;
	function addPoint (line, x,y) {
		var point = svg.createSVGPoint();
		point.x = x; point.y = y;
		line.points.appendItem(point);
	}

	function createLine(id) {
		var line = document.createElementNS(svg.namespaceURI, "polyline");
		line.id = id;
		svg.appendChild(line);
		return line;
	}

	Tools.add({ //The new tool
	 	"name" : "Pencil",
	 	"listeners" : {
	 		"press" : startLine,
	 		"move" : continueLine,
	  		"release" : stopLine,
	 	},
	 	"draw" : draw
	});
	
	//The pencil tool is selected by default
	Tools.change("Pencil");
})(); //End of code isolation
