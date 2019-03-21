var iolib = require('socket.io')
	, log = require("./log.js").log
	, BoardData = require("./boardData.js").BoardData;

var MAX_EMIT_COUNT = 64; // Maximum number of draw operations before getting banned
var MAX_EMIT_COUNT_PERIOD = 5000; // Duration (in ms) after which the emit count is reset

// Map from name to *promises* of BoardData
var boards = {};

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

/** Returns a promise to a BoardData with the given name*/
function getBoard(name) {
	if (boards.hasOwnProperty(name)) {
		return boards[name];
	} else {
		var board = BoardData.load(name);
		boards[name] = board;
		return board;
	}
}

function socketConnection(socket) {

	function joinBoard(name) {
		// Default to the public board
		if (!name) name = "anonymous";

		// Join the board
		socket.join(name);

		return getBoard(name).then(board => {
			board.users.add(socket.id);
			log('board joined', { 'board': board.name, 'users': board.users.size });
			return board;
		});
	}

	socket.on("getboard", noFail(function onGetBoard(name) {
		joinBoard(name).then(board => {
			//Send all the board's data as soon as it's loaded
			socket.emit("broadcast", { _children: board.getAll() });
		});
	}));

	socket.on("joinboard", noFail(joinBoard));

	var lastEmitSecond = Date.now() / MAX_EMIT_COUNT_PERIOD | 0;
	var emitCount = 0;
	socket.on('broadcast', noFail(function onBroadcast(message) {
		var currentSecond = Date.now() / MAX_EMIT_COUNT_PERIOD | 0;
		if (currentSecond === lastEmitSecond) {
			emitCount++;
			if (emitCount > MAX_EMIT_COUNT) {
				var request = socket.client.request;
				log('BANNED', {
					user_agent: request.headers['user-agent'],
					original_ip: request.headers['x-forwarded-for'] || request.headers['forwarded'],
					emit_count: emitCount
				});
				return;
			}
		} else {
			emitCount = 0;
			lastEmitSecond = currentSecond;
		}

		var boardName = message.board || "anonymous";
		var data = message.data;

		if (!socket.rooms.hasOwnProperty(boardName)) socket.join(boardName);

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
				boards[room].then(board => {
					board.users.delete(socket.id);
					var userCount = board.users.size;
					log('disconnection', { 'board': board.name, 'users': board.users.size });
					if (userCount === 0) {
						board.save();
						delete boards[room];
					}
				});
			}
		});
	});
}

function saveHistory(boardName, message) {
	var id = message.id;
	getBoard(boardName).then(board => {
		switch (message.type) {
			case "delete":
				if (id) board.delete(id);
				break;
			case "update":
				delete message.type;
				if (id) board.update(id, message);
				break;
			case "child":
				board.addChild(message.parent, message);
				break;
			default: //Add data
				if (!id) throw new Error("Invalid message: ", message);
				board.set(id, message);
		}
	});
}

function generateUID(prefix, suffix) {
	var uid = Date.now().toString(36); //Create the uids in chronological order
	uid += (Math.round(Math.random() * 36)).toString(36); //Add a random character at the end
	if (prefix) uid = prefix + uid;
	if (suffix) uid = uid + suffix;
	return uid;
}

if (exports) {
	exports.start = startIO;
}
