var iolib = require("socket.io"),
  { log, gauge, monitorFunction } = require("./log.js"),
  BoardData = require("./boardData.js").BoardData,
  config = require("./configuration"),
  jsonwebtoken = require("jsonwebtoken");

/** Map from name to *promises* of BoardData
  @type {{[boardName: string]: Promise<BoardData>}}
*/
var boards = {};

var globalio;

/**
 * Prevents a function from throwing errors.
 * If the inner function throws, the outer function just returns undefined
 * and logs the error.
 * @template A
 * @param {A} fn
 * @returns {A}
 */
function noFail(fn) {
  const monitored = monitorFunction(fn);
  return function noFailWrapped(arg) {
    try {
      return monitored(arg);
    } catch (e) {
      console.trace(e);
    }
  };
}

function startIO(app) {
  io = iolib(app);
  globalio = io;
  if (config.AUTH_SECRET_KEY) {
    // Middleware to check for valid jwt
    io.use(function(socket, next) {
      if(socket.handshake.query && socket.handshake.query.token) {
        jsonwebtoken.verify(socket.handshake.query.token, config.AUTH_SECRET_KEY, function(err, decoded) {
          if(err) return next(new Error("Authentication error: Invalid JWT"));
          next();
        })
      } else {
        next(new Error("Authentication error: No jwt provided"));
      }
    });
  }
  io.on("connection", noFail(handleSocketConnection));
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
    gauge("boards in memory", Object.keys(boards).length);
    return board;
  }
}

/**
 * Executes on every new connection
 * @param {iolib.Socket} socket
 */
function handleSocketConnection(socket) {
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
    gauge("connected." + name, board.users.size);
    return board;
  }

  socket.on(
    "error",
    noFail(function onSocketError(error) {
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
    noFail(async function onBroadcast(message) {
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

      var boardData;
      if (message.data.type === "doc") {
        boardData = await getBoard(boardName);
  
        if (boardData.existingDocuments >= config.MAX_DOCUMENT_COUNT) {
          console.warn("Received too many documents");
          return;
        }
  
        if (message.data.data.length > config.MAX_DOCUMENT_SIZE) {
          console.warn("Received too large file");
          return;
        }
  
        boardData.existingDocuments += 1;
      } else if (message.data.type === "delete") {
        boardData = await getBoard(boardName);
  
        if (boardData.board[message.data.id].type === "doc") {
          boardData.existingDocuments -= 1;
        }
      } else if (message.data.type === "deleteall") {
        boardData = await getBoard(boardName);
        boardData.existingDocuments = 0;
      }
  
      // Save the message in the board
      handleMessage(boardName, data, socket, globalio);

      // don't need to send log messages to other users
      if (data.type === "robotmessage" && data.msg === "log") return;
      //Send data to all other users connected on the same board
      //log("MARKD broadcast", {type: message.data.type});
      socket.broadcast.to(boardName).emit("broadcast", data);
    })
  );

  socket.on("disconnecting", function onDisconnecting(reason) {
    socket.rooms.forEach(async function disconnectFrom(room) {
      if (boards.hasOwnProperty(room)) {
        var board = await boards[room];
        board.users.delete(socket.id);
        var userCount = board.users.size;
        log("disconnection", {
          board: board.name,
          users: board.users.size,
          reason,
        });
        gauge("connected." + board.name, userCount);
        if (userCount === 0) unloadBoard(room);
      }
    });
  });
}

/**
 * Unloads a board from memory.
 * @param {string} boardName
 **/
async function unloadBoard(boardName) {
  if (boards.hasOwnProperty(boardName)) {
    const board = await boards[boardName];
    await board.save();
    log("unload board", { board: board.name, users: board.users.size });
    delete boards[boardName];
    gauge("boards in memory", Object.keys(boards).length);
  }
}

function handleMessage(boardName, message, socket, io) {
  if (message.tool === "Cursor") {
    message.socket = socket.id;
  } else {
    saveHistory(boardName, message, socket, io);
  }
}

async function saveHistory(boardName, message, socket, io) {
  if (!message.tool && !message._children) {
    console.error("Received a badly formatted message (no tool). ", message);
  }
  var board = await getBoard(boardName);
  board.processMessage(message, socket, io);
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
