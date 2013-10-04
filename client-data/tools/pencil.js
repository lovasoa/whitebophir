(function(){ //Code isolation
	var pencil = {}; //The new tool that will be added with Tools.add
	pencil.name = "Pencil";


	var svg = Tools.svg;

	var curLine = {},
		lastTime = performance.now(),
		drawing = false; //Indicates if a line is currently being draxn
 
	function draw(data) {
		switch(data.type) {
			case "line":
				curLine = createLine(data.id);
				break;
			case "point":
				var line = (data.line===curLine.id) ? curLine : svg.getElementById(data.line);
				if (!line) {
					console.log("Pencil: Hmmm... I received a point of a line I don't know...");
				}
				addPoint(line, data.x, data.y);
				break;
			case "endline":
				break;
			default:
				console.log("Pencil: Draw instruction with unknown type. ", data);
				break;
		}
	}

	function pressHandler (ev) {
		drawing = true;
		Tools.drawAndSend({
			'type' : 'line',
			'id' : Tools.generateUID("l"); //"l" for line
		});
	}

	function moveHandler (ev){
		if (curLine !== null &&
			performance.now() - lastTime > 50) {
			var x = ev.clientX + window.scrollX,
				y = ev.clientY + window.scrollY;
			socket.emit('broadcast', {
				'type' : 'point',
				'line' : curLine.id,
				'x' : x,
				'y' : y
			});
			addPoint(curLine, x,y);
			lastTime = performance.now();
		}
		ev.preventDefault();
		return false;
	}

	function releaseHandler (){
		drawing = false;
	}
svg.addEventListener("mouseup", releaseHandler);
svg.addEventListener("mouseleave", releaseHandler);
//svg.addEventListener("touchend", releaseHandler);



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

})(); //End of code isolation
