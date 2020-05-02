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

	function dist(x1, y1, x2, y2) {
		//Returns the distance between (x1,y1) and (x2,y2)
		return Math.hypot(x2 - x1, y2 - y1);
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
		var pts = getPathData(line), //The points that are already in the line as a PathData
			nbr = pts.length; //The number of points already in the line
		switch (nbr) {
			case 0: //The first point in the line
				//If there is no point, we have to start the line with a moveTo statement
				npoint = { type: "M", values: [x, y] };
				break;
			case 1: //There is only one point.
				//Draw a curve that is segment between the old point and the new one
				npoint = {
					type: "C", values: [
						pts[0].values[0], pts[0].values[1],
						x, y,
						x, y,
					]
				};
				break;
			default: //There are at least two points in the line
				//We add the new point, and smoothen the line
				var ANGULARITY = 3; //The lower this number, the smoother the line
				var prev_values = pts[nbr - 1].values; // Previous point
				var ante_values = pts[nbr - 2].values; // Point before the previous one
				var prev_x = prev_values[prev_values.length - 2];
				var prev_y = prev_values[prev_values.length - 1];
				var ante_x = ante_values[ante_values.length - 2];
				var ante_y = ante_values[ante_values.length - 1];


				//We don't want to add the same point twice consecutively
				if ((prev_x == x && prev_y == y)
					|| (ante_x == x && ante_y == y)) return;

				var vectx = x - ante_x,
					vecty = y - ante_y;
				var norm = Math.hypot(vectx, vecty);
				var dist1 = dist(ante_x, ante_y, prev_x, prev_y) / norm,
					dist2 = dist(x, y, prev_x, prev_y) / norm;
				vectx /= ANGULARITY;
				vecty /= ANGULARITY;
				//Create 2 control points around the last point
				var cx1 = prev_x - dist1 * vectx,
					cy1 = prev_y - dist1 * vecty, //First control point
					cx2 = prev_x + dist2 * vectx,
					cy2 = prev_y + dist2 * vecty; //Second control point
				prev_values[2] = cx1;
				prev_values[3] = cy1;

				npoint = {
					type: "C", values: [
						cx2, cy2,
						x, y,
						x, y,
					]
				};
		}
		pts.push(npoint);
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


	function toggle(elem){
		var index = 0;
		if (curPen === "pencil") {
			curPen = "whiteout";
			index = 1;
		} else {
			curPen = "pencil";
		}
		elem.getElementsByClassName("tool-icon")[0].src = penIcons[index];
		elem.getElementsByClassName("tool-name")[0].textContent = toolName[index];
	}


	Tools.add({
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
	});

})(); //End of code isolation
