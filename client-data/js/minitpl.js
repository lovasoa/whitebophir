/**
 *                        MINITPL
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

Minitpl = (function () {

	function Minitpl(elem, data) {
		this.elem = (typeof (elem) === "string") ? document.querySelector(elem) : elem;
		if (!elem) {
			throw "Invalid element!";
		}
		this.parent = this.elem.parentNode;
		this.parent.removeChild(this.elem);
	}

	function transform(element, transformer) {
		if (typeof (transformer) === "function") {
			transformer(element);
		} else {
			element.textContent = transformer;
		}
	}

	Minitpl.prototype.add = function (data) {
		var newElem = this.elem.cloneNode(true);
		if (typeof (data) === "object") {
			for (var key in data) {
				var matches = newElem.querySelectorAll(key);
				for (var i = 0; i < matches.length; i++) {
					transform(matches[i], data[key]);
				}
			}
		} else {
			transform(newElem, data);
		}
		this.parent.appendChild(newElem);
		return newElem;
	}

	return Minitpl;
}());

