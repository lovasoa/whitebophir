var iolib = require("socket.io"),
  log = require("./log.js").log,
  BoardData = require("./boardData.js").BoardData,
  config = require("./configuration");

/** Map from name to *promises* of BoardData
  @type {Object<string, Promise<BoardData>>}
*/
var boards = {};

/**
 * Prevents a function from throwing errors.
 * If the inner function throws, the outer function just returns undefined
 * and logs the error.
 * @template A
 * @param {A} fn
 * @returns {A}
 */
function noFail(fn) {
  return function noFailWrapped(arg) {
    try {
      return fn(arg);
    } catch (e) {
      console.trace(e);
    }
  };
}

function startIO(app) {
  io = iolib(app);
  io.on("connection", noFail(socketConnection));
  return io;
}

/** Returns a promise to a BoardData with the given name
 * @returns {Promise<BoardData>}
 */
function getBoard(name) {
  if (boards.hasOwnProperty(name)) {
    return boards[name];
  } else {
    var board = BoardData.load(name);
    boards[name] = board;
    return board;
  }
}

/**
 * Executes on every new connection
 * @param {iolib.Socket} socket
 */
function socketConnection(socket) {
  /**
   * Function to call when an user joins a board
   * @param {string} name
   */
  async function joinBoard(name) {
    // Default to the public board
    if (!name) name = "anonymous";

    // Join the board
    socket.join(name);

    var board = await getBoard(name);
    board.users.add(socket.id);
    log("board joined", { board: board.name, users: board.users.size });
    return board;
  }

  socket.on(
    "error",
    noFail(function onError(error) {
      log("ERROR", error);
    })
  );

  socket.on("getboard", async function onGetBoard(name) {
    var board = await joinBoard(name);
    //Send all the board's data as soon as it's loaded
    socket.emit("broadcast", { _children: board.getAll() });
  });

  socket.on("joinboard", noFail(joinBoard));

  var lastEmitSecond = (Date.now() / config.MAX_EMIT_COUNT_PERIOD) | 0;
  var emitCount = 0;
  socket.on(
    "broadcast",
    noFail(function onBroadcast(message) {
      var currentSecond = (Date.now() / config.MAX_EMIT_COUNT_PERIOD) | 0;
      if (currentSecond === lastEmitSecond) {
        emitCount++;
        if (emitCount > config.MAX_EMIT_COUNT) {
          var request = socket.client.request;
          if (emitCount % 100 === 0) {
            log("BANNED", {
              user_agent: request.headers["user-agent"],
              original_ip:
                request.headers["x-forwarded-for"] ||
                request.headers["forwarded"],
              emit_count: emitCount,
            });
          }
          return;
        }
      } else {
        emitCount = 0;
        lastEmitSecond = currentSecond;
      }

      var boardName = message.board || "anonymous";
      var data = message.data;

      if (!socket.rooms.has(boardName)) socket.join(boardName);

      if (!data) {
        console.warn("Received invalid message: %s.", JSON.stringify(message));
        return;
      }

      if (
        !message.data.tool ||
        config.BLOCKED_TOOLS.includes(message.data.tool)
      ) {
        log("BLOCKED MESSAGE", message.data);
        return;
      }

      // Save the message in the board
      handleMessage(boardName, data, socket);

      //Send data to all other users connected on the same board
      socket.broadcast.to(boardName).emit("broadcast", data);
    })
  );

  socket.on("disconnecting", function onDisconnecting(reason) {
    socket.rooms.forEach(async function disconnectFrom(room) {
      if (boards.hasOwnProperty(room)) {
        var board = await boards[room];
        board.users.delete(socket.id);
        var userCount = board.users.size;
        log("disconnection", { board: board.name, users: board.users.size });
        if (userCount === 0) {
          board.save();
          delete boards[room];
        }
      }
    });
  });
}

function handleMessage(boardName, message, socket) {
  if (message.tool === "Cursor") {
    message.socket = socket.id;
  } else {
    saveHistory(boardName, message);
  }
}

async function saveHistory(boardName, message) {
  if (!message.tool && !message._children) {
    console.error("Received a badly formatted message (no tool). ", message);
  }
  var board = await getBoard(boardName);
  board.processMessage(message);
}

function generateUID(prefix, suffix) {
  var uid = Date.now().toString(36); //Create the uids in chronological order
  uid += Math.round(Math.random() * 36).toString(36); //Add a random character at the end
  if (prefix) uid = prefix + uid;
  if (suffix) uid = uid + suffix;
  return uid;
}

if (exports) {
  exports.start = startIO;
}
