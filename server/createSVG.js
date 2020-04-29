const fs = require("fs"),
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
					//We add the new point, and smoothen the line
					const ANGULARITY = 3; //The lower this number, the smoother the line
					const prev_values = pts[pts.length - 1].values; // Previous point
					const ante_values = pts[pts.length - 2].values; // Point before the previous one
					const prev_x = prev_values[prev_values.length - 2];
					const prev_y = prev_values[prev_values.length - 1];
					const ante_x = ante_values[ante_values.length - 2];
					const ante_y = ante_values[ante_values.length - 1];
					const x = el._children[i].x;
					const y = el._children[i].y;

					//We don't want to add the same point twice consecutively
					if ((prev_x === x && prev_y === y)
						|| (ante_x === x && ante_y === y)) continue;

					let vectx = x - ante_x,
						vecty = y - ante_y;
					const norm = Math.hypot(vectx, vecty);
					const dist1 = dist(ante_x, ante_y, prev_x, prev_y) / norm,
						dist2 = dist(x, y, prev_x, prev_y) / norm;
					vectx /= ANGULARITY;
					vecty /= ANGULARITY;
					//Create 2 control points around the last point
					const cx1 = prev_x - dist1 * vectx,
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
					pts.push(npoint);
				}
				for (let i = 1; i < pts.length; i++) {
					pathstring += " " + pts[i].type + " " + pts[i].values.join(" ");
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
	"Straight line": function (el) {
		const pathstring = "M" + el.x + " " + el.y + "L" + el.x2 + " " + el.y2;
		return renderPath(el, pathstring);
	}
};


function toSVG(obj) {
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
		const renderFun = Tools[elem.tool];
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

function renderBoard(file, callback) {
	const t = Date.now();
	fs.readFile(file, function (err, data) {
		if (err) return callback(err);
		try {
			const board = JSON.parse(data);
			console.warn("JSON parsed in " + (Date.now() - t) + "ms.");
			const svg = toSVG(board);
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
