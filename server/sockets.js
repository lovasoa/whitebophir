var iolib = require('socket.io')
	, path = require("path")
	, fs = require('fs')
	, BoardData = require("./boardData.js").BoardData;

var MAX_EMIT_COUNT = 64; // Maximum number of draw operations before getting banned
var MAX_EMIT_COUNT_PERIOD = 5000; // Duration (in ms) after which the emit count is reset

function Board(name) {
	this.name = name;
	this.data = new BoardData(name);
	this.users = new Set();
}

var boards = {
	"anonymous": new Board("anonymous")
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
	if (boards.hasOwnProperty(name)) {
		return boards[name];
	} else {
		var board = new Board(name);
		boards[name] = board;
		return board;
	}
}

function socketConnection(socket) {
	socket.on("getboard", noFail(function onGetBoard(name) {

		// Default to the public board
		if (!name) name = "anonymous";

		var board = getBoard(name);
		var board_data = board.data;

		// Join the board
		socket.join(name);
		board.users.add(socket.id);
		console.log(board.users.size + " users in " + board.name);

		//Send all the board's data as soon as it's loaded
		var sendIt = function () {
			socket.emit("broadcast", { _children: board_data.getAll() });
		};

		if (board_data.ready) sendIt();
		else board_data.once("ready", sendIt);
	}));

	var lastEmitSecond = Date.now() / MAX_EMIT_COUNT_PERIOD | 0;
	var emitCount = 0;
	socket.on('broadcast', noFail(function onBroadcast(message) {
		var currentSecond = Date.now() / MAX_EMIT_COUNT_PERIOD | 0;
		if (currentSecond === lastEmitSecond) {
			emitCount++;
			if (emitCount > MAX_EMIT_COUNT) {
				var request = socket.client.request;
				console.log(JSON.stringify({
					event: 'banned',
					user_agent: request.headers['user-agent'],
					original_ip: request.headers['x-forwarded-for'] || request.headers['forwarded'],
					time: currentSecond,
					emit_count: emitCount
				}));
				return;
			}
		} else {
			console.log(emitCount);
			emitCount = 0;
			lastEmitSecond = currentSecond;
		}

		var boardName = message.board || "anonymous";
		var data = message.data;

		if (!data) {
			console.warn("Received invalid message: %s.", JSON.stringify(message));
			return;
		}

		//Send data to all other users connected on the same board
		socket.broadcast.to(boardName).emit('broadcast', data);

		// Save the message in the board
		saveHistory(boardName, data);
	}));

	socket.on('disconnecting', function onDisconnecting(reason) {
		Object.keys(socket.rooms).forEach(function disconnectFrom(room) {
			if (boards.hasOwnProperty(room)) {
				boards[room].users.delete(socket.id);
				var userCount = boards[room].users.size;
				console.log(userCount + " users in " + room);
				if (userCount === 0) {
					boards[room].data.save();
					delete boards[room];
				}
			}
		});
	});
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
