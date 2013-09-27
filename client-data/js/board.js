var Tools = {};
Tools.svg = document.getElementById("canvas");
Tools.socket = io.connect('');
Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

Tools.add = function (newTool) {
	if (newTool.name in Tools.list) {
		console.log("Tools.add: The tool '"+newTool.name+"' is already" +
		"in the list. Updating it...");
	}
	//Add the tool to the list
	Tools.list[newTool.name] = newTool;
}

Tools.change = function (toolName){
	//There is not necessarily already a curTool
	if (Tools.curTool) {
		//Remove the old event listeners
		for (var event in Tools.curTool.listeners) {
			var listener = Tools.curTool.listeners[event];
			Tools.svg.removeEventListener(event, listener);
		}
	}
	//Add the new event listeners
	for (var event in newtool.listeners) {
		var listener = newtool.listeners[event];
		Tools.svg.addEventListener(event, listener);
	}
	Tools.curTool = Tools.list[toolName];
}

Tools.drawAndSend = function (data) {
	Tools.curTool.draw(data);
	Tools.socket.emit('broadcast', {
			'tool' : curTool.name,
			'data' : data
	});
}

Tools.socket.on("broadcast", function (message){
	var tool = Tools.list[message.tool];
	if (tool) {
		tool.draw(message.data);
	}
});

/**
 What does a "tool" object look like?
 newtool = {
 	"name" : "SuperTool",
 	"listeners" : {
 		"mousedown" : function(x){...},
 		"mousemove" : function(x){...}
 	},
 	"draw" : function(data){
 		//Print the data on Tools.svg
 	}
 }


*/

(function(){
	var pen = {
		"name" : "pen"
	}; //pen is a tool
})();

var socket = io.connect('');

socket.on('broadcast', function (data) {
	switch(data.type) {
		case "newLine":
			createLine(data.id);
			break;
		case "point":		
			var line = svg.getElementById(data.line);
			if (!line) {
				throw "Hmmm... I received a point of a line I don't know...";
			}
			addPoint(line, data.x, data.y);
			break;
	}
});


var svg = document.getElementById("canvas");
	curLine = null;

svg.width.baseVal.value = document.body.clientWidth;
svg.height.baseVal.value = document.body.clientHeight;

var lastTime = performance.now();

function pressHandler (ev) {
	curLine = createLine();
	socket.emit('broadcast', {
		'type' : 'newLine',
		'id' : curLine.id
	});
	ev.preventDefault();
	return false;
}
svg.addEventListener("mousedown", pressHandler);
//svg.addEventListener("touchstart", pressHandler);

function moveHandler (ev){
	if (curLine !== null &&
		performance.now() - lastTime > 50) {
		var x = ev.clientX + window.scrollX;
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

	if (x > svg.width.baseVal.value - 100) {
		svg.width.baseVal.value = x + 1000;
	}
	if (y > svg.height.baseVal.value - 100) {
		svg.height.baseVal.value = y + 1000;
	}
}

function createLine(id) {
	var line = document.createElementNS(svg.namespaceURI, "polyline");
	if (!id) id = generateUID("line");
	line.id = id;
	svg.appendChild(line);
	return line;
}

function generateUID(prefix, suffix) {
	var rndStr = (Math.round(Math.random()*1e19)).toString(36);
	if (prefix) rndStr = prefix + rndStr;
	if (suffix) rndStr = rndStr + suffix;
	return rndStr;
}
