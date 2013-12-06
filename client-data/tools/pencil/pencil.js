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

	function continueLine (x,y, evt){
		/*Wait 70ms before adding any point to the currently drawing line.
		This allows the animation to be smother*/
		if (curLineId !== "" &&
			performance.now() - lastTime > 70) {
			curPoint.x = x; curPoint.y = y;
			Tools.drawAndSend(curPoint);
			lastTime = performance.now();
		}
		if (evt) evt.preventDefault();
	}

	function stopLine (x,y){
		//Add a last point to the line
		continueLine(x,y);
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
					console.error("Pencil: Hmmm... I received a point of a line that has not been created (%s).", data.line);
					line = renderingLine = createLine({"id":data.line}); //create a new line in order not to loose the points
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

	function dist(x1,y1,x2,y2) {
		//Returns the distance between (x1,y1) and (x2,y2)
		return Math.hypot(x2-x1, y2-y1);
	}

	var svg = Tools.svg;
	function addPoint (line, x,y) {
		var nbr = line.pathSegList.numberOfItems, //The number of points already in the line
			pts = line.pathSegList, //The points that are already in the line as a SVGPathSegList
			npoint;
		switch (nbr) {
			case 0: //The first point in the line
				//If there is no point, we have to start the line with a moveTo statement
				npoint = line.createSVGPathSegMovetoAbs(x,y);
				break;
			case 1: //There is only one point.
				//Draw a curve that is segment between the old point and the new one
				npoint = line.createSVGPathSegCurvetoCubicAbs(
							x,y, pts.getItem(0).x,pts.getItem(0).y, x,y);
				break;
			default: //There are at least two points in the line
				//We add the new point, and smoothen the line
				var ANGULARITY = 3; //The lower this number, the smoother the line
				var prev = [pts.getItem(nbr-2), pts.getItem(nbr-1)]; //The last two points that are already in the line

				//We don't want to add the same point twice consecutively
				if (prev[1].x==x && prev[1].y==y) return;

				var vectx = x-prev[0].x,
					vecty = y-prev[0].y;
				var norm = Math.hypot(vectx,vecty);
				var dist1 = dist(prev[0].x,prev[0].y,prev[1].x,prev[1].y)/norm,
					dist2 = dist(x,y,prev[1].x,prev[1].y)/norm;
				vectx /= ANGULARITY;
				vecty /= ANGULARITY;
				//Create 2 control points around the last point
				var cx1 = prev[1].x - dist1*vectx,
					cy1 = prev[1].y - dist1*vecty, //First control point
					cx2 = prev[1].x + dist2*vectx,
					cy2 = prev[1].y + dist2*vecty; //Second control point
				prev[1].x2 = cx1;
				prev[1].y2 = cy1;

				npoint = line.createSVGPathSegCurvetoCubicAbs(x,y,cx2,cy2,x,y);
		}
		line.pathSegList.appendItem(npoint);
	}

	function createLine(lineData) {
		//Creates a new line on the canvas, or update a line that already exists with new information
		var line = svg.getElementById(lineData.id) || Tools.createSVGElement("path");
		line.id = lineData.id;
		//If some data is not provided, choose default value. The line may be updated later
		line.setAttribute("stroke", lineData.color || "black" );
		line.setAttribute("stroke-width", lineData.size || 10 );
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
	 	"mouseCursor" : "crosshair",
	 	"stylesheet" : "tools/pencil/pencil.css"
	});

	//The pencil tool is selected by default
	Tools.change("Pencil");
})(); //End of code isolation
