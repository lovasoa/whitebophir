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

const delay = t => new Promise(resolve => setTimeout(resolve, t));

var Tools = {};

Tools.i18n = (function i18n() {
	var translations = JSON.parse(document.getElementById("translations").text);
	return {
		"t": function translate(s) {
			var key = s.toLowerCase().replace(/ /g, '_');
			return translations[key] || s;
		}
	};
})();

Tools.server_config = JSON.parse(document.getElementById("configuration").text);

Tools.board = document.getElementById("board");
Tools.svg = document.getElementById("canvas");
Tools.svg.style.backgroundColor = "white"; // set the default, which can be toggled
Tools.drawingArea = Tools.svg.getElementById("drawingArea");

//Initialization
Tools.curTool = null;
Tools.drawingEvent = true;
Tools.showMarker = true;
Tools.showOtherCursors = true;
Tools.showMyCursor = true;

Tools.isIE = /MSIE|Trident/.test(window.navigator.userAgent);

if (window.location.pathname.includes("/robotboards/")) {
	document.getElementById("menu").style.display = "none";
}
(function setupRobotTools() {
	Tools.robotTools = RobotTools;
	btn = document.getElementById("collabWhiteboard");
	if (btn) {
		btn.addEventListener("click", onTogglePageClick);
	}
	btn = document.getElementById("collabStation");
	if (btn) {
		btn.addEventListener("click", onTogglePageClick);
	}
	btn = document.getElementById("buttonBack");
	if (btn) {
		btn.addEventListener("click", onTogglePageClick);
	}
	btn = document.getElementById("buttonCapture");
	if (btn) {
		btn.addEventListener("click", onCaptureClick);
	}
	btn = document.getElementById("buttonMarkers");
	if (btn) {
		btn.addEventListener("click", onMarkersClick);
	}
	btn = document.getElementById("buttonBlack");
	if (btn) {
		btn.addEventListener("click", onBlackClick);
	}
	btn = document.getElementById("buttonClearOverlay");
	if (btn) {
		btn.addEventListener("click", onClearOverlayClick);
	}
	btn = document.getElementById("buttonToggleBgnd");
	if (btn) {
		btn.addEventListener("click", onToggleBgndClick);
	}
	btn = document.getElementById("buttonWhiteboard");
	if (btn) {
		btn.addEventListener("click", onDriveClick);
	}
	btn = document.getElementById("buttonStation1");
	if (btn) {
		btn.addEventListener("click", onDriveClick);
	}
	btn = document.getElementById("buttonStation2");
	if (btn) {
		btn.addEventListener("click", onDriveClick);
	}
	
	window.addEventListener('resize', (e)=>{
		setBoardScale();
	});
})();

function onTogglePageClick(e) {
	let id = e.target.id;
	console.log(`page toggle clicked: ${id}`);
	if(id =="buttonBack"){
		console.log("Show home page");
		document.getElementById("homePageContainer").style.display = "grid"
		document.getElementById("boardContainer").style.display = "none"
	}else{
		console.log("Show board");
		document.getElementById("homePageContainer").style.display = "none"
		document.getElementById("boardContainer").style.display = "grid"
	}
}

// set scale to fit the board width to the window width
function setBoardScale(){
	boardAreaScale = window.innerWidth / Tools.svg.width.baseVal.value;
	console.log(`window width: ${window.innerWidth} boardAreaScale factor: ${boardAreaScale} svg width: ${Tools.svg.width.baseVal.value}`);
	Tools.setScale(boardAreaScale);
}
/*
// It seems the chromium browser in the robot doesn't like "async" keyword, it throws an
// exception for this.
async function onCaptureClick() {
	console.log("MARKD capture clicked");
	Tools.send({type:"robotmessage", msg:"showmarkers"},"robotTool");
	await delay(5000);
	Tools.send({type:"robotmessage", msg:"showblack"},"robotTool");
	await delay(5000);
	Tools.send({type:"robotmessage", msg:"clearoverlay"},"robotTool");
	document.getElementById("canvas").style.backgroundImage = "url('background_whiteboard.jpg')";
}*/
function onCaptureClick() {
	console.log("MARKD capture clicked");
	Tools.send({type:"robotmessage", msg:"showmarkers"},"robotTool");
	delay(1500).then(()=>{
		Tools.send({type:"robotmessage", msg:"showblack"},"robotTool");
		return delay(1500);
	}).then(()=>{
		Tools.send({type:"robotmessage", msg:"clearoverlay"},"robotTool");
		return delay(1500);
	}).then(()=>{
		updateWhiteboardSnapshot();
	});
}

