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


var history = [],
	unsaved_history = [];

//Load existing history
fs.readFile(HISTORY_FILE, 'utf8', function (file_err, history_str) {
	if (file_err) {
		if (file_err.code == "ENOENT") {
			console.log("History file not found. It will be created.");
		} else {
			console.log("An error occured while trying to open history file: "+file_err);
		}
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
		unsaved_history.push(data);

		//Avoid a memory overload
		if (history.length > MAX_HISTORY_LENGTH) {
			history.pop();
		}
}

setInterval(function(){
	if (unsaved_history.length > 0) {
		fs.open(HISTORY_FILE, 'a', function (err, fd){
			if (err) console.error("Unable to save history:", err);
			else {
				var tobesaved = unsaved_history;
				unsaved_history = [];
				var data_str = "";
				data_str += tobesaved
								.map(JSON.stringify)
								.join("\n");
				data_str += "\n#" + (new Date()).toString() + "\n";
				fs.write(fd, data_str);
				fs.close(fd);
			}
		});
	}
}, 10*1000);

if (exports) {
	exports.start = function(app){
		io = iolib.listen(app, {'log':false});
		io.sockets.on('connection', socketConnection);
		return io;
	};
	exports.HISTORY_FILE = HISTORY_FILE;
}
