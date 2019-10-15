var app = require('http').createServer(handler)
	, sockets = require('./sockets.js')
	, log = require("./log.js").log
	, path = require('path')
	, url = require('url')
	, fs = require("fs")
	, crypto = require("crypto")
	, nodestatic = require("node-static")
	, createSVG = require("./createSVG.js")
	, handlebars = require("handlebars");


var io = sockets.start(app);

/**
 * Folder from which static files will be served
 * @const
 * @type {string}
 */
var WEBROOT = path.join(__dirname, "../client-data");

/**
 * Port on which the application will listen
 * @const
 * @type {number}
 */
var PORT = parseInt(process.env['PORT']) || 8080;

/**
 * Associations from language to translation dictionnaries
 * @const
 * @type {object}
 */
var TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "translations.json")));

app.listen(PORT);
log("server started", { port: PORT });

var CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

var fileserver = new nodestatic.Server(WEBROOT, {
	"headers": {
		"X-UA-Compatible": "IE=Edge",
		"Content-Security-Policy": CSP,
	}
});

function serveError(request, response, err) {
	console.warn("Error serving '" + request.url + "' : " + err.status + " " + err.message);
	fileserver.serveFile('error.html', err.status, {}, request, response);
}

function logRequest(request) {
	log('connection', {
		ip: request.connection.remoteAddress,
		original_ip: request.headers['x-forwarded-for'] || request.headers['forwarded'],
		user_agent: request.headers['user-agent'],
		referer: request.headers['referer'],
		language: request.headers['accept-language'],
		url: request.url,
	});
}

function handler(request, response) {
	try {
		handleRequest(request, response);
	} catch (err) {
		console.trace(err);
		response.writeHead(500, { 'Content-Type': 'text/plain' });
		response.end(err.toString());
	}
}

function baseUrl(req) {
	var proto = req.headers['X-Forwarded-Proto'] || (req.connection.encrypted ? 'https' : 'http');
	var host = req.headers['X-Forwarded-Host'] || req.headers.host;
	return proto + '://' + host;
}

var BOARD_HTML_TEMPLATE = handlebars.compile(
	fs.readFileSync(WEBROOT + '/board.html', { encoding: 'utf8' })
);
handlebars.registerHelper({
	translate: function (translations, str) {
		return translations[str] || str;
	},
	json: JSON.stringify.bind(JSON)
});

function handleRequest(request, response) {
	var parsedUrl = url.parse(request.url, true);
	var parts = parsedUrl.pathname.split('/');
	if (parts[0] === '') parts.shift();

	if (parts[0] === "boards") {
		// "boards" refers to the root directory
		if (parts.length === 1 && parsedUrl.query.board) {
			// '/boards?board=...' This allows html forms to point to boards
			var headers = { Location: 'boards/' + encodeURIComponent(parsedUrl.query.board) };
			response.writeHead(301, headers);
			response.end();
		} else if (parts.length === 2 && request.url.indexOf('.') === -1) {
			// If there is no dot and no directory, parts[1] is the board name
			logRequest(request);
			var lang = (
				parsedUrl.query.lang ||
				request.headers['accept-language'] ||
				''
			).slice(0, 2);
			var board = decodeURIComponent(parts[1]);
			var body = BOARD_HTML_TEMPLATE({
				board: board,
				boardUriComponent: parts[1],
				baseUrl: baseUrl(request),
				languages: Object.keys(TRANSLATIONS).concat("en"),
				language: lang in TRANSLATIONS ? lang : "en",
				translations: TRANSLATIONS[lang] || {}
			});
			var headers = {
				'Content-Length': Buffer.byteLength(body),
				'Content-Type': 'text/html'
			};
			response.writeHead(200, headers);
			response.end(body);
		} else { // Else, it's a resource
			request.url = "/" + parts.slice(1).join('/');
			fileserver.serve(request, response, function (err, res) {
				if (err) serveError(request, response, err);
			});
		}
	} else if (parts[0] === "download") {
		var boardName = encodeURIComponent(parts[1]),
			history_file = "../server-data/board-" + boardName + ".json",
			headers = {
				"Content-Type": "application/json",
				"Content-Disposition": 'attachment; filename="' + boardName + '.wbo"'
			};
		if (parts.length > 2 && !isNaN(Date.parse(parts[2]))) {
			history_file += '.' + parts[2] + '.bak';
		}
		log("Downloading " + history_file);
		var promise = fileserver.serveFile(history_file, 200, headers, request, response);
		promise.on("error", function (err) {
			console.error("Error while downloading history", err);
			response.statusCode = 404;
			response.end("ERROR: Unable to serve history file\n");
		});
	} else if (parts[0] === "preview") {
		var boardName = encodeURIComponent(parts[1]),
			history_file = path.join(__dirname, "..", "server-data", "board-" + boardName + ".json");
		createSVG.renderBoard(history_file, function (err, svg) {
			if (err) {
				log(err);
				response.writeHead(404, { 'Content-Type': 'application/json' });
				return response.end(JSON.stringify(err));
			}
			response.writeHead(200, {
				"Content-Type": "image/svg+xml",
				"Content-Security-Policy": CSP,
				'Content-Length': Buffer.byteLength(svg),
			});
			response.end(svg);
		});
	} else if (parts[0] === "random") {
		var name = crypto.randomBytes(32).toString('base64').replace(/[^\w]/g, '-');
		response.writeHead(307, { 'Location': '/boards/' + name });
		response.end(name);
	} else {
		if (parts[0] === '') logRequest(request);
		fileserver.serve(request, response, function (err, res) {
			if (err) {
				logRequest(request);
				serveError(request, response, err);
			}
		});
	}
}