function onMarkersClick() {
	console.log("MARKD markers clicked");
	Tools.send({type:"robotmessage", msg:"showmarkers"},"robotTool");
}

function onBlackClick() {
	console.log("MARKD black clicked");
	Tools.send({type:"robotmessage", msg:"showblack"},"robotTool");
}

/**
 * Fetch a file from the URL, convert it into a dataURL
 * @param {string} fileurl 
 * @param {function} callback 
 */
function getDataURLfromFile(fileurl, callback) {
	var xhr = new XMLHttpRequest();       
	xhr.open("GET", fileurl, true); 
	xhr.responseType = "blob";
	xhr.onload = function (e) {
		//console.log(this.response);
		var reader = new FileReader();
		reader.onload = function(event) {
			var dataurl = event.target.result;
			//console.log(dataurl)
			if (callback) callback(dataurl);
		}
		var file = this.response;
		reader.readAsDataURL(file)
	};
	xhr.send()
}

/**
 * Fetch the latest whiteboard snapshot from the server. Put the image into
 * our local svg drawing area as a dataURL so it is included in the downloaded
 * SVG file when the user clicks the download button.
 * This updates only the local user's view. Other users of the same board do
 * not get this updated whiteboard snapshot, and the snapshot image is not included
 * in the board data saved on the server.
 */
function updateWhiteboardSnapshot() {
	// Use a unique number to make sure the image isn't cached anywhere
	const num = new Date().getTime();
	const imageurl = `background_whiteboard.jpg?unique=${num}`;
	getDataURLfromFile(imageurl, (dataurl) => {
		// This code is very similar to document.js for adding a new image
		var xlinkNS = "http://www.w3.org/1999/xlink";
		var img = Tools.createSVGElement("image");
		img.id="whiteboard_snapshot";
		img.setAttribute("class", "layer-"+Tools.layer); // is this necessary?
		img.setAttributeNS(xlinkNS, "href", dataurl);
		// Assume the image is same size as the drawing area
		img.x.baseVal.value = 0;
		img.y.baseVal.value = 0;
		img.setAttribute("width", Tools.svg.width.baseVal.value);
		img.setAttribute("height", Tools.svg.height.baseVal.value);
		//Remove any previous image, there should be only one whiteboard background image
		elem = Tools.svg.getElementById(img.id);
		if (elem) Tools.drawingArea.removeChild(elem);
		// Put the image at the beginning, so it is behind all the annotations
		Tools.drawingArea.insertBefore(img, Tools.drawingArea.firstChild);
	});
}

function onClearOverlayClick() {
	Tools.send({type:"robotmessage", msg:"clearoverlay"},"robotTool");
}

function onToggleBgndClick() {
	var bgnd = Tools.svg.style.backgroundColor;
	var newcolor = "white";
	if (bgnd == "white") newcolor = "black";
	Tools.svg.style.backgroundColor = newcolor;
	console.log(`Toggle Background to ${newcolor}`);
	Tools.send({type:"robotmessage", msg:`bgnd-${newcolor}`},"robotTool");
}

robotRooms = {
	"buttonStation1": "Station 1",
	"buttonStation2": "Station 2",
	"buttonStation3": "Station 3",
	"buttonWhiteboard": "Whiteboard",
};
function onDriveClick(e) {
	let id = e.target.id;
	console.log(`drive clicked: ${id}`);
	Tools.robotTools.goToRoom(robotRooms[id]);
}

