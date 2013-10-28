var Tools = {};

Tools.board = document.getElementById("board");
Tools.svg = document.getElementById("canvas");
Tools.socket = io.connect('');
Tools.curTool = null;

Tools.HTML = {
	template : new Minitpl("#tools > .tool"),
	addTool : function(toolName) {
		var callback = function () {
			Tools.change(toolName);
		};
		return this.template.add(function (elem) {
				elem.addEventListener("click", callback);
				elem.id = "toolID-"+toolName;
				return toolName;
			}
		);
	},
	changeTool : function(oldToolName, newToolName) {
		var oldTool = document.getElementById("toolID-"+oldToolName);
		var newTool = document.getElementById("toolID-"+newToolName);
		if (oldTool) oldTool.classList.remove("curTool");
		if (newTool) newTool.classList.add("curTool");
	},
	addStylesheet : function(href) {
		//Adds a css stylesheet to the html or svg document
		var link = document.createElement("link");
		link.href = href;
		link.rel = "stylesheet";
		link.type = "text/css";
		document.head.appendChild(link);
	}
};

Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

Tools.add = function (newTool) {
	if (newTool.name in Tools.list) {
		console.log("Tools.add: The tool '"+newTool.name+"' is already" +
		"in the list. Updating it...");
	}

	//Format the new tool correctly
	Tools.applyHooks(Tools.toolHooks, newTool);

	//Add the tool to the list
	Tools.list[newTool.name] = newTool;

	if (newTool.stylesheet) {
		Tools.HTML.addStylesheet(newTool.stylesheet);
	}

	//Add the tool to the GUI
	Tools.HTML.addTool(newTool.name);
}

Tools.change = function (toolName){
	if (! (toolName in Tools.list)) {
		throw "Trying to select a tool that has never been added!";
	}

	//Update the GUI
	var curToolName = (Tools.curTool) ? Tools.curTool.name : "";
	Tools.HTML.changeTool(curToolName, toolName);

	var newtool = Tools.list[toolName];

	//There is not necessarily already a curTool
	if (Tools.curTool !== null) {
		//It's useless to do anything if the new tool is already selected
		if (newtool === Tools.curTool) return;

		//Remove the old event listeners
		for (var event in Tools.curTool.compiledListeners) {
			var listener = Tools.curTool.compiledListeners[event];
			Tools.board.removeEventListener(event, listener);
		}

		//Call the callbacks of the old tool
		Tools.curTool.onquit(newtool);
	}

	//Add the new event listeners
	for (var event in newtool.compiledListeners) {
		var listener = newtool.compiledListeners[event];
		Tools.board.addEventListener(event, listener);
	}

	//Call the start callback of the new tool 
	newtool.onstart(Tools.curTool);
	Tools.curTool = newtool;
};

Tools.send = function(data, toolName){
	var toolName = toolName || Tools.curTool.name;
	var message = {
			'tool' : toolName,
			'data' : data
	};
	Tools.applyHooks(Tools.messageHooks, message);
	Tools.socket.emit('broadcast', message);
};

Tools.drawAndSend = function (data) {
	Tools.curTool.draw(data, true);
	Tools.send(data);
};

Tools.socket.on("broadcast", function (message){
	//Check if the message is in the expected format
	Tools.applyHooks(Tools.messageHooks, message);
	if (message.tool && message.data) {
		var tool = Tools.list[message.tool];
		if (!tool) throw "Received a message for an unknown tool!";
		tool.draw(message.data, false); //draw the received data
	} else {
		throw "Received a badly formatted message";
	}
});

//List of hook functions that will be applied to messages before sending or drawing them
Tools.messageHooks = [
	function resizeCanvas (m) {
		if (m.data && m.data.x && m.data.y) {
			var svg = Tools.svg, x=m.data.x, y=m.data.y;
			if (x > svg.width.baseVal.value - 100) {
				svg.width.baseVal.value = x + 1000;
			}
			if (y > svg.height.baseVal.value - 100) {
				svg.height.baseVal.value = y + 1000;
			}
		}
	}
];

//List of hook functions that will be applied to tools before adding them
Tools.toolHooks = [
	function checkToolAttributes(tool) {
		if (typeof(tool.name)!=="string") throw "A tool must have a name";
		if (typeof(tool.listeners)!=="object") {
			tool.listeners = {};
		}
		if (typeof(tool.onstart)!=="function") {
			tool.onstart = new Function();
		}
		if (typeof(tool.onquit)!=="function") {
			tool.onquit = new Function();
		}
	},
	function compileListeners (tool) {
		//compile listeners into compiledListeners
		var listeners = tool.listeners;
		var compiled = tool.compiledListeners || {};
		tool.compiledListeners = compiled;

		function compile (listener) { //closure
			return (function listen (evt){
					var x = evt.clientX + window.scrollX,
						y = evt.clientY + window.scrollY;
					return listener(x,y,evt);
			});		
		}

		if (listeners.press) compiled.mousedown = compile(listeners.press);
		if (listeners.move) compiled.mousemove = compile(listeners.move);
		if (listeners.release) {
			var release = compile(listeners.release);
			compiled.mouseup = release;
			compiled.mouseleave = release;
		}
	}
];

Tools.applyHooks = function(hooks, object) {
	//Apply every hooks on the object
	hooks.forEach(function(hook) {
		hook(object);
	});
};


// Utility functions

Tools.generateUID = function (prefix, suffix) {
	var rndStr = (Math.round(Math.random()*1e19)).toString(36);
	if (prefix) rndStr = prefix + rndStr;
	if (suffix) rndStr = rndStr + suffix;
	return rndStr;
};

Tools.createSVGElement = function (name) {
	return document.createElementNS(Tools.svg.namespaceURI, name);
};

Tools.positionElement = function (elem, x, y) {
	elem.style.top = y+"px";
	elem.style.left = x+"px";
};

(function color (){
	var chooser = document.getElementById("chooseColor");
	function update (){
		chooser.style.backgroundColor = chooser.value;
	}
	update();
	chooser.onkeyup = chooser.onchange = update;

	Tools.getColor = function(){
		return chooser.style.backgroundColor;
	};
})();

(function size (){
	var chooser = document.getElementById("chooseSize");

	function update (){
		if (chooser.value<1 || chooser.value > 50) {
			chooser.value=3;
		}
	}
	update();

	chooser.onchange = update;
	Tools.getSize = function(){
		return chooser.value;
	};
})();

//Scale the canvas on load
Tools.svg.width.baseVal.value = document.body.clientWidth;
Tools.svg.height.baseVal.value = document.body.clientHeight;



(function menu () {
	var menu = document.getElementById("menu");
		tog = document.getElementById("toggleMenu");

	tog.onclick = function(e){
		menu.classList.toggle("closed");
	};
})();

//tools may use performance.now, but Safari doesn't support it
if (!window.performance) {
	window.performance = {
		"now" : Date.now
	}
}

/**
 What does a "tool" object look like?
 newtool = {
 	"name" : "SuperTool",
 	"listeners" : {
 		"press" : function(x,y,evt){...},
 		"move" : function(x,y,evt){...},
  		"release" : function(x,y,evt){...},
 	},
 	"draw" : function(data, isLocal){
 		//Print the data on Tools.svg
 	},
 	"onstart" : function(oldTool){...},
 	"onquit" : function(newTool){...},
 	"stylesheet" : "style.css",
}
*/
