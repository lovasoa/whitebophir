(function(){ //Code isolation
	//Indicates the id of the line the user is currently drawing or an empty string while the user is not drawing
	var curLineId = "",
		curPoint = { //The data of the message that will be sent for every new point
				'type' : 'point',
				'line' : "",
				'x' : 0,
				'y' : 0
		},
		lastTime = performance.now(); //The time at which the last point was drawn

	function startLine (x,y, evt) {

		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		curLineId = Tools.generateUID("l"); //"l" for line

		Tools.drawAndSend({
			'type' : 'line',
			'id' : curLineId,
			'color' : Tools.getColor(),
			'size' : Tools.getSize()
		});

		//Update the current point
		curPoint.line = curLineId;

		//Immediatly add a point to the line
		continueLine(x,y);
	}

	function continueLine (x,y){
		/*Wait 50ms before adding any point to the currently drawing line.
		This allows the animation to be smother*/
		if (curLineId !== "" &&
			performance.now() - lastTime > 50) {
			curPoint.x = x; curPoint.y = y;
			Tools.drawAndSend(curPoint);
			lastTime = performance.now();
		}
	}

	function stopLine (x,y){
		//Add a last point to the line
		continueLine(x+1,y+1);
		curLineId = "";
	}

	var renderingLine = {};
	function draw(data) {
		switch(data.type) {
			case "line":
				renderingLine = createLine(data);
				break;
			case "point":
				var line = (renderingLine.id == data.line) ? renderingLine : svg.getElementById(data.line);
				if (!line) {
					console.log("Pencil: Hmmm... I received a point of a line I don't know...");
					line = renderingLine = createLine(data.id);
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

	function createLine(lineData) {
		var line = Tools.createSVGElement("polyline");
		line.id = lineData.id;
		line.style.stroke = lineData.color || "black";
		line.style.strokeWidth = lineData.size || 3;
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
	 	"draw" : draw,
	 	
	 	"stylesheet" : "tools/pencil/pencil.css"
	});

	//The pencil tool is selected by default
	Tools.change("Pencil");
})(); //End of code isolation