Tools.socket = null;
Tools.connect = function () {
	var self = this;

	// Destroy socket if one already exists
	if (self.socket) {
		self.socket.destroy();
		delete self.socket;
		self.socket = null;
	}

	var url = new URL(window.location);
	var params = new URLSearchParams(url.search);

	var sockethost;
	if (window.location.pathname.includes("/robotboards/"))
		sockethost = window.location.pathname.split("/robotboards/")[0];
	else
		sockethost = window.location.pathname.split("/boards/")[0];
	var socket_params = {
		//"path": window.location.pathname.split("/boards/")[0] + "/socket.io",
		"path": sockethost + "/socket.io",
		"reconnection": true,
		"reconnectionDelay": 100, //Make the xhr connections as fast as possible
		"timeout": 1000 * 60 * 20 // Timeout after 20 minutes
	}
	if(params.has("token")) {
		socket_params.query = "token=" + params.get("token");
	}

	this.socket = io.connect('', socket_params);

	//Receive draw instructions from the server
	this.socket.on("broadcast", function (msg) {
		handleMessage(msg).finally(function afterload() {
			var loadingEl = document.getElementById("loadingMessage");
			loadingEl.classList.add("hidden");
		});
	});

	this.socket.on("reconnect", function onReconnection() {
		Tools.socket.emit('joinboard', Tools.boardName);
	});
};

Tools.connect();

Tools.boardName = (function () {
	var path = window.location.pathname.split("/");
	return decodeURIComponent(path[path.length - 1]);
})();

//Get the board as soon as the page is loaded
Tools.socket.emit("getboard", Tools.boardName);

function saveBoardNametoLocalStorage() {
	var boardName = Tools.boardName;
	if (boardName.toLowerCase() === 'anonymous') return;
	var recentBoards, key = "recent-boards";
	try {
		recentBoards = JSON.parse(localStorage.getItem(key));
		if (!Array.isArray(recentBoards)) throw new Error("Invalid type");
	} catch(e) {
		// On localstorage or json error, reset board list
		recentBoards = [];
		console.log("Board history loading error", e);
	}
	recentBoards = recentBoards.filter(function (name) {
		return name !== boardName;
	});
	recentBoards.unshift(boardName);
	recentBoards = recentBoards.slice(0, 20);
	localStorage.setItem(key, JSON.stringify(recentBoards));
}
// Refresh recent boards list on each page show
window.addEventListener("pageshow", saveBoardNametoLocalStorage);

