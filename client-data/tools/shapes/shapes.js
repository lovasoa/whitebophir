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
	//Indicates the id of the shape the user is currently drawing or an empty string while the user is not drawing
	var index = 0;
	var states = ["Прямоугольник", "Квадрат", "Эллипс", "Круг"];

	function toggleGrid(evt) {
		index = (index + 1) % states.length;
		console.log(index, states[index]);
	}

	var rectangleTool = {
		"name": "Shapes",
		"shortcut": "rt",
		"onstart": toggleGrid,
		"oneTouch": true,
		"mouseCursor": "crosshair",
		"icon": "tools/rect/icon.svg",
		"stylesheet": "tools/rect/rect.css"
	};
	Tools.add(rectangleTool);

})(); //End of code isolation
