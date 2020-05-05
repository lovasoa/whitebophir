const fs = require("fs"),
	path = require("path"),
	pencilExtrapolatePoints = require("../client-data/tools/pencil/pencil_extrapolate_points").pencilExtrapolatePoints;

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

function dist(x1, y1, x2, y2) {
	//Returns the distance between (x1,y1) and (x2,y2)
	return Math.hypot(x2 - x1, y2 - y1);
}

const Tools = {
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
		let pathstring;
		switch (el._children.length) {
			case 0: return "";
			case 1:
				pathstring = "M" + el._children[0].x + " " + el._children[0].y +
					"L" + el._children[0].x + " " + el._children[0].y;
				break;
			default:
				pathstring = "M" + el._children[0].x + " " + el._children[0].y + "L";
				for (var i = 1; i < el._children.length; i++) {
					pathstring += (+el._children[i].x) + " " + (+el._children[i].y) + " ";
				}
		}

		return renderPath(el, pathstring);
	},
	"Rectangle": function (el) {
		const pathstring =
			"M" + el.x + " " + el.y +
			"L" + el.x + " " + el.y2 +
			"L" + el.x2 + " " + el.y2 +
			"L" + el.x2 + " " + el.y +
			"L" + el.x + " " + el.y;
		return renderPath(el, pathstring);
	},
	"Ellipse": function (el) {
		const cx = Math.round((el.x2 + el.x) / 2);
		const cy = Math.round((el.y2 + el.y) / 2);
		const rx = Math.abs(el.x2 - el.x) / 2;
		const ry = Math.abs(el.y2 - el.y) / 2;
		const pathstring =
			"M" + (cx - rx) + " " + cy +
			"a" + rx + "," + ry + " 0 1,0 " + (rx * 2) + ",0" +
			"a" + rx + "," + ry + " 0 1,0 " + (rx * -2) + ",0";
		return renderPath(el, pathstring);
	},
	"Straight line": function (el) {
		const pathstring = "M" + el.x + " " + el.y + "L" + el.x2 + " " + el.y2;
		return renderPath(el, pathstring);
	}
};

exportTools = {
	"Pencil": function (el) {
		if (!el._children) return "";
		let pathstring;
		switch (el._children.length) {
			case 0:
				return "";
			case 1:
				pathstring = "M" + el._children[0].x + " " + el._children[0].y +
					"L" + el._children[0].x + " " + el._children[0].y;
				break;
			case 2:
				pathstring = "M" + el._children[0].x + " " + el._children[0].y +
					"C" + el._children[0].x + " " + el._children[0].y + " " +
					el._children[1].x + " " + el._children[1].y + " " +
					el._children[1].x + " " + el._children[1].y;
				break;
			default:
				pathstring = "M" + el._children[0].x + " " + el._children[0].y;
				const pts = [
					{type: "M", values: [el._children[0].x, el._children[0].y]},
					{type: "C", values: [el._children[0].x, el._children[0].y,
							el._children[1].x, el._children[1].y,
							el._children[1].x, el._children[1].y]},
				];
				for (let i = 2; i < el._children.length; i++) {
					let npoint = pencilExtrapolatePoints(pts, el._children[i].x, el._children[i].y)
					pts.push(npoint);
				}
				for (let i = 1; i < pts.length; i++) {
					pathstring += " " + pts[i].type + " " + pts[i].values.join(" ");
				}
		}

		return renderPath(el, pathstring);
	},
};


function toSVG(obj, type) {
	const margin = 500, maxelems = 1e4;
	let elements = "", i = 0, w = 500, h = 500;
	const t = Date.now();
	let elems = Object.values(obj);
	while (elems.length > 0) {
		if (++i > maxelems) break;
		const elem = elems.pop();
		elems = elems.concat(elem._children || []);
		if (elem.x && elem.x + margin > w) w = elem.x + margin;
		if (elem.y && elem.y + margin > h) h = elem.y + margin;
		const renderFun = (type === "export" && exportTools[elem.tool]) ? exportTools[elem.tool] : Tools[elem.tool];
		if (renderFun) elements += renderFun(elem);
	}
	console.error(i + " elements treated in " + (Date.now() - t) + "ms.");

	const svg = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + w + '" height="' + h + '">' +
		'<defs><style type="text/css"><![CDATA[' +
		'text {font-family:"Arial"}' +
		'path {fill:none;stroke-linecap:round;stroke-linejoin:round;}' +
		']]></style></defs>' +
		elements +
		'</svg>';
	return svg;
}

function renderBoard(file, type, callback) {
	const t = Date.now();
	fs.readFile(file, function (err, data) {
		if (err) return callback(err);
		try {
			const board = JSON.parse(data);
			console.warn("JSON parsed in " + (Date.now() - t) + "ms.");
			const svg = toSVG(board, type);
			console.warn("Board rendered in " + (Date.now() - t) + "ms.");
			callback(null, svg);
		}
		catch (err) { return callback(err) }
	});
}

if (require.main === module) {
	const config = require("./configuration.js")
	const HISTORY_FILE = process.argv[2] || path.join(config.HISTORY_DIR, "board-anonymous.json");

	renderBoard(HISTORY_FILE, function (err, rendered) {
		console.log(rendered);
	});
} else {
	module.exports = { 'renderBoard': renderBoard };
}