Tools.HTML = {
	template: new Minitpl("#tools > .tool"),
	addShortcut: function addShortcut(key, callback) {
		window.addEventListener("keydown", function (e) {
			if (e.key === key && !e.target.matches("input[type=text], textarea")) {
				callback();
			}
		});
	},
	addTool: function (toolName, toolIcon, toolIconHTML, toolShortcut, oneTouch) {
		var callback = function () {
			Tools.change(toolName);
		};
		this.addShortcut(toolShortcut, function () {
			Tools.change(toolName);
			document.activeElement.blur && document.activeElement.blur();
		});
		return this.template.add(function (elem) {
			elem.addEventListener("click", callback);
			elem.id = "toolID-" + toolName;
			elem.getElementsByClassName("tool-name")[0].textContent = Tools.i18n.t(toolName);
			var toolIconElem = elem.getElementsByClassName("tool-icon")[0];
			toolIconElem.src = toolIcon;
			toolIconElem.alt = toolIcon;
			if (oneTouch) elem.classList.add("oneTouch");
			elem.title =
				Tools.i18n.t(toolName) + " (" +
				Tools.i18n.t("keyboard shortcut") + ": " +
				toolShortcut + ")" +
				(Tools.list[toolName].secondary ? " [" + Tools.i18n.t("click_to_toggle") + "]" : "");
			if (Tools.list[toolName].secondary) {
				elem.classList.add('hasSecondary');
				var secondaryIcon = elem.getElementsByClassName('secondaryIcon')[0];
				secondaryIcon.src = Tools.list[toolName].secondary.icon;
				toolIconElem.classList.add("primaryIcon");
			}
		});
	},
	changeTool: function (oldToolName, newToolName) {
		var oldTool = document.getElementById("toolID-" + oldToolName);
		var newTool = document.getElementById("toolID-" + newToolName);
		if (oldTool) oldTool.classList.remove("curTool");
		if (newTool) newTool.classList.add("curTool");
	},
	toggle: function (toolName, name, icon) {
		var elem = document.getElementById("toolID-" + toolName);

		// Change secondary icon
		var primaryIcon = elem.getElementsByClassName("primaryIcon")[0];
		var secondaryIcon = elem.getElementsByClassName("secondaryIcon")[0];
		var primaryIconSrc = primaryIcon.src;
		var secondaryIconSrc = secondaryIcon.src;
		primaryIcon.src = secondaryIconSrc;
		secondaryIcon.src = primaryIconSrc;

		// Change primary icon
		elem.getElementsByClassName("tool-icon")[0].src = icon;
		elem.getElementsByClassName("tool-name")[0].textContent = Tools.i18n.t(name);
	},
	addStylesheet: function (href) {
		//Adds a css stylesheet to the html or svg document
		var link = document.createElement("link");
		link.href = href;
		link.rel = "stylesheet";
		link.type = "text/css";
		document.head.appendChild(link);
	},
	colorPresetTemplate: new Minitpl("#colorPresetSel .colorPresetButton"),
	addColorButton: function (button) {
		var setColor = Tools.setColor.bind(Tools, button.color);
		if (button.key) this.addShortcut(button.key, setColor);
		return this.colorPresetTemplate.add(function (elem) {
			elem.addEventListener("click", setColor);
			elem.id = "color_" + button.color.replace(/^#/, '');
			elem.style.backgroundColor = button.color;
			if (button.key) {
				elem.title = Tools.i18n.t("keyboard shortcut") + ": " + button.key;
			}
		});
	}
};

Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

Tools.isBlocked = function toolIsBanned(tool) {
	if (tool.name.includes(",")) throw new Error("Tool Names must not contain a comma");
	return Tools.server_config.BLOCKED_TOOLS.includes(tool.name);
};

/**
 * Register a new tool, without touching the User Interface
 */
Tools.register = function registerTool(newTool) {
	if (Tools.isBlocked(newTool)) return;

	if (newTool.name in Tools.list) {
		console.log("Tools.add: The tool '" + newTool.name + "' is already" +
			"in the list. Updating it...");
	}

	//Format the new tool correctly
	Tools.applyHooks(Tools.toolHooks, newTool);

	//Add the tool to the list
	Tools.list[newTool.name] = newTool;

	// Register the change handlers
	if (newTool.onSizeChange) Tools.sizeChangeHandlers.push(newTool.onSizeChange);

	//There may be pending messages for the tool
	var pending = Tools.pendingMessages[newTool.name];
	if (pending) {
		console.log("Drawing pending messages for '%s'.", newTool.name);
		var msg;
		while (msg = pending.shift()) {
			//Transmit the message to the tool (precising that it comes from the network)
			newTool.draw(msg, false);
		}
	}
};

/**
 * Add a new tool to the user interface
 */
Tools.add = function (newTool) {
	if (Tools.isBlocked(newTool)) return;

	Tools.register(newTool);

	if (newTool.stylesheet) {
		Tools.HTML.addStylesheet(newTool.stylesheet);
	}

	//Add the tool to the GUI
	Tools.HTML.addTool(newTool.name, newTool.icon, newTool.iconHTML, newTool.shortcut, newTool.oneTouch);
};

Tools.change = function (toolName) {
	var newTool = Tools.list[toolName];
	var oldTool = Tools.curTool;
	if (!newTool) throw new Error("Trying to select a tool that has never been added!");
	if (newTool === oldTool) {
		if (newTool.secondary) {
			newTool.secondary.active = !newTool.secondary.active;
			var props = newTool.secondary.active ? newTool.secondary : newTool;
			Tools.HTML.toggle(newTool.name, props.name, props.icon);
			if (newTool.secondary.switch) newTool.secondary.switch();
		}
		return;
	}
	if (!newTool.oneTouch) {
		//Update the GUI
		var curToolName = (Tools.curTool) ? Tools.curTool.name : "";
		try {
			Tools.HTML.changeTool(curToolName, toolName);
		} catch (e) {
			console.error("Unable to update the GUI with the new tool. " + e);
		}
		Tools.svg.style.cursor = newTool.mouseCursor || "auto";
		Tools.board.title = Tools.i18n.t(newTool.helpText || "");

		//There is not necessarily already a curTool
		if (Tools.curTool !== null) {
			//It's useless to do anything if the new tool is already selected
			if (newTool === Tools.curTool) return;

			//Remove the old event listeners
			Tools.removeToolListeners(Tools.curTool);

			//Call the callbacks of the old tool
			Tools.curTool.onquit(newTool);
		}

		//Add the new event listeners
		Tools.addToolListeners(newTool);
		Tools.curTool = newTool;
	}

	//Call the start callback of the new tool
	newTool.onstart(oldTool);
};

Tools.addToolListeners = function addToolListeners(tool) {
	for (var event in tool.compiledListeners) {
		var listener = tool.compiledListeners[event];
		var target = listener.target || Tools.board;
		target.addEventListener(event, listener, { 'passive': false });
	}
};

Tools.removeToolListeners = function removeToolListeners(tool) {
	for (var event in tool.compiledListeners) {
		var listener = tool.compiledListeners[event];
		var target = listener.target || Tools.board;
		target.removeEventListener(event, listener);
		// also attempt to remove with capture = true in IE
		if (Tools.isIE) target.removeEventListener(event, listener, true);
	}
};

(function () {
	// Handle secondary tool switch with shift (key code 16)
	function handleShift(active, evt) {
		if (evt.keyCode === 16 && Tools.curtool && Tools.curTool.secondary && Tools.curTool.secondary.active !== active) {
			Tools.change(Tools.curTool.name);
		}
	}
	window.addEventListener("keydown", handleShift.bind(null, true));
	window.addEventListener("keyup", handleShift.bind(null, false));
})();

Tools.send = function (data, toolName) {
	toolName = toolName || Tools.curTool.name;
	var d = data;
	d.tool = toolName;
	Tools.applyHooks(Tools.messageHooks, d);
	var message = {
		"board": Tools.boardName,
		"data": d
	};
	Tools.socket.emit('broadcast', message);
};

Tools.drawAndSend = function (data, tool) {
	if (tool == null) tool = Tools.curTool;
	tool.draw(data, true);
	Tools.send(data, tool.name);
};

// kind of a hack to log messages on the server, for troubleshooting
Tools.logToServer = function (logobj) {
	Tools.send({type:"robotmessage", msg:"log", logobj:logobj},"robotTool");
}

//Object containing the messages that have been received before the corresponding tool
//is loaded. keys : the name of the tool, values : array of messages for this tool
Tools.pendingMessages = {};

function messageForRobotTool(message) {
	console.log("MARKD got robotTool msg", message);
	const m = message.msg;
	const img = document.getElementById("fullimage");
	if (m == "showblack") {
		if (img) {
			img.src = "black.png"
			img.style.display = "block";
		}
	}
	if (m == "showmarkers") {
		if (img) {
			img.src = "aruco_markers.png"
			img.style.display = "block";
		}
	}
	if (m == "clearoverlay") {
		if (img) {
			img.style.display = "none";
		}
	}
	if (m == "bgnd-black") {
		Tools.svg.style.backgroundColor = "black";
	}
	if (m == "bgnd-white") {
		Tools.svg.style.backgroundColor = "white";
	}
}

// Send a message to the corresponding tool
function messageForTool(message) {
	var name = message.tool,
		tool = Tools.list[name];
	if (name != "Cursor" && message.type != "child" && message.type != "update")
		console.log(`messageForTool: ${name}`);
	if (name == "robotTool") {
		messageForRobotTool(message);
		return;
	}
	if (tool) {
		Tools.applyHooks(Tools.messageHooks, message);
		tool.draw(message, false);
	} else {
		///We received a message destinated to a tool that we don't have
		//So we add it to the pending messages
		if (!Tools.pendingMessages[name]) Tools.pendingMessages[name] = [message];
		else Tools.pendingMessages[name].push(message);
	}

	if (message.tool !== 'Hand' && message.transform != null) {
		//this message has special info for the mover
	    messageForTool({ tool: 'Hand', type: 'update', transform: message.transform, id: message.id});
	}
}

// Apply the function to all arguments by batches
function batchCall(fn, args) {
	var BATCH_SIZE = 1024;
	if (args.length === 0) {
		return Promise.resolve();
	} else {
		var batch = args.slice(0, BATCH_SIZE);
		var rest = args.slice(BATCH_SIZE);
		return Promise.all(batch.map(fn))
			.then(function () {
				return new Promise(requestAnimationFrame);
			}).then(batchCall.bind(null, fn, rest));
	}
}

// Call messageForTool recursively on the message and its children
function handleMessage(message) {
	//Check if the message is in the expected format
	if (!message.tool && !message._children) {
		console.error("Received a badly formatted message (no tool). ", message);
	}
	if (message.tool) messageForTool(message);
	if (message._children) return batchCall(handleMessage, message._children);
	else return Promise.resolve();
}

Tools.unreadMessagesCount = 0;
Tools.newUnreadMessage = function () {
	Tools.unreadMessagesCount++;
	updateDocumentTitle();
};

window.addEventListener("focus", function () {
	Tools.unreadMessagesCount = 0;
	updateDocumentTitle();
});

function updateDocumentTitle() {
	document.title =
		(Tools.unreadMessagesCount ? '(' + Tools.unreadMessagesCount + ') ' : '') +
		Tools.boardName +
		" | WBO";
}

(function () {
	// Scroll and hash handling
	var scrollTimeout, lastStateUpdate = Date.now();

	window.addEventListener("scroll", function onScroll() {
		var scale = Tools.getScale();
		var x = document.documentElement.scrollLeft / scale,
			y = document.documentElement.scrollTop / scale;

		clearTimeout(scrollTimeout);
		scrollTimeout = setTimeout(function updateHistory() {
			var hash = '#' + (x | 0) + ',' + (y | 0) + ',' + Tools.getScale().toFixed(1);
			if (Date.now() - lastStateUpdate > 5000 && hash !== window.location.hash) {
				window.history.pushState({}, "", hash);
				lastStateUpdate = Date.now();
			} else {
				window.history.replaceState({}, "", hash);
			}
		}, 100);
	});

	function setScrollFromHash() {
		//MARKD skip this, keep the board scaled to fit the window width
		return;
		var coords = window.location.hash.slice(1).split(',');
		var x = coords[0] | 0;
		var y = coords[1] | 0;
		var scale = parseFloat(coords[2]);
		resizeCanvas({ x: x, y: y });
		Tools.setScale(scale);
		window.scrollTo(x * scale, y * scale);
	}

	window.addEventListener("hashchange", setScrollFromHash, false);
	window.addEventListener("popstate", setScrollFromHash, false);
	window.addEventListener("DOMContentLoaded", setScrollFromHash, false);
})();

function resizeCanvas(m) {
	// MARKD do not resize
	return;
	//Enlarge the canvas whenever something is drawn near its border
	var x = m.x | 0, y = m.y | 0
	var MAX_BOARD_SIZE = Tools.server_config.MAX_BOARD_SIZE || 65536; // Maximum value for any x or y on the board
	//console.log("MARKD resizeCanvas");
	if (x > Tools.svg.width.baseVal.value - 2000) {
		Tools.svg.width.baseVal.value = Math.min(x + 2000, MAX_BOARD_SIZE);
		console.log(`MARKD new svg width: ${Tools.svg.width.baseVal.value}`);
	}
	if (y > Tools.svg.height.baseVal.value - 2000) {
		Tools.svg.height.baseVal.value = Math.min(y + 2000, MAX_BOARD_SIZE);
	}
}

function updateUnreadCount(m) {
	if (document.hidden && ["child", "update"].indexOf(m.type) === -1) {
		Tools.newUnreadMessage();
	}
}

// List of hook functions that will be applied to messages before sending or drawing them
Tools.messageHooks = [resizeCanvas, updateUnreadCount];

Tools.scale = 1.0;
var scaleTimeout = null;
Tools.setScale = function setScale(scale) {
	var fullScale = Math.max(window.innerWidth, window.innerHeight) / Tools.server_config.MAX_BOARD_SIZE;
	var minScale = Math.max(0.1, fullScale);
	var maxScale = 10;
	if (isNaN(scale)) scale = 1;
	scale = Math.max(minScale, Math.min(maxScale, scale));
	Tools.svg.style.willChange = 'transform';
	Tools.svg.style.transform = 'scale(' + scale + ')';
	clearTimeout(scaleTimeout);
	scaleTimeout = setTimeout(function () {
		Tools.svg.style.willChange = 'auto';
	}, 1000);
	Tools.scale = scale;
	return scale;
}
Tools.getScale = function getScale() {
	return Tools.scale;
}

//List of hook functions that will be applied to tools before adding them
Tools.toolHooks = [
	function checkToolAttributes(tool) {
		if (typeof (tool.name) !== "string") throw "A tool must have a name";
		if (typeof (tool.listeners) !== "object") {
			tool.listeners = {};
		}
		if (typeof (tool.onstart) !== "function") {
			tool.onstart = function () { };
		}
		if (typeof (tool.onquit) !== "function") {
			tool.onquit = function () { };
		}
	},
	function compileListeners(tool) {
		//compile listeners into compiledListeners
		var listeners = tool.listeners;

		//A tool may provide precompiled listeners
		var compiled = tool.compiledListeners || {};
		tool.compiledListeners = compiled;

		function compile(listener) { //closure
			return (function listen(evt) {
				var x = evt.pageX / Tools.getScale(),
					y = evt.pageY / Tools.getScale();
				return listener(x, y, evt, false);
			});
		}

		function compileTouch(listener) { //closure
			return (function touchListen(evt) {
				//Currently, we don't handle multitouch
				if (evt.changedTouches.length === 1) {
					//evt.preventDefault();
					var touch = evt.changedTouches[0];
					var x = touch.pageX / Tools.getScale(),
						y = touch.pageY / Tools.getScale();
					return listener(x, y, evt, true);
				}
				return true;
			});
		}

		function wrapUnsetHover(f, toolName) {
			return (function unsetHover(evt) {
				document.activeElement && document.activeElement.blur && document.activeElement.blur();
				return f(evt);
			});
		}

		if (listeners.press) {
			compiled["mousedown"] = wrapUnsetHover(compile(listeners.press), tool.name);
			compiled["touchstart"] = wrapUnsetHover(compileTouch(listeners.press), tool.name);
		}
		if (listeners.move) {
			compiled["mousemove"] = compile(listeners.move);
			compiled["touchmove"] = compileTouch(listeners.move);
		}
		if (listeners.release) {
			var release = compile(listeners.release),
				releaseTouch = compileTouch(listeners.release);
			compiled["mouseup"] = release;
			if (!Tools.isIE) compiled["mouseleave"] = release;
			compiled["touchleave"] = releaseTouch;
			compiled["touchend"] = releaseTouch;
			compiled["touchcancel"] = releaseTouch;
		}
	}
];

Tools.applyHooks = function (hooks, object) {
	//Apply every hooks on the object
	hooks.forEach(function (hook) {
		hook(object);
	});
};


// Utility functions

Tools.generateUID = function (prefix, suffix) {
	var uid = Date.now().toString(36); //Create the uids in chronological order
	uid += (Math.round(Math.random() * 36)).toString(36); //Add a random character at the end
	if (prefix) uid = prefix + uid;
	if (suffix) uid = uid + suffix;
	return uid;
};

Tools.createSVGElement = function createSVGElement(name, attrs) {
	var elem = document.createElementNS(Tools.svg.namespaceURI, name);
	if (typeof (attrs) !== "object") return elem;
	Object.keys(attrs).forEach(function (key, i) {
		elem.setAttributeNS(null, key, attrs[key]);
	});
	return elem;
};

Tools.positionElement = function (elem, x, y) {
	elem.style.top = y + "px";
	elem.style.left = x + "px";
};

Tools.colorPresets = [
	{ color: "#001f3f", key: '1' },
	{ color: "#FF4136", key: '2' },
	{ color: "#0074D9", key: '3' },
	{ color: "#FF851B", key: '4' },
	{ color: "#FFDC00", key: '5' },
	{ color: "#3D9970", key: '6' },
	{ color: "#91E99B", key: '7' },
	{ color: "#90468b", key: '8' },
	{ color: "#7FDBFF", key: '9' },
	{ color: "#AAAAAA", key: '0' },
	{ color: "#E65194" }
];

Tools.color_chooser = document.getElementById("chooseColor");

Tools.setColor = function (color) {
	Tools.color_chooser.value = color;
};

Tools.getColor = (function color() {
	//var color_index = (Math.random() * Tools.colorPresets.length) | 0;
	var color_index = 0;
	var initial_color = Tools.colorPresets[color_index].color;
	Tools.setColor(initial_color);
	return function () { return Tools.color_chooser.value; };
})();

Tools.colorPresets.forEach(Tools.HTML.addColorButton.bind(Tools.HTML));

Tools.sizeChangeHandlers = [];
Tools.setSize = (function size() {
	var chooser = document.getElementById("chooseSize");

	function update() {
		var size = Math.max(1, Math.min(50, chooser.value | 0));
		chooser.value = size;
		Tools.sizeChangeHandlers.forEach(function (handler) {
			handler(size);
		});
	}
	update();

	chooser.onchange = chooser.oninput = update;
	return function (value) {
		if (value !== null && value !== undefined) { chooser.value = value; update(); }
		return parseInt(chooser.value);
	};
})();

Tools.getSize = (function () { return Tools.setSize() });

Tools.getOpacity = (function opacity() {
	return function () {return 1;}; //MARKD remove opacity tool
	var chooser = document.getElementById("chooseOpacity");
	var opacityIndicator = document.getElementById("opacityIndicator");

	function update() {
		opacityIndicator.setAttribute("opacity", chooser.value);
	}
	update();

	chooser.onchange = chooser.oninput = update;
	return function () {
		return Math.max(0.1, Math.min(1, chooser.value));
	};
})();


//Scale the canvas on load
//Tools.svg.width.baseVal.value = document.body.clientWidth;
//Tools.svg.height.baseVal.value = document.body.clientHeight;
console.log(`MARKD body.clientWidth: ${document.body.clientWidth}`);

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


(function () {
    var pos = {top: 0, scroll:0};
    var menu = document.getElementById("menu");
    function menu_mousedown(evt) {
	pos = {
	    top: menu.scrollTop,
	    scroll: evt.clientY
	}
	menu.addEventListener("mousemove", menu_mousemove);
	document.addEventListener("mouseup", menu_mouseup);
    }
    function menu_mousemove(evt) {
	var dy = evt.clientY - pos.scroll;
	menu.scrollTop = pos.top - dy;
    }
    function menu_mouseup(evt) {
	menu.removeEventListener("mousemove", menu_mousemove);
	document.removeEventListener("mouseup", menu_mouseup);
    }
    menu.addEventListener("mousedown", menu_mousedown);
})()

setBoardScale();
