var iolib = require("socket.io"),
  { log, gauge, monitorFunction } = require("./log.js"),
  BoardData = require("./boardData.js").BoardData,
  config = require("./configuration"),
  jsonwebtoken = require("jsonwebtoken");

/** Map from name to *promises* of BoardData
  @type {{[boardName: string]: Promise<BoardData>}}
*/
let boards = null;

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

function startIO(app, boardDataList) {
  boards = boardDataList;
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
  return {
    io,
    handleImageUpload
  }
}

/** Returns a promise to a BoardData with the given name
 * @returns {Promise<BoardData>}
 */
function getBoard(name) {
  if (boards.has(name)) {
    return boards.get(name);
  } else {
    var board = BoardData.load(name);
    boards.add(name, board);
    gauge("boards in memory", boards.getCount());
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
    }),
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
    }),
  );

  socket.on("disconnecting", function onDisconnecting(reason) {
    socket.rooms.forEach(async function disconnectFrom(room) {
      if (boards.has(room)) {
        var board = await boards.get(room);
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
  * Assuming an image has been saved to disk, this function updates the board
  * to include a reference to the image and then broadcasts the update to all
  * connected clients.
  * @param {string} boardName
  * @param {string} id
  * @param {object} position
  * @param {number} position.x
  * @param {number} position.y
  * @param {object} dimensions
  * @param {number} dimensions.x
  * @param {number} dimensions.y
  */
function handleImageUpload(boardName, id, position, dimensions) {
  // Update the board to include a reference to the image.
  const message = {
    type: "image",
    id,
    x: position.x,
    y: position.y,
    tool: "Image",
    time: Date.now(),
    x2: position.x + dimensions.x,
    y2: position.y + dimensions.y,
  }
  handleMessage(boardName, message);
  io.to(boardName).emit("broadcast", message);
}

/**
 * Unloads a board from memory.
 * @param {string} boardName
 **/
async function unloadBoard(boardName) {
  if (boards.has(boardName)) {
    const board = await boards.get(boardName);
    await board.save();
    log("unload board", { board: board.name, users: board.users.size });
    boards.remove(boardName);
    gauge("boards in memory", boards.getCount());
  }
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
