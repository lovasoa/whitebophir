Minitpl = (function(){

function Minitpl(elem, data) {
	this.elem = (typeof(elem)==="string") ? document.querySelector(elem) : elem;
	if (!elem) {
		throw "Invalid element!";
	}
	this.parent = this.elem.parentNode;
	this.parent.removeChild(this.elem);
}

function transform (element, transformer) {
	if (typeof(transformer)==="function") {
		element.textContent = transformer(element);
	} else {
		element.textContent = transformer;
	}
}

Minitpl.prototype.add = function(data) {
	var newElem = this.elem.cloneNode(true);
	if (typeof (data) === "object") {  
		for (var key in data) {
			var matches = newElem.querySelectorAll(key);
			for (var i=0; i<matches.length; i++) {
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

