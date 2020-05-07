const fs = require("./fs_promises.js"),
	path = require("path"),
	wboPencilPoint = require("../client-data/tools/pencil/wbo_pencil_point.js").wboPencilPoint;

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
		let pts = el._children.reduce(function (pts, point) {
			return wboPencilPoint(pts, point.x, point.y);
		}, []);
		const pathstring = pts.map(function (op) {
			return op.type + op.values.join(' ')
		}).join('');
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


function toSVG(obj) {
	const margin = 500;
	let w = 500, h = 500;
	const elements = Object.values(obj).map(function (elem) {
		if (elem.x && elem.x + margin > w) w = elem.x + margin;
		if (elem.y && elem.y + margin > h) h = elem.y + margin;
		const renderFun = Tools[elem.tool];
		if (renderFun) return renderFun(elem);
		else console.warn("Missing render function for tool", elem.tool);
	}).join('');

	const svg = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + w + '" height="' + h + '">' +
		'<defs><style type="text/css"><![CDATA[' +
		'text {font-family:"Arial"}' +
		'path {fill:none;stroke-linecap:round;stroke-linejoin:round;}' +
		']]></style></defs>' +
		elements +
		'</svg>';
	return svg;
}

async function renderBoard(file) {
	const data = await fs.promises.readFile(file);
	var board = JSON.parse(data);
	return toSVG(board);
}

if (require.main === module) {
	const config = require("./configuration.js");
	const HISTORY_FILE = process.argv[2] || path.join(config.HISTORY_DIR, "board-anonymous.json");

	renderBoard(HISTORY_FILE)
		.then(console.log.bind(console))
		.catch(console.error.bind(console));
} else {
	module.exports = { 'renderBoard': renderBoard };
}
