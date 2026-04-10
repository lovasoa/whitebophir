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
var destructiveRateLimits = new Map();

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

function createRateLimitState(now) {
  return { windowStart: now, count: 0, lastSeen: now };
}

function consumeFixedWindowRateLimit(state, cost, periodMs, now) {
  if (now - state.windowStart >= periodMs) {
    state.windowStart = now;
    state.count = 0;
  }
  state.lastSeen = now;
  state.count += cost;
  return state.count;
}

function pruneRateLimitMap(map, periodMs, now) {
  map.forEach(function pruneEntry(state, key) {
    if (now - state.lastSeen >= 2 * periodMs) {
      map.delete(key);
    }
  });
}

function getSocketRequest(socket) {
  return socket.client.request;
}

function getSocketHeaders(socket) {
  return getSocketRequest(socket).headers || {};
}

function parseForwardedHeader(value) {
  var firstProxy = value.split(",")[0];
  var forwardedFor = firstProxy
    .split(";")
    .map(function trimPart(part) {
      return part.trim();
    })
    .find(function isForPart(part) {
      return /^for=/i.test(part);
    });
  if (!forwardedFor) {
    throw new Error("Missing for= in Forwarded header");
  }

  var resolved = forwardedFor.replace(/^for=/i, "").trim();
  if (
    resolved.startsWith('"') &&
    resolved.endsWith('"') &&
    resolved.length >= 2
  ) {
    resolved = resolved.slice(1, -1);
  }
  if (!resolved) {
    throw new Error("Invalid Forwarded header");
  }
  return resolved;
}

function getClientIp(socket) {
  var request = getSocketRequest(socket);
  var headers = getSocketHeaders(socket);

  switch (config.IP_SOURCE) {
    case "remoteAddress":
      if (request.socket && request.socket.remoteAddress) {
        return request.socket.remoteAddress;
      }
      throw new Error("Missing remoteAddress");

    case "X-Forwarded-For":
      if (headers["x-forwarded-for"]) {
        var xForwardedFor = headers["x-forwarded-for"].split(",")[0].trim();
        if (xForwardedFor) return xForwardedFor;
      }
      throw new Error(
        "Missing x-forwarded-for header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
      );

    case "Forwarded":
      if (headers["forwarded"]) {
        return parseForwardedHeader(headers["forwarded"]);
      }
      throw new Error(
        "Missing Forwarded header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
      );
  }
}

function countDestructiveActions(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data._children)) {
    return data._children.reduce(function countDeletes(total, child) {
      return total + (child && child.type === "delete" ? 1 : 0);
    }, 0);
  }
  return data.type === "delete" || data.type === "clear" ? 1 : 0;
}

function closeSocket(socket, eventName, infos) {
  log(eventName, infos);
  socket.disconnect(true);
}

function closeRateLimitedSocket(socket, eventName, infos) {
  socket.emit("rate-limited", {
    event: eventName,
  });
  closeSocket(socket, eventName, infos);
}

function getBoardName(message) {
  return (message && message.board) || "anonymous";
}

function getMessageData(message) {
  return message && message.data;
}

function buildSocketLogInfo(socket, boardName, extras) {
  var request = getSocketRequest(socket);
  return Object.assign(
    {
      board: boardName,
      socket: socket.id,
      user_agent: request.headers["user-agent"],
    },
    extras,
  );
}

function resolveClientIp(socket, boardName) {
  try {
    return getClientIp(socket);
  } catch (err) {
    log(
      "INVALID_IP_SOURCE",
      buildSocketLogInfo(socket, boardName, {
        ip_source: config.IP_SOURCE,
        error: err.message,
      }),
    );
    // Fallback to remoteAddress
    var request = getSocketRequest(socket);
    if (request.socket && request.socket.remoteAddress) {
      return request.socket.remoteAddress;
    }
    return "unknown";
  }
}

