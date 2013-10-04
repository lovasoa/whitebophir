var Tools = {};
Tools.svg = document.getElementById("canvas");
Tools.socket = io.connect('');
Tools.HTML = {
	template : new Minitpl("#tools > .tool"),
	addTool : function(toolName) {
		var callback = function () {
			Tools.change(toolName);
		};
		return this.template.add({
			"a" : function (elem) {
				elem.addEventListener("click", callback);
				elem.id = "toolID-"+toolName;
				return toolName;
			}
		});
	}
}
Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

Tools.add = function (newTool) {
	if (newTool.name in Tools.list) {
		console.log("Tools.add: The tool '"+newTool.name+"' is already" +
		"in the list. Updating it...");
	}
	//Add the tool to the list
	Tools.list[newTool.name] = newTool;

	//Add the tool to the GUI
	Tools.HTML.addTool(newTool.name);
}

Tools.change = function (toolName){
	if (! (toolName in Tools.list)) {
		throw "Trying to select a tool that has never been added!";
	}
	var newtool = Tools.list[toolName];

	//There is not necessarily already a curTool
	if (Tools.curTool) {
		//It's useless to do anything if the new tool is already selected
		if (newtool === curTool) return;

		//Remove the old event listeners
		for (var event in Tools.curTool.compiledListeners) {
			var listener = Tools.curTool.compiledListeners[event];
			Tools.svg.removeEventListener(event, listener);
		}
	}

	//Add the new event listeners
	for (var event in newtool.compiledListeners) {
		var listener = newtool.compiledListeners[event];
		Tools.svg.addEventListener(event, listener);
	}
	
	//Call the callbacks of the new and the old tool
	Tools.curTool.onquit(newtool);
	newtool.onstart(Tools.curTool);

	Tools.curTool = newtool;
}

Tools.drawAndSend = function (data) {
	Tools.curTool.draw(data);
	var message = {
			'tool' : curTool.name,
			'data' : data
	};
	Tools.applyHooks(Tools.messageHooks, message);
	Tools.socket.emit('broadcast', message);
}

Tools.socket.on("broadcast", function (message){
	//Check if the message is in the expected format
	Tools.applyHooks(Tools.messageHooks, message);
	if (message.tool && message.data) {
		var tool = Tools.list[message.tool];
		if (!tool) throw "Received a message for an unknown tool!";
		tool.draw(message.data);
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
			return (function(evt){
					var x = ev.clientX + window.scrollX,
						y = ev.clientY + window.scrollY;
					listener(x,y,evt);
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
}


Tools.generateUID = function (prefix, suffix) {
	var rndStr = (Math.round(Math.random()*1e19)).toString(36);
	if (prefix) rndStr = prefix + rndStr;
	if (suffix) rndStr = rndStr + suffix;
	return rndStr;
}

Tools.svg.width.baseVal.value = document.body.clientWidth;
Tools.svg.height.baseVal.value = document.body.clientHeight;

/**
 What does a "tool" object look like?
 newtool = {
 	"name" : "SuperTool",
 	"listeners" : {
 		"press" : function(x,y,evt){...},
 		"move" : function(x,y,evt){...},
  		"release" : function(x,y,evt){...},
 	},
 	"draw" : function(data){
 		//Print the data on Tools.svg
 	},
 	"onstart" : function(oldTool){...},
 	"onquit" : function(newTool){...},
}
*/
