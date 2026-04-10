var iolib = require("socket.io"),
  { log, gauge, monitorFunction } = require("./log.js"),
  BoardData = require("./boardData.js").BoardData,
  config = require("./configuration"),
  jsonwebtoken = require("jsonwebtoken"),
  roleInBoard = require("./jwtBoardnameAuth.js").roleInBoard;

/** Map from name to *promises* of BoardData
  @type {{[boardName: string]: Promise<BoardData>}}
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
  const monitored = monitorFunction(fn);
  return function noFailWrapped() {
    try {
      const result = monitored.apply(this, arguments);
      if (result && typeof result.catch === "function") {
        return result.catch(function logError(err) {
          console.trace(err);
        });
      }
      return result;
    } catch (e) {
      console.trace(e);
    }
  };
}

function getSocketToken(socket) {
  return socket.handshake.query && socket.handshake.query.token;
}

function accessRole(boardName, socket) {
  if (!config.AUTH_SECRET_KEY) return "editor";
  return roleInBoard(getSocketToken(socket), boardName);
}

function canAccessBoard(boardName, socket) {
  return accessRole(boardName, socket) !== "forbidden";
}

function writerRole(boardName, socket) {
  if (!config.AUTH_SECRET_KEY) return "forbidden";
  const role = accessRole(boardName, socket);
  return role === "editor" || role === "moderator" ? role : "forbidden";
}

function canWriteToBoard(board, socket) {
  if (!board.isReadOnly()) return true;
  return writerRole(board.name, socket) !== "forbidden";
}

function startIO(app) {
  io = iolib(app);
  if (config.AUTH_SECRET_KEY) {
    // Middleware to check for valid jwt
    io.use(function (socket, next) {
      if (socket.handshake.query && socket.handshake.query.token) {
        jsonwebtoken.verify(
          socket.handshake.query.token,
          config.AUTH_SECRET_KEY,
          function (err, decoded) {
            if (err)
              return next(new Error("Authentication error: Invalid JWT"));
            next();
          },
        );
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
    if (!canAccessBoard(name, socket)) {
      throw new Error("Access forbidden");
    }

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
    }),
  );

  socket.on(
    "getboard",
    noFail(async function onGetBoard(name) {
      var board = await joinBoard(name);
      socket.emit("boardstate", {
        readonly: board.isReadOnly(),
        canWrite: canWriteToBoard(board, socket),
      });
      //Send all the board's data as soon as it's loaded
      socket.emit("broadcast", { _children: board.getAll() });
    }),
  );

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

      if (!canAccessBoard(boardName, socket)) {
        log("ACCESS BLOCKED", { board: boardName });
        return;
      }
      if (!socket.rooms.has(boardName)) socket.join(boardName);

      if (!data) {
        console.warn("Received invalid message: %s.", JSON.stringify(message));
        return;
      }

      if (
        !(data.tool || data.type === "child") ||
        config.BLOCKED_TOOLS.includes(data.tool)
      ) {
        log("BLOCKED MESSAGE", data);
        return;
      }

      var board = await getBoard(boardName);
      if (
        data.tool !== "Cursor" &&
        (!canWriteToBoard(board, socket) ||
          (data.type === "clear" &&
            writerRole(board.name, socket) !== "moderator"))
      ) {
        log("WRITE BLOCKED", {
          board: board.name,
          tool: data.tool,
          type: data.type,
        });
        return;
      }

      // Save the message in the board
      handleMessage(
        board,
        data.tool === "Cursor" ? data : JSON.parse(JSON.stringify(data)),
        socket,
      );

      //Send data to all other users connected on the same board
      socket.broadcast.to(boardName).emit("broadcast", data);
    }),
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

function handleMessage(board, message, socket) {
  if (message.tool === "Cursor") {
    message.socket = socket.id;
  } else {
    saveHistory(board, message);
  }
}

function saveHistory(board, message) {
  if (!(message.tool || message.type === "child") && !message._children) {
    console.error("Received a badly formatted message (no tool). ", message);
  }
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
