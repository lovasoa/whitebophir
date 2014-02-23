var app = require('http').createServer(handler)
  , sockets = require('./sockets.js')
  , fs = require('fs')
  , path = require('path')
  , nodestatic = require("node-static");


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
var PORT = 8080;

app.listen(PORT);
console.log("Server listening on "+PORT);

var fileserver = new nodestatic.Server(WEBROOT);

function serveError(request, response, err) {
	console.warn("Error serving '"+request.url+"' : "+err.status+" "+err.message);
	fileserver.serveFile('error.html', err.status, {}, request, response);
}

function logRequest (request) {
	var ip = request.headers['X-Forwarded-For'] || request.connection.remoteAddress;
	console.log("Connection from " + ip +
				" ("+request.headers['user-agent']+") to "+request.url);
}

function handler (request, response) {
	var parts = request.url.split('/');
	if (parts[0] === '') parts.shift();

	if (parts.length === 0) {
		fileserver.serveFile("index.html", 200, {}, request, response);
	} else if (parts[0] === "boards") {
		// "boards" refers to the root directory

		// If there is no dot and no directory, parts[1] is the board name
		if (parts.length === 2 && request.url.indexOf('.') === -1) {
			fileserver.serveFile("board.html", 200, {}, request, response);
			logRequest(request);
		} else { // Else, it's a resource
			request.url = "/" + parts.slice(1).join('/');
			fileserver.serve(request, response, function (err, res){
				if (err) serveError(request, response, err);
			});
		}

	} else if (parts[0] === "download") {
		var history_file = "../server-data/board-" + encodeURIComponent(parts[1]),
			headers = {"Content-Type": "text/x-wbo"};
		var promise = fileserver.serveFile(history_file, 200, headers, request, response);
		promise.on("error", function(){
			response.statusCode = 404;
			response.end("ERROR: Unable to serve history file\n");
		});

	} else {
		fileserver.serve(request, response, function (err, res){
			if (err) serveError(request, response, err);
		});
	}
}


