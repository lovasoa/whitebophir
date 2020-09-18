var app = require('http').createServer(handler)
	, sockets = require('./sockets.js')
	, log = require("./log.js").log
	, path = require('path')
	, url = require('url')
	, fs = require("fs")
	, crypto = require("crypto")
	, serveStatic = require("serve-static")
	, createSVG = require("./createSVG.js")
	, templating = require("./templating.js")
	, config = require("./configuration.js")
	, polyfillLibrary = require('polyfill-library')
	, bd = require('./boardData.js')
	, db = require('./db/db.js');

require('dotenv').config();

var MIN_NODE_VERSION = 8.0;

if (parseFloat(process.versions.node) < MIN_NODE_VERSION) {
	console.warn(
		"!!! You are using node " + process.version +
		", wbo requires at least " + MIN_NODE_VERSION + " !!!");
}

var io = sockets.start(app);

app.listen(config.PORT);
log("server started", { port: config.PORT });

var CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

var fileserver = serveStatic(config.WEBROOT, {
	maxAge: 2 * 3600 * 1000,
	setHeaders: function (res) {
		res.setHeader("X-UA-Compatible", "IE=Edge");
		res.setHeader("Content-Security-Policy", CSP);
	}
});

var errorPage = fs.readFileSync(path.join(config.WEBROOT, "error.html"));
function serveError(request, response) {
	return function (err) {
		log("error", { "error": err && err.toString(), "url": request.url });
		response.writeHead(err ? 500 : 404, { "Content-Length": errorPage.length });
		response.end(errorPage);
	}
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

const boardTemplate = new templating.BoardTemplate(path.join(config.WEBROOT, 'board.html'));
const indexTemplate = new templating.Template(path.join(config.WEBROOT, 'index.html'));

function validateBoardName(boardName) {
	if (/^[\w%\-_~()]*$/.test(boardName)) return boardName;
	throw new Error("Illegal board name: " + boardName);
}

function handleRequest(request, response) {
	var parsedUrl = url.parse(request.url, true);
	var parts = parsedUrl.pathname.split('/');
	if (parts[0] === '') parts.shift();

	switch (parts[0]) {
		case "boards":
			// "boards" refers to the root directory
			//log('board action', { 'url': request.url });
			if (parts.length === 1 && parsedUrl.query.board) {
				log('board action for html forms', { 'url': request.url });
				// '/boards?board=...' This allows html forms to point to boards
				var headers = { Location: 'boards/' + encodeURIComponent(parsedUrl.query.board) };
				response.writeHead(301, headers);
				response.end();
			} else if (parts.length === 2 && request.url.indexOf('.') === -1) {
				log('board attempt opening', { 'url': request.url });

				const name = parts[1];

				validateBoardName(name);

				db.boardExists(name).then(boardExists => {
					if (!boardExists) {
						log('board not exists and go to cabinet', { 'board': name });
						response.writeHead(301, { 'Location': config.CABINET_URL });
						response.end();
					} else {
						// If there is no dot and no directory, parts[1] is the board name
						log('board opened', { 'board': name });
						boardTemplate.serve(request, response);
					}
				});
			} else { // Else, it's a resource
				//log('board action for resource', { 'url': request.url });
				request.url = "/" + parts.slice(1).join('/');
				fileserver(request, response, serveError(request, response));
			}
			break;

		case 'preview':
			const boardUuid = parts[1];

			response.writeHead(200, {
				"Content-Type": "image/svg+xml",
				"Content-Security-Policy": CSP,
				"Cache-Control": "public, max-age=30",
			});

			bd.BoardData.load(boardUuid).then(d => {
				createSVG.renderBoard(d.board, response).then(r => {
					response.end();
				}).catch(function (err) {
					log("error", {"error": err.toString()});
					response.end();
				});
			});
			break;

		case config.CREATE_KEY:
			var name = parts[1];

			db.boardExists(name).then(boardExists => {
				log('board attempt creating', { 'boardName': name, 'exists': boardExists });

				if (!boardExists) {
					db.createBoard(name);
					log('board created', { 'boardName': name });
				} else {
					log('board exists and skipped', { 'boardName': name });
				}
			});

			response.end(name);
			break;

		case "polyfill.js": // serve tailored polyfills
		case "polyfill.min.js":
			polyfillLibrary.getPolyfillString({
				uaString: request.headers['user-agent'],
				minify: request.url.endsWith(".min.js"),
				features: {
					'default': { flags: ['gated'] },
					'es5': { flags: ['gated'] },
					'es6': { flags: ['gated'] },
					'es7': { flags: ['gated'] },
					'es2017': { flags: ['gated'] },
					'es2018': { flags: ['gated'] },
					'es2019': { flags: ['gated'] },
					'performance.now': { flags: ['gated'] },
				}
			}).then(function (bundleString) {
				response.setHeader('Cache-Control', 'public, max-age=172800, stale-while-revalidate=1728000');
				response.setHeader('Vary', 'User-Agent');
				response.setHeader('Content-Type', 'application/javascript');
				response.end(bundleString);
			});
			break;

		case "": // Index page
			logRequest(request);
			response.writeHead(301, { 'Location': config.CABINET_URL });
			response.end();
			break;

		default:
			fileserver(request, response, serveError(request, response));
	}
}


module.exports = app;
