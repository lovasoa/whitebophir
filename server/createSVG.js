var fs = require("fs"),
	path = require("path");

function htmlspecialchars(str) {
	//Hum, hum... Could do better
	if (typeof str !== "string") return "";
	return str.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function renderPath(el, pathstring) {
	return '<path ' +
		'id="' + htmlspecialchars(el.id || "l") + '" ' +
		'stroke-width="' + (el.size | 0) + '" ' +
		'stroke="' + htmlspecialchars(el.color || "#000") + '" ' +
		'd="' + pathstring + '" ' +
		'/>';

}

var Tools = {
	"Text": function (el) {
		return '<text ' +
			'id="' + htmlspecialchars(el.id || "t") + '" ' +
			'x="' + (el.x | 0) + '" ' +
			'y="' + (el.y | 0) + '" ' +
			'font-size="' + (el.size | 0) + '" ' +
			'fill="' + htmlspecialchars(el.color || "#000") + '" ' +
			'>' + htmlspecialchars(el.txt || "") + '</text>';
	},
	"Pencil": function (el) {
		if (!el._children) return "";
		switch (el._children.length) {
			case 0: return "";
			case 1:
				var pathstring = "M" + el._children[0].x + " " + el._children[0].y +
					"L" + el._children[0].x + " " + el._children[0].y;
				break;
			default:
				var pathstring = "M" + el._children[0].x + " " + el._children[0].y + "L";
				for (var i = 1; i < el._children.length; i++) {
					pathstring += (+el._children[i].x) + " " + (+el._children[i].y) + " ";
				}
		}

		return renderPath(el, pathstring);
	},
	"Rectangle": function (el) {
		var pathstring =
			"M" + el.x + " " + el.y +
			"L" + el.x + " " + el.y2 +
			"L" + el.x2 + " " + el.y2 +
			"L" + el.x2 + " " + el.y +
			"L" + el.x + " " + el.y;
		return renderPath(el, pathstring);
	},
	"Straight line": function (el) {
		var pathstring = "M" + el.x + " " + el.y + "L" + el.x2 + " " + el.y2;
		return renderPath(el, pathstring);
	}
};


function toSVG(obj) {
	var margin = 500, maxelems = 1e4;
	var elements = "", i = 0, w = 500, h = 500;
	var t = Date.now();
	var elems = Object.values(obj);
	while (elems.length > 0) {
		if (++i > maxelems) break;
		var elem = elems.pop();
		elems = elems.concat(elem._children || []);
		if (elem.x && elem.x + margin > w) w = elem.x + margin;
		if (elem.y && elem.y + margin > h) h = elem.y + margin;
		var renderFun = Tools[elem.tool];
		if (renderFun) elements += renderFun(elem);
	}
	console.error(i + " elements treated in " + (Date.now() - t) + "ms.");

	var svg = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + w + '" height="' + h + '">' +
		'<defs><style type="text/css"><![CDATA[' +
		'text {font-family:"Arial"}' +
		'path {fill:none;stroke-linecap:round;stroke-linejoin:round;}' +
		']]></style></defs>' +
		elements +
		'</svg>';
	return svg;
}

function renderBoard(file, callback) {
	var t = Date.now();
	fs.readFile(file, function (err, data) {
		if (err) return callback(err);
		try {
			var board = JSON.parse(data);
			console.warn("JSON parsed in " + (Date.now() - t) + "ms.");
			var svg = toSVG(board);
			console.warn("Board rendered in " + (Date.now() - t) + "ms.");
			callback(null, svg);
		}
		catch (err) { return callback(err) }
	});
}

if (require.main === module) {
	var HISTORY_FILE = process.argv[2] || path.join(__dirname, "../server-data/board-anonymous.json");

	renderBoard(HISTORY_FILE, function (err, rendered) {
		console.log(rendered);
	});
} else {
	module.exports = { 'renderBoard': renderBoard };
}
