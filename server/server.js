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
	console.warn("Error serving '"+request.url+"' : "+err.message);
	fileserver.serveFile('error.html', err.status, {}, request, response);
}

function logRequest (request) {
	var ip = request.headers['X-Forwarded-For'] || request.connection.remoteAddress;
	console.log("Connection from " + ip +
				" ("+request.headers['user-agent']+")");
}

function handler (request, response) {

	switch(request.url) {
		case "/":
			logRequest(request);
			fileserver.serveFile("board.html", 200, {}, request, response);
			break;
		case "/download":
			var history_file = "../server-data/history.txt",
				headers = {"Content-Type": "text/x-wbo"};
			var promise = fileserver.serveFile(history_file, 200, headers, request, response);
			promise.on("error", function(){
				response.statusCode = 404;
				response.end("ERROR: Unable to serve history file\n");
			});
			break;
		default:
			fileserver.serve(request, response, function (err, res){
				if (err) serveError(request, response, err);
			});
	}
}


