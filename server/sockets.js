var iolib = require('socket.io')
  , path = require("path")
  , fs = require('fs');

/**
 * Name of the file the persistent data will be written to
 * if there are more messages, older ones will be erased
 * @const
 * @type {string}
 */
var HISTORY_FILE = path.join(__dirname, "../server-data/history.txt");

/**
 * Number of messages to keep in memory
 * if there are more messages, older ones will be erased
 * @const
 * @type {number}
 */
var MAX_HISTORY_LENGTH = 1e5;


var history = [];

//Load existing history
fs.readFile(HISTORY_FILE, 'utf8', function (file_err, history_str) {
	if (file_err) {
		console.log("Unable to open history file: "+file_err);
	}else {
		try {
			history = history_str
						.split("\n")
						.slice(-MAX_HISTORY_LENGTH)
						.filter(function(line){return line && line[0]!="#"})
						.map(JSON.parse);
		} catch(json_err) {
			console.log("Bad history file: "+json_err);
		}
	}
});


function socketConnection (socket) {
	//On the first connection, send all previously broadcasted data
	for (var i=0;i<history.length;i++){
		socket.emit("broadcast", history[i]);
	}

	socket.on('broadcast', function (data) {
		//Send data to all other connected users
		socket.broadcast.emit('broadcast', data);
		
		addHistory(data);
	});

}

function addHistory(data) {
		//Save the data in memory
		history.push(data);
		//Save the data to a file
		fs.open(HISTORY_FILE, 'a', function (err, fd){
			if (err) console.error(err);
			else {
				var str_data = JSON.stringify(data)+'\n';
				fs.write(fd, str_data);
			}		
		});
		//Avoid a memory overload
		if (history.length > MAX_HISTORY_LENGTH) {
			history.pop();
		}
}

if (exports) {
	exports.start = function(app){
		io = iolib.listen(app, {'log':false});
		io.sockets.on('connection', socketConnection);
		return io;
	};
}
