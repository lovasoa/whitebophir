var app = require('http').createServer(handler)
  , sockets = require('./sockets.js').start(app)
  , fs = require('fs')
  , path = require('path')
  , nodestatic = require("node-static");

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

function handler (request, response) {

	switch(request.url) {
		case "/":
			fileserver.serveFile("board.html", 200, {}, request, response);
			break;
		case "/download":
			fileserver.serveFile("../server-data/history.txt", 200, {}, request, response);
			break;
		default:
			fileserver.serve(request, response, function (err, res){
				if (err) {
					console.warn("Error serving '"+request.url+"' : "+err.message);
					fileserver.serveFile('error.html', err.status, {}, request, response);
				}
			});
	}
}


