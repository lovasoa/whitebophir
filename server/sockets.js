var iolib = require('socket.io')
	, log = require("./log.js").log
	, BoardData = require("./boardData.js").BoardData
	, config = require("./configuration");

/** Map from name to *promises* of BoardData
	@type {Object<string, Promise<BoardData>>}
*/
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

/** Returns a promise to a BoardData with the given name
 * @returns {Promise<BoardData>}
*/
async function getBoard(name) {
	if (boards.hasOwnProperty(name)) {
		return boards[name];
	} else {
		var board = await BoardData.load(name);
		boards[name] = board;
		return board;
	}
}

function socketConnection(socket) {

	async function joinBoard(name) {
		// Join the board
		socket.join(name);

		var board = await getBoard(name);
		board.users.add(socket.id);
		log('board joined', { 'board': board.name, 'users': board.users.size });
		return board;
	}

	socket.on("getSelectedElements", function getSelectedElements(name) {
		boards[name].selectedElements.map(el => {
			socket.emit('broadcast', { type: "update", selectElement: el.id, tool: "Cursor" });
		});
	});

	socket.on("error", noFail(function onError(error) {
		log("ERROR", error);
	}));

	socket.on("getboard", async function onGetBoard(name) {
		var board = await joinBoard(name);
		//Send all the board's data as soon as it's loaded
		socket.emit("broadcast", { _children: board.getAll() });
	});

	socket.on("joinboard", noFail(joinBoard));

	var lastEmitSecond = Date.now() / config.MAX_EMIT_COUNT_PERIOD | 0;
	var emitCount = 0;
	socket.on('broadcast', noFail(async function onBroadcast(message) {
		var currentSecond = Date.now() / config.MAX_EMIT_COUNT_PERIOD | 0;
		if (currentSecond === lastEmitSecond) {
			emitCount++;
			if (emitCount > config.MAX_EMIT_COUNT) {
				var request = socket.client.request;
				if (emitCount % 100 === 0) {
					log('BANNED', {
						user_agent: request.headers['user-agent'],
						original_ip: request.headers['x-forwarded-for'] || request.headers['forwarded'],
						emit_count: emitCount
					});
				}
				return;
			}
		} else {
			emitCount = 0;
			lastEmitSecond = currentSecond;
		}

		var boardName = message.board;
		var data = message.data;

		if (!socket.rooms.hasOwnProperty(boardName)) socket.join(boardName);

		var boardData;
		if (message.data.type === "doc") {
			boardData = await getBoard(boardName);

			if (message.data.data.length > config.MAX_DOCUMENT_SIZE) {
				console.warn("Received too large file");
				return;
			}
		}

		if (!data) {
			console.warn("Received invalid message: %s.", JSON.stringify(message));
			return;
		}

		if (!message.data.tool || config.BLOCKED_TOOLS.includes(message.data.tool)) {
			log('BLOCKED MESSAGE', message.data);
			return;
		}

		// Save the message in the board
		handleMessage(boardName, data, socket);

		//Send data to all other users connected on the same board
		socket.broadcast.to(boardName).emit('broadcast', data);
	}));

	socket.on('disconnecting', function onDisconnecting(reason) {
		Object.keys(socket.rooms).forEach(async function disconnectFrom(room) {
			if (boards.hasOwnProperty(room)) {
				var board = await boards[room];
				board.users.delete(socket.id);
				const unSelectIndex = board.selectedElements.findIndex(function (el) {
					return el.socketID === socket.id;
				});
				if (unSelectIndex !== -1) {
					socket.broadcast.to(room).emit('broadcast', { unSelectElement: board.selectedElements[unSelectIndex].id, tool: "Cursor" });
					board.selectedElements.splice(unSelectIndex, 1);
				}
				var userCount = board.users.size;
				log('disconnection', { 'board': board.name, 'users': board.users.size });
				if (userCount === 0) {
					board.save();
					delete boards[room];
				}
			}
		});
	});
}

async function handleMessage(boardName, message, socket) {
	if (message.tool === "Cursor") {
		message.socket = socket.id;
		var localBoard = await getBoard(boardName);
		if (message.selectElement) {
			const inList = localBoard.selectedElements.findIndex(function (el) {
				return el.id === message.selectElement;
			}) !== -1;
			if (inList === false) {
				const unSelectIndex = localBoard.selectedElements.findIndex(function (el) {
					return el.socketID === message.socket;
				});
				if (unSelectIndex !== -1) {
					socket.broadcast.to(boardName).emit('broadcast', { unSelectElement: localBoard.selectedElements[unSelectIndex].id, tool: "Cursor" });
					localBoard.selectedElements.splice(unSelectIndex, 1);
				}
				localBoard.selectedElements.push({ id: message.selectElement, socketID: message.socket});
			}
		}
		if (message.unSelectElement) {
			const unSelectIndex = localBoard.selectedElements.findIndex(function (el) {
				return el.id === message.unSelectElement;
			});
			if (unSelectIndex !== -1) {
				localBoard.selectedElements.splice(unSelectIndex, 1);
			}
		}
	}
	else {
		saveHistory(boardName, message, socket);
	}
}

async function saveHistory(boardName, message, socket) {
	var id = message.id;
	var board = await getBoard(boardName);
	switch (message.type) {
		case "dublicate":
			socket.emit("dublicateObject", board.get(id));
			break;
		case "delete":
			if (id) {
				if (message.sendBack && !message.sendToRedo) {
					socket.emit("addActionToHistory", board.get(id));
				} else if (message.sendBack && message.sendToRedo) {
					socket.emit("addActionToHistoryRedo", board.get(id));
				}
				board.delete(id);
			};
			break;
		case "update":
			if (id) board.update(id, message);
			break;
		case "child":
			board.addChild(message.parent, message);
			break;
		case "clearBoard":
			if (boards[board.name]) {
				boards[board.name].board = {};
			}
			board.clearAll();
			socket.broadcast.to(board.name).emit('deleteBoard');
			break;
		default: //Add data
			if (!id) throw new Error("Invalid message: ", message);
			board.set(id, message);
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
	exports.start = startIO;
}
