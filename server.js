var app = require('http').createServer(handler)
  , io = require('socket.io').listen(app, {log:false})
  , fs = require('fs')

var PORT = 8080;

app.listen(PORT);
console.log("Server listening on "+PORT);

function handler (req, res) {
  fs.readFile(__dirname + '/index.html',
  function (err, data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading index.html');
    }

    res.writeHead(200);
    res.end(data);
  });
}


var MAX_HISTORY_LENGTH = 1e5; //Size of the history
var history = [];

io.sockets.on('connection', function (socket) {
	//On the first connection, send all previously broadcasted data
	for (var i=0;i<history.length;i++){
		socket.emit("broadcast", history[i]);
	}

	socket.on('broadcast', function (data) {
		//Send data to all other connected users
		socket.broadcast.emit('broadcast', data);
		
		//Save the data in memory
		history.push(data);
		//Avoid a memory overload
		if (history.length > MAX_HISTORY_LENGTH) {
			history.pop();
		}
	});

});
