var crypto = require("node:crypto"),
  { Server, Socket } = require("socket.io"),
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

/** @typedef {{[key: string]: any}} MessageData */
/** @typedef {{headers: {[key: string]: string | string[] | undefined}, socket?: {remoteAddress?: string}}} SocketRequest */
/** @typedef {{token?: string, userSecret?: string, tool?: string, color?: string, size?: string}} SocketQuery */
/** @typedef {Socket & { turnstileValidatedUntil?: number, handshake: {query?: SocketQuery} }} AppSocket */
/** @typedef {{windowStart: number, count: number, lastSeen: number}} RateLimitState */
/** @typedef {{success: true, validationWindowMs: number, validatedUntil: number | undefined}} TurnstileAck */
/** @typedef {{ok: true} | {ok: false, reason: string}} ValidationStatus */
/** @typedef {{socketId: string, userId: string, name: string, ip: string, color: string, size: number, lastTool: string, lastSeen: number}} BoardUser */

/** Map from name to *promises* of BoardData
  @type {{[boardName: string]: Promise<BoardData>}}
*/
var boards = {};
/** @type {Map<string, RateLimitState>} */
var destructiveRateLimits = new Map();
/** @type {Map<string, RateLimitState>} */
var constructiveRateLimits = new Map();
/** @type {Map<string, Map<string, BoardUser>>} */
var boardUsers = new Map();
var io;
var NAME_SYLLABLES = [
  "al",
  "an",
  "ar",
  "ba",
  "be",
  "bi",
  "bo",
  "da",
  "de",
  "di",
  "do",
  "el",
  "en",
  "er",
  "fa",
  "fe",
  "fi",
  "ga",
  "ge",
  "gi",
  "ha",
  "he",
  "hi",
  "io",
  "ka",
  "ke",
  "ki",
  "ko",
  "la",
  "le",
  "li",
  "lo",
  "lu",
  "ma",
  "me",
  "mi",
  "mo",
  "na",
  "ne",
  "ni",
  "no",
  "oa",
  "ol",
  "or",
  "pa",
  "pe",
  "pi",
  "ra",
  "re",
  "ri",
  "ro",
  "sa",
  "se",
  "si",
  "so",
  "ta",
  "te",
  "ti",
  "to",
  "ul",
  "ur",
  "va",
  "ve",
  "vi",
  "vo",
  "wa",
  "we",
  "wi",
  "ya",
  "yo",
  "za",
  "ze",
  "zi",
];
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
  return /** @type {A} */ (
    function noFailWrapped(...args) {
      try {
        const result = monitored.apply(null, args);
        if (result && typeof result.catch === "function") {
          return result.catch(function logError(/** @type {unknown} */ err) {
            console.trace(err);
          });
        }
        return result;
      } catch (e) {
        console.trace(e);
      }
    }
  );
}

/**
 * @param {number} now
 * @returns {RateLimitState}
 */
function createRateLimitState(now) {
  return { windowStart: now, count: 0, lastSeen: now };
}

/**
 * @param {RateLimitState} state
 * @param {number} cost
 * @param {number} periodMs
 * @param {number} now
 * @returns {number}
 */
function consumeFixedWindowRateLimit(state, cost, periodMs, now) {
  if (now - state.windowStart >= periodMs) {
    state.windowStart = now;
    state.count = 0;
  }
  state.lastSeen = now;
  state.count += cost;
  return state.count;
}

/**
 * @param {Map<string, RateLimitState>} map
 * @param {number} periodMs
 * @param {number} now
 * @returns {void}
 */
function pruneRateLimitMap(map, periodMs, now) {
  map.forEach(
    function pruneEntry(
      /** @type {RateLimitState} */ state,
      /** @type {string} */ key,
    ) {
      if (now - state.lastSeen >= 2 * periodMs) {
        map.delete(key);
      }
    },
  );
}

/**
 * @param {AppSocket} socket
 * @returns {SocketRequest}
 */
function getSocketRequest(socket) {
  return /** @type {SocketRequest} */ (socket.client.request);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} seed
 * @param {number} minParts
 * @param {number} maxParts
 * @returns {string}
 */
function buildPronounceableName(seed, minParts, maxParts) {
  var digest = crypto.createHash("sha256").update(seed).digest();
  var partCount = minParts;
  if (maxParts > minParts) {
    partCount += (digest[0] || 0) % (maxParts - minParts + 1);
  }
  var word = "";
  for (var index = 0; index < partCount; index++) {
    var offset = 1 + index * 2;
    var value = digest.readUInt16BE(offset);
    word +=
      NAME_SYLLABLES[value % NAME_SYLLABLES.length] ||
      NAME_SYLLABLES[0] ||
      "na";
  }
  return word;
}

/**
 * @param {AppSocket} socket
 * @param {string} key
 * @returns {string}
 */
