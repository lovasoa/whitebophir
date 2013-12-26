var fs = require("fs"),
	path = require("path");

var HISTORY_FILE = path.join(__dirname, "../server-data/history.txt");

function htmlspecialchars (str) {
	//Hum, hum... Could do better
	if (typeof str !== "string") return "";
	return str.replace(/&/g, "&amp;")
			  .replace(/</g, "&lt;")
			  .replace(/>/g, "&gt;")
			  .replace(/"/g, "&quot;")
			  .replace(/'/g, "&#039;");
}

var Tools = {
	"Text" : function(el) {
		return '<text ' +
				'id="'+htmlspecialchars(el.id||"t")+'" ' +
				'x="'+(el.x|0)+'" '+
				'y="'+(el.y|0)+'" '+
				'font-size="'+(el.size|0)+'" '+
				'fill="'+htmlspecialchars(el.color||"#000")+'" '+
				'>'+htmlspecialchars(el.txt||"")+'</text>';
	},
	"Pencil" : function(el) {
		if (!el._children) return "";
		switch (el._children.length) {
			case 0: return "";
			case 1:
				var pathstring = "M" + el._children[0].x + " " + el._children[0].y +
								 "L" + el._children[0].x + " " + el._children[0].y;
			default:
				var pathstring = "M"+el._children[0].x+" "+ el._children[0].y + "L";
				for(var i=1;i<el._children.length;i++){
					pathstring += (+el._children[i].x)+" "+ (+el._children[i].y)+" ";
				}
		}

		return '<path ' +
				'id="'+htmlspecialchars(el.id||"l")+'" ' +
				'stroke-width="'+(el.size|0)+'" '+
				'stroke="'+htmlspecialchars(el.color||"#000")+'" '+
				'd="'+pathstring+'" ' +
				'/>';
	}
};


function toSVG(obj) {
	var margin=500;
	var elements = "", w=0, h=0;
	for (var id in obj) {
		var elem = obj[id];
		if (elem.x && elem.x + margin > w) w = elem.x + margin;
		if (elem.y && elem.y + margin > h) h = elem.y + margin;
		elements += Tools[elem.tool](elem);
	}

	var svg = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="'+w+'" height="'+h+'">' +
  				'<defs><style type="text/css"><![CDATA[' +
					'text {font-family:"Arial"}' +
					'path {fill:none;stroke-linecap:round;stroke-linejoin:round;}' +
				']]></style></defs>' +
				elements +
				'</svg>';
	console.log(svg);
	return svg;
}

fs.readFile(HISTORY_FILE, function (err, data) {
	if (err) throw err;
	var board = JSON.parse(data);
	toSVG(board);
});
