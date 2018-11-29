var iolib = require('socket.io')
	, path = require("path")
	, fs = require('fs')
	, BoardData = require("./boardData.js").BoardData;

var MAX_EMIT_PER_MS = 32 / 1000; // Maximum number of emitions /ms before getting banned

var boards = {
	"anonymous": {
		"data": new BoardData("anonymous"),
	}
};

function noFail(fn) {
	return function noFailWrapped(arg) {
		try {
			return fn(arg);
		} catch (e) {
			console.trace(e);
		}
	}
}

function startIO(app) {
	io = iolib(app);
	io.on('connection', noFail(socketConnection));
	return io;
}

function getBoard(name) {
	var board = boards[name];
	if (!board) {
		boards[name] = board = {
			"data": new BoardData(name)
		};
	}
	return board;
}

function socketConnection(socket) {
	socket.on("getboard", noFail(function onGetBoard(name) {

		// Default to the public board
		if (!name) name = "anonymous";

		var board_data = getBoard(name).data;

		// Join the board
		socket.join(name);

		//Send all the board's data as soon as it's loaded
		var sendIt = function () {
			socket.emit("broadcast", { _children: board_data.getAll() });
		};

		if (board_data.ready) sendIt();
		else board_data.on("ready", sendIt);
	}));

	var connectTime = Date.now();
	var emitCount = 0;
	socket.on('broadcast', noFail(function onBroadcast(message) {
		emitCount++;
		var elapsedTime = Date.now() - connectTime;
		if (emitCount / elapsedTime > MAX_EMIT_PER_MS) {
			var request = socket.client.request;
			console.log(JSON.stringify({
				event: 'banned',
				user_agent: request.headers['user-agent'],
				original_ip: request.headers['x-forwarded-for'] || request.headers['forwarded'],
				connect_time: connectTime,
				rate: emitCount / elapsedTime
			}));
			return;
		}
		if (elapsedTime > 1000 * 60) {
			connectTime = Date.now();
			emitCount = 0;
		}

		var boardName = message.board || "anonymous";
		var data = message.data;

		if (!data) {
			console.warn("Received invalid message: %s.", JSON.stringify(message));
			return;
		}

		//Send data to all other users connected on the same board
		socket.broadcast.to(boardName).emit('broadcast', data);

		saveHistory(boardName, data);
	}));
}

function saveHistory(boardName, message) {
	var id = message.id;
	var boardData = getBoard(boardName).data;
	switch (message.type) {
		case "delete":
			if (id) boardData.delete(id);
			break;
		case "update":
			delete message.type;
			if (id) boardData.update(id, message);
			break;
		case "child":
			boardData.addChild(message.parent, message);
			break;
		default: //Add data
			if (!id) throw new Error("Invalid message: ", message);
			boardData.set(id, message);
	}
}

function generateUID(prefix, suffix) {
	var uid = Date.now().toString(36); //Create the uids in chronological order
	uid += (Math.round(Math.random() * 36)).toString(36); //Add a random character at the end
	if (prefix) uid = prefix + uid;
	if (suffix) uid = uid + suffix;
	return uid;
}

if (exports) {
	exports.start = function (app) {
		getBoard("anonymous").data.on("ready", function () {
			startIO(app);
		});
	};
}
