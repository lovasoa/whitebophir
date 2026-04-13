var { Server, Socket } = require("socket.io"),
  { log, gauge, monitorFunction } = require("./log.js"),
  BoardData = require("./boardData.js").BoardData,
  config = require("./configuration"),
  jsonwebtoken = require("jsonwebtoken"),
  socketPolicy = require("./socket_policy.js"),
  WBOMessageCommon = require("../client-data/js/message_common.js");

var canAccessBoard = socketPolicy.canAccessBoard;
var canApplyBoardMessage = socketPolicy.canApplyBoardMessage;
var canWriteToBoard = socketPolicy.canWriteToBoard;
var countConstructiveActions = socketPolicy.countConstructiveActions;
var countDestructiveActions = socketPolicy.countDestructiveActions;
var getClientIp = socketPolicy.getClientIp;
var normalizeBroadcastData = socketPolicy.normalizeBroadcastData;
var parseForwardedHeader = socketPolicy.parseForwardedHeader;

/** Map from name to *promises* of BoardData
  @type {{[boardName: string]: Promise<BoardData>}}
*/
var boards = {};
var destructiveRateLimits = new Map();
var constructiveRateLimits = new Map();
var io;
/**
 * Prevents a function from throwing errors.
 * If the inner function throws, the outer function just returns undefined
 * and logs the error.
 * @template {(...args: any[]) => any} A
 * @param {A} fn
 * @returns {A}
 */
function noFail(fn) {
  const monitored = monitorFunction(fn);
  return /** @type {A} */ (function noFailWrapped() {
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
  });
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

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
        error: errorMessage(err),
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

function normalizeTurnstileHostname(hostname) {
  if (!hostname || typeof hostname !== "string") return null;
  return hostname.trim().toLowerCase().replace(/\.$/, "").split(":")[0] || null;
}

function getExpectedTurnstileHostname(socket) {
  var headers = getSocketRequest(socket).headers || {};
  var host = headers["x-forwarded-host"] || headers.host;
  if (Array.isArray(host)) host = host[0];
  if (!host || typeof host !== "string") return null;
  return normalizeTurnstileHostname(host.split(",")[0]);
}

function isTurnstileValidationActive(socket, now) {
  return (
    typeof socket.turnstileValidatedUntil === "number" &&
    socket.turnstileValidatedUntil > now
  );
}

function buildTurnstileAck(socket) {
  return {
    success: true,
    validationWindowMs: config.TURNSTILE_VALIDATION_WINDOW_MS,
    validatedUntil: socket.turnstileValidatedUntil,
  };
}

function validateTurnstileResult(socket, result) {
  if (!result || result.success !== true) {
    return { ok: false, reason: "siteverify_failed" };
  }

  var expectedHostname = getExpectedTurnstileHostname(socket);
  var actualHostname = normalizeTurnstileHostname(result.hostname);
  if (
    !actualHostname ||
    (expectedHostname &&
      actualHostname !== expectedHostname &&
      !(actualHostname === "example.com" && expectedHostname === "localhost"))
  ) {
    return { ok: false, reason: "hostname_mismatch" };
  }

  return { ok: true };
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

function getConstructiveRateLimitState(clientIp, now) {
  var rateLimitState =
    constructiveRateLimits.get(clientIp) || createRateLimitState(now);
  constructiveRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

function enforceConstructiveRateLimit(socket, boardName, data, clientIp, now) {
  var constructiveCost = countConstructiveActions(data);
  if (constructiveCost === 0) return true;

  var rateLimitState = getConstructiveRateLimitState(clientIp, now);
  var constructiveCount = consumeFixedWindowRateLimit(
    rateLimitState,
    constructiveCost,
    config.MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS,
    now,
  );
  if (constructiveCount > config.MAX_CONSTRUCTIVE_ACTIONS_PER_IP) {
    closeRateLimitedSocket(
      socket,
      "CONSTRUCTIVE_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        ip: clientIp,
        ip_source: config.IP_SOURCE,
        count: constructiveCount,
        limit: config.MAX_CONSTRUCTIVE_ACTIONS_PER_IP,
        period_ms: config.MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS,
        constructive_cost: constructiveCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(
    constructiveRateLimits,
    config.MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS,
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

function cloneMessageForPersistence(data) {
  return data.tool === "Cursor" ? data : structuredClone(data);
}

function startIO(app) {
  io = new Server(app);
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
 * @param {Socket & { turnstileValidatedUntil?: number }} socket
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

  socket.on(
    "turnstile_token",
    noFail(async function onTurnstileToken(token, ack) {
      if (!config.TURNSTILE_SECRET_KEY) {
        if (typeof ack === "function") ack(true);
        return;
      }
      try {
        var clientIp = resolveClientIp(socket, "anonymous");
        var requestBody = new URLSearchParams({
          secret: config.TURNSTILE_SECRET_KEY,
          response: token,
        });
        if (clientIp !== null) requestBody.set("remoteip", clientIp);
        var response = await fetch(config.TURNSTILE_VERIFY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: requestBody,
        });
        var result = await response.json();
        var validation = validateTurnstileResult(socket, result);
        if (validation.ok) {
          socket.turnstileValidatedUntil =
            Date.now() + config.TURNSTILE_VALIDATION_WINDOW_MS;
          if (typeof ack === "function") ack(buildTurnstileAck(socket));
        } else {
          log("TURNSTILE REJECTED", {
            ip: clientIp,
            error_codes: result["error-codes"],
            reason: validation.reason,
            hostname: result.hostname,
          });
          if (typeof ack === "function") ack({ success: false });
        }
      } catch (err) {
        log("TURNSTILE ERROR", { error: errorMessage(err) });
        if (typeof ack === "function") ack({ success: false });
      }
    }),
  );

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
        config.TURNSTILE_SECRET_KEY &&
        data &&
        WBOMessageCommon.requiresTurnstile(boardName, data.tool) &&
        !isTurnstileValidationActive(socket, now)
      ) {
        return;
      }
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
      if (!ensureSocketCanAccessBoard(socket, boardName)) return;

      const normalized = normalizeBroadcastData(message, data);
      if (normalized.ok === false) return;
      data = normalized.value;
      if (!enforceDestructiveRateLimit(socket, boardName, data, clientIp, now))
        return;
      if (!enforceConstructiveRateLimit(socket, boardName, data, clientIp, now))
        return;

      ensureSocketJoinedBoard(socket, boardName);

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
      const handleResult = handleMessage(
        board,
        cloneMessageForPersistence(data),
        socket,
      );
      if (!handleResult.ok) {
        log("BOARD_MESSAGE_REJECTED", {
          board: board.name,
          tool: data.tool,
          type: data.type,
          reason: handleResult.reason,
        });
        return;
      }

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
    return { ok: true };
  }
  return saveHistory(board, message);
}

function saveHistory(board, message) {
  if (!(message.tool || message.type === "child") && !message._children) {
    console.error("Received a badly formatted message (no tool). ", message);
  }
  return board.processMessage(message);
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
    countConstructiveActions,
    createRateLimitState,
    getClientIp,
    normalizeBroadcastData,
    parseForwardedHeader,
    pruneRateLimitMap,
    resetRateLimitMaps: function resetRateLimitMaps() {
      destructiveRateLimits.clear();
      constructiveRateLimits.clear();
    },
  };
}
