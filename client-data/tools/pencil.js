(function(){ //Code isolation
	var pencil = {}; //The new tool that will be added with Tools.add
	pencil.name = "Pencil";


	var svg = Tools.svg;

	var curLine = null,
		lastTime = performance.now();
 
	function draw(data) {
		switch(data.type) {
			case "line":
				createLine(data.id);
				break;
			case "point":
				var line = (data.line===curLine.id) ? curLine : svg.getElementById(data.line);
				if (!line) {
					throw "Hmmm... I received a point of a line I don't know...";
				}
				addPoint(line, data.x, data.y);
				break;
			case "endline":
				delete lines[data.line];
		}
	}

	function pressHandler (ev) {
		curLine = createLine();
		socket.emit('broadcast', {
			'type' : 'newLine',
			'id' : curLine.id
		});
		ev.preventDefault();
		return false;
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
svg.addEventListener("mousemove", moveHandler);
//svg.addEventListener("touchmove", moveHandler);

function releaseHandler (){
	curLine = null;
	return false;
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
		if (!id) id = Tools.generateUID("line");
		line.id = id;
		svg.appendChild(line);
		return line;
	}

})(); //End of code isolation
