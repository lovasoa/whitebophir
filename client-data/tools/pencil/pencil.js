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

(function () { //Code isolation

	// Allocate the full maximum server update rate to pencil messages.
	// This feels a bit risky in terms of dropped messages, but any less
	// gives terrible results with the default parameters.  In practice it
	// seems to work, either because writing tends to happen in bursts, or
	// maybe because the messages are sent when the time interval is *greater*
	// than this?
	var MIN_PENCIL_INTERVAL_MS = Tools.server_config.MAX_EMIT_COUNT_PERIOD / Tools.server_config.MAX_EMIT_COUNT;

	var AUTO_FINGER_WHITEOUT = Tools.server_config.AUTO_FINGER_WHITEOUT;
	var hasUsedStylus = false;

	//Indicates the id of the line the user is currently drawing or an empty string while the user is not drawing
	var curLineId = "",
		lastTime = performance.now(); //The time at which the last point was drawn

	//The data of the message that will be sent for every new point
	function PointMessage(x, y) {
		this.type = 'child';
		this.parent = curLineId;
		this.x = x;
		this.y = y;
	}

	function handleAutoWhiteOut(evt) {
		if (evt.touches && evt.touches[0] && evt.touches[0].touchType == "stylus") {
			//When using stylus, switch back to the primary
			if (hasUsedStylus && Tools.curTool.secondary.active) {
				Tools.change("Pencil");
			}
			//Remember if starting a line with a stylus
			hasUsedStylus = true;
		}
		if (evt.touches && evt.touches[0] && evt.touches[0].touchType == "direct") {
			//When used stylus and touched with a finger, switch to secondary
			if (hasUsedStylus && !Tools.curTool.secondary.active) {
				Tools.change("Pencil");
			}
		}
	}

	function startLine(x, y, evt) {

		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		if (AUTO_FINGER_WHITEOUT) handleAutoWhiteOut(evt);

		curLineId = Tools.generateUID("l"); //"l" for line

		Tools.drawAndSend({
			'type': 'line',
			'id': curLineId,
			'color': (pencilTool.secondary.active ? "#ffffff" : Tools.getColor()),
			'size': Tools.getSize(),
			'opacity': (pencilTool.secondary.active ? 1 : Tools.getOpacity()),
		});

		//Immediatly add a point to the line
		continueLine(x, y);
	}

	function continueLine(x, y, evt) {
		/*Wait 70ms before adding any point to the currently drawing line.
		This allows the animation to be smother*/
		if (curLineId !== "" && performance.now() - lastTime > MIN_PENCIL_INTERVAL_MS) {
			Tools.drawAndSend(new PointMessage(x, y));
			lastTime = performance.now();
		}
		if (evt) evt.preventDefault();
	}

	function stopLineAt(x, y) {
		//Add a last point to the line
		continueLine(x, y);
		stopLine();
	}

	function stopLine() {
		curLineId = "";
	}

	var renderingLine = {};
	function draw(data) {
		Tools.drawingEvent = true;
		switch (data.type) {
			case "line":
				renderingLine = createLine(data);
				break;
			case "child":
				var line = (renderingLine.id === data.parent) ? renderingLine : svg.getElementById(data.parent);
				if (!line) {
					console.error("Pencil: Hmmm... I received a point of a line that has not been created (%s).", data.parent);
					line = renderingLine = createLine({ "id": data.parent }); //create a new line in order not to loose the points
				}
				addPoint(line, data.x, data.y);
				break;
			case "endline":
				//TODO?
				break;
			default:
				console.error("Pencil: Draw instruction with unknown type. ", data);
				break;
		}
	}

	var pathDataCache = {};
	function getPathData(line) {
		var pathData = pathDataCache[line.id];
		if (!pathData) {
			pathData = line.getPathData();
			pathDataCache[line.id] = pathData;
		}
		return pathData;
	}

	var svg = Tools.svg;

	function addPoint(line, x, y) {
		var pts = getPathData(line);
		pts = wboPencilPoint(pts, x, y);
		line.setPathData(pts);
	}

	function createLine(lineData) {
		//Creates a new line on the canvas, or update a line that already exists with new information
		var line = svg.getElementById(lineData.id) || Tools.createSVGElement("path");
		line.id = lineData.id;
		//If some data is not provided, choose default value. The line may be updated later
		line.setAttribute("stroke", lineData.color || "black");
		line.setAttribute("stroke-width", lineData.size || 10);
		line.setAttribute("opacity", Math.max(0.1, Math.min(1, lineData.opacity)) || 1);
		Tools.drawingArea.appendChild(line);
		return line;
	}

	//Remember drawing and white-out sizes separately
	var drawingSize = -1;
	var whiteOutSize = -1;

	function restoreDrawingSize() {
		whiteOutSize = Tools.getSize();
		if (drawingSize != -1) {
			Tools.setSize(drawingSize);
		}
	}

	function restoreWhiteOutSize() {
		drawingSize = Tools.getSize();
		if (whiteOutSize != -1) {
			Tools.setSize(whiteOutSize);
		}
	}

	//Restore remembered size after switch
	function toggleSize() {
		if (pencilTool.secondary.active) {
			restoreWhiteOutSize();
		} else {
			restoreDrawingSize();
		}
	}

	var pencilTool = {
		"name": "Pencil",
		"shortcut": "p",
		"listeners": {
			"press": startLine,
			"move": continueLine,
			"release": stopLineAt,
		},
		"draw": draw,
		"onstart": function(oldTool) {
			//Reset stylus
			hasUsedStylus = false;
		},
		"secondary": {
			"name": "White-out",
			"icon": "tools/pencil/whiteout_tape.svg",
			"active": false,
			"switch": function() {
				stopLine();
				toggleSize();
			},
		},
		"onstart": function() {
			//When switching from another tool to white-out, restore white-out size
			if (pencilTool.secondary.active) {
				restoreWhiteOutSize();
			}
		},
		"onquit": function() {
			//When switching from white-out to another tool, restore drawing size
			if (pencilTool.secondary.active) {
				restoreDrawingSize();
			}
		},
		"mouseCursor": "url('tools/pencil/cursor.svg'), crosshair",
		"icon": "tools/pencil/icon.svg",
		"stylesheet": "tools/pencil/pencil.css",
	};
	Tools.add(pencilTool);

})(); //End of code isolation