function enforceGeneralRateLimit(
  socket,
  boardName,
  clientIp,
  rateLimitState,
  now,
) {
  var emitCount = consumeFixedWindowRateLimit(
    rateLimitState,
    1,
    config.MAX_EMIT_COUNT_PERIOD,
    now,
  );
  if (emitCount <= config.MAX_EMIT_COUNT) return true;

  closeRateLimitedSocket(
    socket,
    "GENERAL_RATE_LIMIT_EXCEEDED",
    buildSocketLogInfo(socket, boardName, {
      ip: clientIp,
      ip_source: config.IP_SOURCE,
      count: emitCount,
      limit: config.MAX_EMIT_COUNT,
      period_ms: config.MAX_EMIT_COUNT_PERIOD,
    }),
  );
  return false;
}

function getDestructiveRateLimitState(clientIp, now) {
  var rateLimitState =
    destructiveRateLimits.get(clientIp) || createRateLimitState(now);
  destructiveRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

function enforceDestructiveRateLimit(socket, boardName, data, clientIp, now) {
  var destructiveCost = countDestructiveActions(data);
  if (destructiveCost === 0) return true;

  var rateLimitState = getDestructiveRateLimitState(clientIp, now);
  var destructiveCount = consumeFixedWindowRateLimit(
    rateLimitState,
    destructiveCost,
    config.MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS,
    now,
  );
  if (destructiveCount > config.MAX_DESTRUCTIVE_ACTIONS_PER_IP) {
    closeRateLimitedSocket(
      socket,
      "DESTRUCTIVE_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        ip: clientIp,
        ip_source: config.IP_SOURCE,
        count: destructiveCount,
        limit: config.MAX_DESTRUCTIVE_ACTIONS_PER_IP,
        period_ms: config.MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS,
        destructive_cost: destructiveCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(
    destructiveRateLimits,
    config.MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS,
    now,
  );
  return true;
}

function ensureSocketCanAccessBoard(socket, boardName) {
  if (canAccessBoard(boardName, socket)) return true;
  log("ACCESS BLOCKED", { board: boardName });
  return false;
}

function ensureSocketJoinedBoard(socket, boardName) {
  if (!socket.rooms.has(boardName)) socket.join(boardName);
}

function validateBroadcastData(message, data) {
  if (!data) {
    console.warn("Received invalid message: %s.", JSON.stringify(message));
    return false;
  }

  if (
    !(data.tool || data.type === "child") ||
    config.BLOCKED_TOOLS.includes(data.tool)
  ) {
    log("BLOCKED MESSAGE", data);
    return false;
  }

  return true;
}

function canApplyBoardMessage(board, data, socket) {
  if (data.tool === "Cursor") return true;
  if (!canWriteToBoard(board, socket)) return false;
  if (data.type === "clear" && writerRole(board.name, socket) !== "moderator") {
    return false;
  }
  return true;
}

function cloneMessageForPersistence(data) {
  return data.tool === "Cursor" ? data : JSON.parse(JSON.stringify(data));
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

  var generalRateLimit = createRateLimitState(Date.now());
  socket.on(
    "broadcast",
    noFail(async function onBroadcast(message) {
      var now = Date.now();
      var boardName = getBoardName(message);
      var data = getMessageData(message);
      var clientIp = resolveClientIp(socket, boardName);

      if (clientIp === null) return;
      if (
        !enforceGeneralRateLimit(
          socket,
          boardName,
          clientIp,
          generalRateLimit,
          now,
        )
      )
        return;
      if (!enforceDestructiveRateLimit(socket, boardName, data, clientIp, now))
        return;
      if (!ensureSocketCanAccessBoard(socket, boardName)) return;

      ensureSocketJoinedBoard(socket, boardName);
      if (!validateBroadcastData(message, data)) return;

      var board = await getBoard(boardName);
      if (!canApplyBoardMessage(board, data, socket)) {
        log("WRITE BLOCKED", {
          board: board.name,
          tool: data.tool,
          type: data.type,
        });
        return;
      }

      // Save the message in the board
      handleMessage(board, cloneMessageForPersistence(data), socket);

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
  exports.__test = {
    handleSocketConnection,
    consumeFixedWindowRateLimit,
    countDestructiveActions,
    createRateLimitState,
    getClientIp,
    parseForwardedHeader,
    pruneRateLimitMap,
    resetRateLimitMaps: function resetRateLimitMaps() {
      destructiveRateLimits.clear();
    },
  };
}
