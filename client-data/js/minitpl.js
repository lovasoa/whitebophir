function Minitpl(elem, data) {
	this.elem = (typeof(elem)==="string") ? document.querySelector(elem) : elem;
	this.parent = this.elem.parentNode;
	this.parent.removeChild(this.elem);
}
Minitpl.prototype.add = function(data) {
	var newElem = this.elem.cloneNode();
	for (var key in data) {
		var val = data[key];
		var matches = newElem.querySelectorAll(key);
		for (var i=0; i<matches.length; i++) {
			if (typeof(val)==="function") {
				matches[i].textContent = val(matches[i]);
			} else {
				matches[i].textContent = val;
			}
		}
	}
	this.parent.appendChild(newElem);
	return newElem;
}