function getSocketQueryValue(socket, key) {
  var query = socket.handshake && socket.handshake.query;
  if (!query) return "";
  var value = query[key];
  return typeof value === "string" ? value : "";
}

/**
 * @param {string} userSecret
 * @returns {string}
 */
function buildUserId(userSecret) {
  return buildPronounceableName(userSecret || "anonymous", 2, 3);
}

/**
 * @param {string} ip
 * @returns {string}
 */
function buildIpWord(ip) {
  return buildPronounceableName(ip || "unknown", 2, 2);
}

/**
 * @param {string} ip
 * @param {string} userSecret
 * @returns {string}
 */
function buildUserName(ip, userSecret) {
  return buildIpWord(ip) + " " + buildUserId(userSecret);
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {number} [now]
 * @returns {BoardUser}
 */
function buildBoardUserRecord(socket, boardName, now) {
  var userSecret = getSocketQueryValue(socket, "userSecret");
  var ip = resolveClientIp(socket, boardName);
  var size = WBOMessageCommon.clampSize(getSocketQueryValue(socket, "size"));
  var color = WBOMessageCommon.normalizeColor(getSocketQueryValue(socket, "color"));
  return {
    socketId: socket.id,
    userId: buildUserId(userSecret),
    name: buildUserName(ip, userSecret),
    ip: ip,
    color: color || "#001f3f",
    size: size,
    lastTool: getSocketQueryValue(socket, "tool") || "Hand",
    lastSeen: now || Date.now(),
  };
}

/**
 * @param {string} boardName
 * @returns {Map<string, BoardUser>}
 */
function getBoardUserMap(boardName) {
  var users = boardUsers.get(boardName);
  if (users) return users;
  users = new Map();
  boardUsers.set(boardName, users);
  return users;
}

/**
 * @param {string} boardName
 * @returns {void}
 */
function cleanupBoardUserMap(boardName) {
  var users = boardUsers.get(boardName);
  if (users && users.size === 0) {
    boardUsers.delete(boardName);
  }
}

/**
 * @param {BoardUser} user
 * @returns {{board?: string, socketId: string, userId: string, name: string, color: string, size: number, lastTool: string}}
 */
function serializeBoardUser(user) {
  return {
    socketId: user.socketId,
    userId: user.userId,
    name: user.name,
    color: user.color,
    size: user.size,
    lastTool: user.lastTool,
  };
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {boolean}
 */
function hasBoardUser(socket, boardName) {
  return getBoardUserMap(boardName).has(socket.id);
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {BoardUser}
 */
function ensureBoardUser(socket, boardName) {
  var users = getBoardUserMap(boardName);
  var existing = users.get(socket.id);
  if (existing) return existing;

  var user = buildBoardUserRecord(socket, boardName);
  users.set(socket.id, user);
  return user;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function emitBoardUsersToSocket(socket, boardName) {
  var users = getBoardUserMap(boardName);
  users.forEach(function emitUserJoined(user) {
    socket.emit(
      "user_joined",
      Object.assign({ board: boardName }, serializeBoardUser(user)),
    );
  });
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {BoardUser} user
 * @returns {void}
 */
function emitUserJoinedToBoard(socket, boardName, user) {
  socket.broadcast
    .to(boardName)
    .emit("user_joined", Object.assign({ board: boardName }, serializeBoardUser(user)));
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function removeBoardUser(socket, boardName) {
  var users = getBoardUserMap(boardName);
  if (!users.delete(socket.id)) return;

  socket.broadcast.to(boardName).emit("user_left", {
    board: boardName,
    socketId: socket.id,
  });
  cleanupBoardUserMap(boardName);
}

/**
 * @param {string} boardName
 * @param {string} socketId
 * @returns {BoardUser | undefined}
 */
function getBoardUser(boardName, socketId) {
  return getBoardUserMap(boardName).get(socketId);
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData} data
 * @param {number} now
 * @returns {BoardUser | undefined}
 */
function updateBoardUserFromMessage(socket, boardName, data, now) {
  var user = getBoardUser(boardName, socket.id);
  if (!user) return undefined;

  user.lastSeen = now;
  if (typeof data.color === "string") user.color = data.color;
  if (data.size !== undefined) user.size = Number(data.size) || user.size;
  if (typeof data.tool === "string" && data.tool !== "Cursor") {
    user.lastTool = data.tool;
  }
  return user;
}

/**
 * @param {MessageData} data
 * @param {BoardUser | undefined} user
 * @returns {MessageData}
 */
function attachLiveUserId(data, user) {
  if (!user) return data;
  data.userId = user.userId;
  return data;
}

/**
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {{[key: string]: any}} infos
 * @returns {void}
 */
function closeSocket(socket, eventName, infos) {
  log(eventName, infos);
  socket.disconnect(true);
}

/**
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {{[key: string]: any}} infos
 * @returns {void}
 */
function closeRateLimitedSocket(socket, eventName, infos) {
  socket.emit("rate-limited", {
    event: eventName,
  });
  closeSocket(socket, eventName, infos);
}

/**
 * @param {any} message
 * @returns {string}
 */
function getBoardName(message) {
  return (message && message.board) || "anonymous";
}

/**
 * @param {any} message
 * @returns {MessageData | undefined}
 */
function getMessageData(message) {
  return message && message.data;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {{[key: string]: any}} extras
 * @returns {{[key: string]: any}}
 */
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

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {string}
 */
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

/**
 * @param {any} hostname
 * @returns {string | null}
 */
function normalizeTurnstileHostname(hostname) {
  if (!hostname || typeof hostname !== "string") return null;
  return hostname.trim().toLowerCase().replace(/\.$/, "").split(":")[0] || null;
}

/**
 * @param {AppSocket} socket
 * @returns {string | null}
 */
function getExpectedTurnstileHostname(socket) {
  var headers = getSocketRequest(socket).headers || {};
  var host = headers["x-forwarded-host"] || headers.host;
  if (Array.isArray(host)) host = host[0];
  if (!host || typeof host !== "string") return null;
  return normalizeTurnstileHostname(host.split(",")[0]);
}

/**
 * @param {AppSocket} socket
 * @param {number} now
 * @returns {boolean}
 */
function isTurnstileValidationActive(socket, now) {
  return (
    typeof socket.turnstileValidatedUntil === "number" &&
    socket.turnstileValidatedUntil > now
  );
}

/**
 * @param {AppSocket} socket
 * @returns {TurnstileAck}
 */
function buildTurnstileAck(socket) {
  return {
    success: true,
    validationWindowMs: config.TURNSTILE_VALIDATION_WINDOW_MS,
    validatedUntil: socket.turnstileValidatedUntil,
  };
}

/**
 * @param {AppSocket} socket
 * @param {any} result
 * @returns {ValidationStatus}
 */
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

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {string} clientIp
 * @param {RateLimitState} rateLimitState
 * @param {number} now
 * @returns {boolean}
 */
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

/**
 * @param {string} clientIp
 * @param {number} now
 * @returns {RateLimitState}
 */
function getDestructiveRateLimitState(clientIp, now) {
  var rateLimitState =
    destructiveRateLimits.get(clientIp) || createRateLimitState(now);
  destructiveRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData} data
 * @param {string} clientIp
 * @param {number} now
 * @returns {boolean}
 */
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

/**
 * @param {string} clientIp
 * @param {number} now
 * @returns {RateLimitState}
 */
function getConstructiveRateLimitState(clientIp, now) {
  var rateLimitState =
    constructiveRateLimits.get(clientIp) || createRateLimitState(now);
  constructiveRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData} data
 * @param {string} clientIp
 * @param {number} now
 * @returns {boolean}
 */
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

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {boolean}
 */
function ensureSocketCanAccessBoard(socket, boardName) {
  if (canAccessBoard(boardName, socket)) return true;
  log("ACCESS BLOCKED", { board: boardName });
  return false;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function ensureSocketJoinedBoard(socket, boardName) {
  if (!socket.rooms.has(boardName)) socket.join(boardName);
}

/**
 * @param {MessageData} data
 * @returns {MessageData}
 */
function cloneMessageForPersistence(data) {
  return data.tool === "Cursor" ? data : structuredClone(data);
}

/**
 * @param {any} app
 * @returns {Server}
 */
function startIO(app) {
  io = new Server(app);
  if (config.AUTH_SECRET_KEY) {
    // Middleware to check for valid jwt
    io.use(function (
      /** @type {AppSocket} */ socket,
      /** @type {(error?: Error) => void} */ next,
    ) {
      if (socket.handshake.query && socket.handshake.query.token) {
        jsonwebtoken.verify(
          socket.handshake.query.token,
          config.AUTH_SECRET_KEY,
          function (/** @type {unknown} */ err, /** @type {any} */ decoded) {
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
 * @param {string} name
 * @returns {Promise<BoardData>}
 */
function getBoard(name) {
  if (boards.hasOwnProperty(name)) {
    return /** @type {Promise<BoardData>} */ (boards[name]);
  } else {
    var board = BoardData.load(name);
    boards[name] = board;
    gauge("boards in memory", Object.keys(boards).length);
    return board;
  }
}

/**
 * Executes on every new connection
 * @param {AppSocket} socket
 */
function handleSocketConnection(socket) {
  /**
   * Function to call when an user joins a board
   * @param {string} name
   */
  async function joinBoard(/** @type {string} */ name) {
    // Default to the public board
    if (!name) name = "anonymous";
    if (!canAccessBoard(name, socket)) {
      throw new Error("Access forbidden");
    }

    // Join the board
    socket.join(name);

    var board = await getBoard(name);
    var wasJoined = board.users.has(socket.id);
    board.users.add(socket.id);
    if (!wasJoined || !hasBoardUser(socket, name)) {
      var user = ensureBoardUser(socket, name);
      emitBoardUsersToSocket(socket, name);
      emitUserJoinedToBoard(socket, name, user);
    }
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
    noFail(async function onGetBoard(/** @type {string} */ name) {
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
        requestBody.set("remoteip", clientIp);
        var response = await fetch(config.TURNSTILE_VERIFY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: requestBody,
        });
        var result = await response.json();
        var validation = validateTurnstileResult(socket, result);
        if (validation.ok === true) {
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
      const normalizedData = normalized.value;
      if (
        !enforceDestructiveRateLimit(
          socket,
          boardName,
          normalizedData,
          clientIp,
          now,
        )
      )
        return;
      if (
        !enforceConstructiveRateLimit(
          socket,
          boardName,
          normalizedData,
          clientIp,
          now,
        )
      )
        return;

      ensureSocketJoinedBoard(socket, boardName);

      var board = await getBoard(boardName);
      if (!canApplyBoardMessage(board, normalizedData, socket)) {
        log("WRITE BLOCKED", {
          board: board.name,
          tool: normalizedData.tool,
          type: normalizedData.type,
        });
        return;
      }

      // Save the message in the board
      const handleResult = handleMessage(
        board,
        cloneMessageForPersistence(normalizedData),
        socket,
      );
      if (handleResult.ok === false) {
        log("BOARD_MESSAGE_REJECTED", {
          board: board.name,
          tool: normalizedData.tool,
          type: normalizedData.type,
          reason: handleResult.reason,
        });
        return;
      }

      var user = updateBoardUserFromMessage(socket, boardName, normalizedData, now);
      attachLiveUserId(normalizedData, user);

      //Send data to all other users connected on the same board
      socket.broadcast.to(boardName).emit("broadcast", normalizedData);
    }),
  );

  socket.on(
    "report_user",
    noFail(function onReportUser(message) {
      var boardName = getBoardName(message);
      var targetSocketId =
        message && typeof message.socketId === "string" ? message.socketId : "";
      if (!targetSocketId || !socket.rooms.has(boardName)) return;

      var reporter = getBoardUser(boardName, socket.id);
      var reported = getBoardUser(boardName, targetSocketId);
      if (!reporter || !reported) return;

      log("USER_REPORTED", {
        board: boardName,
        reporter_socket: reporter.socketId,
        reported_socket: reported.socketId,
        reporter_ip: reporter.ip,
        reported_ip: reported.ip,
        reporter_user_id: reporter.userId,
        reported_user_id: reported.userId,
        reporter_name: reporter.name,
        reported_name: reported.name,
      });
    }),
  );

  socket.on("disconnecting", function onDisconnecting(/** @type {string} */ reason) {
    socket.rooms.forEach(async function disconnectFrom(/** @type {string} */ room) {
      if (boards.hasOwnProperty(room)) {
        var board = await /** @type {Promise<BoardData>} */ (boards[room]);
        board.users.delete(socket.id);
        removeBoardUser(socket, room);
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
    const board = await /** @type {Promise<BoardData>} */ (boards[boardName]);
    await board.save();
    log("unload board", { board: board.name, users: board.users.size });
    delete boards[boardName];
    gauge("boards in memory", Object.keys(boards).length);
  }
}

/**
 * @param {BoardData} board
 * @param {MessageData} message
 * @param {AppSocket} socket
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function handleMessage(board, message, socket) {
  if (message.tool === "Cursor") {
    message.socket = socket.id;
    return { ok: true };
  }
  return saveHistory(board, message);
}

/**
 * @param {BoardData} board
 * @param {MessageData} message
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function saveHistory(board, message) {
  if (!(message.tool || message.type === "child") && !message._children) {
    console.error("Received a badly formatted message (no tool). ", message);
  }
  return board.processMessage(/** @type {any} */ (message));
}

/**
 * @param {string | undefined} prefix
 * @param {string | undefined} suffix
 * @returns {string}
 */
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
    buildBoardUserRecord,
    buildIpWord,
    buildUserId,
    buildUserName,
    handleSocketConnection,
    consumeFixedWindowRateLimit,
    countDestructiveActions,
    countConstructiveActions,
    createRateLimitState,
    getClientIp,
    normalizeBroadcastData,
    parseForwardedHeader,
    pruneRateLimitMap,
    cleanupBoardUserMap,
    getBoardUserMap,
    resetRateLimitMaps: function resetRateLimitMaps() {
      destructiveRateLimits.clear();
      constructiveRateLimits.clear();
      boardUsers.clear();
    },
  };
}
