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

	//Indicates the id of the line the user is currently drawing or an empty string while the user is not drawing
	var curLineId = "",
		lastTime = performance.now(), //The time at which the last point was drawn
		penIcons = ["tools/pencil/icon.svg", "tools/pencil/whiteout_tape.svg"],
		toolName = ["Pencil", "Whiteout Pen"],
		end = false;

	var curPen = "pencil";

	//The data of the message that will be sent for every new point
	function PointMessage(x, y) {
		this.type = 'child';
		this.parent = curLineId;
		this.x = x;
		this.y = y;
	}

	function startLine(x, y, evt) {

		//Prevent the press from being interpreted by the browser
		evt.preventDefault();

		curLineId = Tools.generateUID("l"); //"l" for line

		Tools.drawAndSend({
			'type': 'line',
			'id': curLineId,
			'color': (curPen === "pencil" ? Tools.getColor() : "#ffffff"),
			'size': Tools.getSize(),
			'opacity': (curPen === "pencil" ? Tools.getOpacity() : 1),
		});

		//Immediatly add a point to the line
		continueLine(x, y);
	}

	function continueLine(x, y, evt) {
		/*Wait 20ms before adding any point to the currently drawing line.
		This allows the animation to be smother*/
		if (curLineId !== "" && (performance.now() - lastTime > 20 || end)) {
			Tools.drawAndSend(new PointMessage(x, y));
			lastTime = performance.now();
		}
		if (evt) evt.preventDefault();
	}

	function stopLine(x, y) {
		//Add a last point to the line
		end = true;
		continueLine(x, y);
		end = false;
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


	function toggle(){
		var index = 0;
		if (curPen === "pencil") {
			curPen = "whiteout";
			index = 1;
		} else {
			curPen = "pencil";
		}
		document.getElementById("toolID-"+pencilTool.name).getElementsByClassName("tool-icon")[0].src = penIcons[index];
		document.getElementById("toolID-"+pencilTool.name).getElementsByClassName("tool-name")[0].textContent = toolName[index];
	}


	var pencilTool = {
		"name": "Pencil",
		"shortcut": "p",
		"listeners": {
			"press": startLine,
			"move": continueLine,
			"release": stopLine,
		},
		"draw": draw,
		"toggle":toggle,
		"mouseCursor": "url('tools/pencil/cursor.svg'), crosshair",
		"icon": penIcons[0],
		"stylesheet": "tools/pencil/pencil.css"
	};
	Tools.add(pencilTool);

})(); //End of code isolation
