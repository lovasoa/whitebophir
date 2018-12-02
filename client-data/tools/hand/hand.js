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

	var orig = { x: 0, y: 0 };
	var pressed = false;
	function press(x, y, evt, isTouchEvent) {
		if (!isTouchEvent) {
			pressed = true;
			orig.x = scrollX + evt.clientX;
			orig.y = scrollY + evt.clientY;
		}
	}
	function move(x, y, evt, isTouchEvent) {
		if (pressed && !isTouchEvent) { //Let the browser handle touch to scroll
			window.scrollTo(orig.x - evt.clientX, orig.y - evt.clientY);
		}
	}
	function release() {
		pressed = false;
	}

	Tools.add({ //The new tool
		"name": "Hand",
		"icon": "✋",
		"listeners": {
			"press": press,
			"move": move,
			"release": release
		},
		"mouseCursor": "move"
	});

	//The hand tool is selected by default
	Tools.change("Hand");
})(); //End of code isolation
