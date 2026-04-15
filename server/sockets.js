const crypto = require("node:crypto");
const { Server } = require("socket.io");
const { logger, metrics, tracing } = require("./observability.js");
const { BoardData } = require("./boardData.mjs");
const config = require("./configuration");
const jsonwebtoken = require("jsonwebtoken");
const socketPolicy = require("./socket_policy.mjs");
const WBOMessageCommon = require("../client-data/js/message_common.js");
const RateLimitCommon = require("../client-data/js/rate_limit_common.js");

const canAccessBoard = socketPolicy.canAccessBoard;
const canApplyBoardMessage = socketPolicy.canApplyBoardMessage;
const canWriteToBoard = socketPolicy.canWriteToBoard;
const countConstructiveActions = socketPolicy.countConstructiveActions;
const countDestructiveActions = socketPolicy.countDestructiveActions;
const getClientIp = socketPolicy.getClientIp;
const normalizeBroadcastData = socketPolicy.normalizeBroadcastData;
const parseForwardedHeader = socketPolicy.parseForwardedHeader;
const createRateLimitState = RateLimitCommon.createRateLimitState;
const consumeFixedWindowRateLimit = RateLimitCommon.consumeFixedWindowRateLimit;
const getRateLimitRemainingMs = RateLimitCommon.getRateLimitRemainingMs;
const getEffectiveRateLimitDefinition =
  RateLimitCommon.getEffectiveRateLimitDefinition;
const isRateLimitStateStale = RateLimitCommon.isRateLimitStateStale;

/** @typedef {{token?: string, userSecret?: string, tool?: string, color?: string, size?: string}} SocketQuery */
/** @typedef {{socketId: string, userId: string, name: string, ip: string, userAgent: string, language: string, color: string, size: number, lastTool: string, lastSeen: number}} BoardUser */
/** @typedef {import("../types/server-runtime").AppSocket} AppSocket */
/** @typedef {import("../types/server-runtime").MessageData} MessageData */
/** @typedef {import("../types/server-runtime").RateLimitState} RateLimitState */
/** @typedef {import("../types/server-runtime").SocketRequest} SocketRequest */
/** @typedef {import("../types/server-runtime").TurnstileAck} TurnstileAck */
/** @typedef {import("../types/server-runtime").ValidationStatus} ValidationStatus */

/** Map from name to *promises* of BoardData
  @type {{[boardName: string]: Promise<BoardData>}}
*/
const boards = {};
/** @type {Map<string, RateLimitState>} */
const destructiveRateLimits = new Map();
/** @type {Map<string, RateLimitState>} */
const constructiveRateLimits = new Map();
/** @type {Map<string, Map<string, BoardUser>>} */
const boardUsers = new Map();
/** @type {Map<string, AppSocket>} */
const activeSockets = new Map();
let connectedUsersTotal = 0;
/** @type {{
 *   board: string,
 *   reporter_socket: string,
 *   reported_socket: string,
 *   reporter_ip: string,
 *   reported_ip: string,
 *   reporter_user_agent: string,
 *   reported_user_agent: string,
 *   reporter_language: string,
 *   reported_language: string,
 *   reporter_name: string,
 *   reported_name: string,
 * } | null} */
let lastUserReportLog = null;
let invalidIpSourceLogged = false;
let io;
const NAME_SYLLABLES = [
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
 * @param {string=} eventName
 * @returns {A}
 */
function noFail(fn, eventName) {
  return /** @type {A} */ (
    function noFailWrapped(...args) {
      const startedAt = eventName ? Date.now() : 0;
      /** @type {unknown} */
      let eventErrorType;
      /** @type {any} */
      let result;
      try {
        result = fn.apply(null, args);
        if (result && typeof result.catch === "function") {
          return result
            .catch(function logError(/** @type {unknown} */ err) {
              eventErrorType = err;
              logger.error("socket.event_failed", {
                "wbo.socket.event": eventName,
                error: err,
              });
            })
            .finally(function recordEventMetric() {
              if (eventName) {
                metrics.recordSocketEvent({
                  event: eventName,
                  durationMs: Date.now() - startedAt,
                  errorType: eventErrorType,
                });
              }
            });
        }
        return result;
      } catch (e) {
        eventErrorType = e;
        logger.error("socket.event_failed", {
          "wbo.socket.event": eventName,
          error: e,
        });
      } finally {
        if (eventName && !(result && typeof result.catch === "function")) {
          metrics.recordSocketEvent({
            event: eventName,
            durationMs: Date.now() - startedAt,
            errorType: eventErrorType,
          });
        }
      }
    }
  );
}

function updateLoadedBoardsGauge() {
  metrics.setLoadedBoards(Object.keys(boards).length);
}

function updateActiveSocketConnectionsGauge() {
  metrics.setActiveSocketConnections(activeSockets.size);
}

function updateConnectedUsersGauge() {
  metrics.setConnectedUsers(connectedUsersTotal);
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
      if (isRateLimitStateStale(state, periodMs, now)) {
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
 * @param {string} seed
 * @param {number} minParts
 * @param {number} maxParts
 * @returns {string}
 */
function buildPronounceableName(seed, minParts, maxParts) {
  const digest = crypto.createHash("sha256").update(seed).digest();
  let partCount = minParts;
  if (maxParts > minParts) {
    partCount += (digest[0] || 0) % (maxParts - minParts + 1);
  }
  let word = "";
  for (let index = 0; index < partCount; index++) {
    const offset = 1 + index * 2;
    const value = digest.readUInt16BE(offset);
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
  const query = socket.handshake?.query;
  if (!query) return "";
  const value = query[key];
  return typeof value === "string" ? value : "";
}

/**
 * @param {AppSocket} socket
 * @param {string} headerName
 * @returns {string}
 */
function getSocketHeaderValue(socket, headerName) {
  const headers = getSocketRequest(socket).headers || {};
  const value = headers[headerName];
  if (Array.isArray(value)) return value[0] || "";
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
  return `${buildIpWord(ip)} ${buildUserId(userSecret)}`;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {number} [now]
 * @returns {BoardUser}
 */
function buildBoardUserRecord(socket, boardName, now) {
  const userSecret = getSocketQueryValue(socket, "userSecret");
  const ip = resolveClientIp(socket, boardName);
  const size = WBOMessageCommon.clampSize(getSocketQueryValue(socket, "size"));
  const color = WBOMessageCommon.normalizeColor(
    getSocketQueryValue(socket, "color"),
  );
  return {
    socketId: socket.id,
    userId: buildUserId(userSecret),
    name: buildUserName(ip, userSecret),
    ip,
    userAgent: getSocketHeaderValue(socket, "user-agent"),
    language: getSocketHeaderValue(socket, "accept-language"),
    color: color || "#001f3f",
    size,
    lastTool: getSocketQueryValue(socket, "tool") || "Hand",
    lastSeen: now || Date.now(),
  };
}

/**
 * @param {string} boardName
 * @returns {Map<string, BoardUser>}
 */
function getBoardUserMap(boardName) {
  let users = boardUsers.get(boardName);
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
  const users = boardUsers.get(boardName);
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
  const users = getBoardUserMap(boardName);
  const existing = users.get(socket.id);
  if (existing) return existing;

  const user = buildBoardUserRecord(socket, boardName);
  users.set(socket.id, user);
  return user;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function emitBoardUsersToSocket(socket, boardName) {
  const users = getBoardUserMap(boardName);
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
    .emit(
      "user_joined",
      Object.assign({ board: boardName }, serializeBoardUser(user)),
    );
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function removeBoardUser(socket, boardName) {
  const users = getBoardUserMap(boardName);
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
  const user = getBoardUser(boardName, socket.id);
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
function attachLiveSocketId(data, user) {
  if (!user) return data;
  data.socket = user.socketId;
  return data;
}

/**
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {{[key: string]: any}} infos
 * @returns {void}
 */
function closeSocket(socket, eventName, infos) {
  void eventName;
  void infos;
  socket.disconnect(true);
}

/**
 * @param {string} socketId
 * @returns {AppSocket | undefined}
 */
function getActiveSocket(socketId) {
  return activeSockets.get(socketId);
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
    kind: infos.kind,
    limit: infos.limit,
    periodMs: infos.period_ms,
    retryAfterMs: infos.retry_after_ms,
  });
  closeSocket(socket, eventName, infos);
}

/**
 * @param {any} message
 * @returns {string}
 */
function getBoardName(message) {
  return message?.board || "anonymous";
}

/**
 * @param {any} message
 * @returns {MessageData | undefined}
 */
function getMessageData(message) {
  return message?.data;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {{[key: string]: any}} extras
 * @returns {{[key: string]: any}}
 */
function buildSocketLogInfo(socket, boardName, extras) {
  return Object.assign(
    {
      board: boardName,
      socket: socket.id,
    },
    extras,
  );
}

/**
 * @param {string} eventName
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function socketTraceAttributes(eventName, extras) {
  return Object.assign(
    {
      "wbo.socket.event": eventName,
    },
    extras,
  );
}

/**
 * @param {string} boardName
 * @param {string | undefined} userName
 * @param {{tool?: string, type?: string}=} message
 * @returns {{[key: string]: unknown}}
 */
function boardMutationTraceAttributes(boardName, userName, message) {
  return socketTraceAttributes("broadcast_write", {
    "wbo.board": boardName,
    "user.name": userName,
    "wbo.tool": message?.tool,
    "wbo.message.type": message?.type,
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
function boardMessageErrorType(value) {
  return value;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {string}
 */
function normalizedBoardName(socket, boardName) {
  void socket;
  return boardName || "anonymous";
}

/**
 * @param {MessageData | undefined} data
 * @returns {boolean}
 */
function shouldTraceBroadcast(data) {
  return !data || data.tool !== "Cursor";
}

/**
 * @param {"general" | "constructive" | "destructive"} kind
 * @param {string} boardName
 * @returns {{limit: number, periodMs: number}}
 */
function getEffectiveRateLimitConfig(kind, boardName) {
  switch (kind) {
    case "constructive":
      return getEffectiveRateLimitDefinition(
        config.CONSTRUCTIVE_ACTION_RATE_LIMITS,
        boardName,
      );
    case "destructive":
      return getEffectiveRateLimitDefinition(
        config.DESTRUCTIVE_ACTION_RATE_LIMITS,
        boardName,
      );
    default:
      return getEffectiveRateLimitDefinition(
        config.GENERAL_RATE_LIMITS,
        boardName,
      );
  }
}

/**
 * @param {AppSocket} socket
 * @param {string} clientIp
 * @returns {string}
 */
function getSocketUserName(socket, clientIp) {
  return buildUserName(clientIp, getSocketQueryValue(socket, "userSecret"));
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
    if (!invalidIpSourceLogged) {
      invalidIpSourceLogged = true;
      logger.warn(
        "socket.ip_resolve_failed",
        buildSocketLogInfo(socket, boardName, {
          error: err,
        }),
      );
    }
    // Fallback to remoteAddress
    const request = getSocketRequest(socket);
    if (request.socket?.remoteAddress) {
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
  const headers = getSocketRequest(socket).headers || {};
  let host = headers["x-forwarded-host"] || headers.host;
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

  const expectedHostname = getExpectedTurnstileHostname(socket);
  const actualHostname = normalizeTurnstileHostname(result.hostname);
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
  /** @type {{ [key: string]: unknown } | undefined} */ data,
  clientIp,
  rateLimitState,
  now,
) {
  const generalLimit = getEffectiveRateLimitConfig("general", boardName);
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    1,
    generalLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  if (rateLimitState.count <= generalLimit.limit) return true;
  const retryAfterMs = getRateLimitRemainingMs(
    rateLimitState,
    generalLimit.periodMs,
    now,
  );
  const userName = getSocketUserName(socket, clientIp);

  tracing.withDetachedSpan(
    "socket.rate_limited",
    {
      attributes: socketTraceAttributes("broadcast_write", {
        "wbo.board": boardName,
        "user.name": userName,
        "wbo.rate_limit.kind": "general",
        "wbo.rejection.reason": "rate_limit",
      }),
    },
    function logGeneralRateLimit() {
      logger.warn("socket.rate_limited", {
        kind: "general",
        socket: socket.id,
        board: boardName,
        "client.address": clientIp,
        count: rateLimitState.count,
        limit: generalLimit.limit,
        period_ms: generalLimit.periodMs,
        retry_after_ms: retryAfterMs,
        "user.name": userName,
      });
      metrics.recordBoardMessage(
        Object.assign({ board: boardName }, data || {}),
        boardMessageErrorType("rate_limit.general"),
      );
    },
  );
  closeRateLimitedSocket(
    socket,
    "GENERAL_RATE_LIMIT_EXCEEDED",
    buildSocketLogInfo(socket, boardName, {
      kind: "general",
      ip: clientIp,
      count: rateLimitState.count,
      limit: generalLimit.limit,
      period_ms: generalLimit.periodMs,
      retry_after_ms: retryAfterMs,
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
  const rateLimitState =
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
  const destructiveCost = countDestructiveActions(data);
  if (destructiveCost === 0) return true;

  const rateLimitState = getDestructiveRateLimitState(clientIp, now);
  const destructiveLimit = getEffectiveRateLimitConfig(
    "destructive",
    boardName,
  );
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    destructiveCost,
    destructiveLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  if (rateLimitState.count > destructiveLimit.limit) {
    const retryAfterMs = getRateLimitRemainingMs(
      rateLimitState,
      destructiveLimit.periodMs,
      now,
    );
    const userName = getSocketUserName(socket, clientIp);
    tracing.withDetachedSpan(
      "socket.rate_limited",
      {
        attributes: socketTraceAttributes("broadcast_write", {
          "wbo.board": boardName,
          "user.name": userName,
          "wbo.rate_limit.kind": "destructive",
          "wbo.rejection.reason": "rate_limit",
          "wbo.destructive_cost": destructiveCost,
        }),
      },
      function logDestructiveRateLimit() {
        logger.warn("socket.rate_limited", {
          kind: "destructive",
          socket: socket.id,
          board: boardName,
          "client.address": clientIp,
          "user.name": userName,
          count: rateLimitState.count,
          limit: destructiveLimit.limit,
          period_ms: destructiveLimit.periodMs,
          retry_after_ms: retryAfterMs,
          destructive_cost: destructiveCost,
        });
        metrics.recordBoardMessage(
          Object.assign({ board: boardName }, data),
          boardMessageErrorType("rate_limit.destructive"),
        );
      },
    );
    closeRateLimitedSocket(
      socket,
      "DESTRUCTIVE_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        kind: "destructive",
        ip: clientIp,
        count: rateLimitState.count,
        limit: destructiveLimit.limit,
        period_ms: destructiveLimit.periodMs,
        retry_after_ms: retryAfterMs,
        destructive_cost: destructiveCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(destructiveRateLimits, destructiveLimit.periodMs, now);
  return true;
}

/**
 * @param {string} clientIp
 * @param {number} now
 * @returns {RateLimitState}
 */
function getConstructiveRateLimitState(clientIp, now) {
  const rateLimitState =
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
  const constructiveCost = countConstructiveActions(data);
  if (constructiveCost === 0) return true;

  const rateLimitState = getConstructiveRateLimitState(clientIp, now);
  const constructiveLimit = getEffectiveRateLimitConfig(
    "constructive",
    boardName,
  );
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    constructiveCost,
    constructiveLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  if (rateLimitState.count > constructiveLimit.limit) {
    const retryAfterMs = getRateLimitRemainingMs(
      rateLimitState,
      constructiveLimit.periodMs,
      now,
    );
    const userName = getSocketUserName(socket, clientIp);
    tracing.withDetachedSpan(
      "socket.rate_limited",
      {
        attributes: socketTraceAttributes("broadcast_write", {
          "wbo.board": boardName,
          "user.name": userName,
          "wbo.rate_limit.kind": "constructive",
          "wbo.rejection.reason": "rate_limit",
          "wbo.constructive_cost": constructiveCost,
        }),
      },
      function logConstructiveRateLimit() {
        logger.warn("socket.rate_limited", {
          kind: "constructive",
          socket: socket.id,
          board: boardName,
          "client.address": clientIp,
          "user.name": userName,
          count: rateLimitState.count,
          limit: constructiveLimit.limit,
          period_ms: constructiveLimit.periodMs,
          retry_after_ms: retryAfterMs,
          constructive_cost: constructiveCost,
        });
        metrics.recordBoardMessage(
          Object.assign({ board: boardName }, data),
          boardMessageErrorType("rate_limit.constructive"),
        );
      },
    );
    closeRateLimitedSocket(
      socket,
      "CONSTRUCTIVE_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        kind: "constructive",
        ip: clientIp,
        count: rateLimitState.count,
        limit: constructiveLimit.limit,
        period_ms: constructiveLimit.periodMs,
        retry_after_ms: retryAfterMs,
        constructive_cost: constructiveCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(constructiveRateLimits, constructiveLimit.periodMs, now);
  return true;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {string} clientIp
 * @returns {boolean}
 */
function ensureSocketCanAccessBoard(
  socket,
  boardName,
  /** @type {{ [key: string]: unknown } | undefined} */ data,
  clientIp,
) {
  if (canAccessBoard(boardName, socket)) return true;
  tracing.withDetachedSpan(
    "board.access_blocked",
    {
      attributes: socketTraceAttributes("broadcast_write", {
        "wbo.board": boardName,
        "user.name": clientIp ? getSocketUserName(socket, clientIp) : undefined,
        "wbo.rejection.reason": "access_blocked",
      }),
    },
    function logBlockedAccess() {
      logger.warn("board.access_blocked", {
        board: boardName,
        socket: socket.id,
        "client.address": clientIp,
        "user.name": clientIp ? getSocketUserName(socket, clientIp) : undefined,
      });
      metrics.recordBoardMessage(
        Object.assign({ board: boardName }, data || {}),
        boardMessageErrorType("access"),
      );
    },
  );
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
    io.use(
      (
        /** @type {AppSocket} */ socket,
        /** @type {(error?: Error) => void} */ next,
      ) => {
        if (socket.handshake.query?.token) {
          jsonwebtoken.verify(
            socket.handshake.query.token,
            config.AUTH_SECRET_KEY,
            (/** @type {unknown} */ err, /** @type {any} */ _decoded) => {
              if (err)
                return next(new Error("Authentication error: Invalid JWT"));
              next();
            },
          );
        } else {
          next(new Error("Authentication error: No jwt provided"));
        }
      },
    );
  }
  io.on("connection", noFail(handleSocketConnection, "connection"));
  return io;
}

/** Returns a promise to a BoardData with the given name
 * @param {string} name
 * @returns {Promise<BoardData>}
 */
function getBoard(name) {
  if (Object.hasOwn(boards, name)) {
    return /** @type {Promise<BoardData>} */ (boards[name]);
  } else {
    const board = BoardData.load(name);
    boards[name] = board;
    updateLoadedBoardsGauge();
    return board;
  }
}

/**
 * Executes on every new connection
 * @param {AppSocket} socket
 */
function handleSocketConnection(socket) {
  activeSockets.set(socket.id, socket);
  updateActiveSocketConnectionsGauge();
  metrics.recordSocketConnection("connected");

  /**
   * Function to call when an user joins a board
   * @param {string} name
   */
  async function joinBoard(/** @type {string} */ name) {
    // Default to the public board
    if (!name) name = "anonymous";
    tracing.setActiveSpanAttributes({ "wbo.board": name });
    if (!canAccessBoard(name, socket)) {
      tracing.setActiveSpanAttributes({
        "wbo.board.result": "rejected",
        "wbo.rejection.reason": "access_forbidden",
      });
      throw new Error("Access forbidden");
    }

    // Join the board
    socket.join(name);

    const board = await getBoard(name);
    const wasJoined = board.users.has(socket.id);
    board.users.add(socket.id);
    if (!wasJoined || !hasBoardUser(socket, name)) {
      const user = ensureBoardUser(socket, name);
      if (!wasJoined) {
        connectedUsersTotal += 1;
        updateConnectedUsersGauge();
      }
      emitBoardUsersToSocket(socket, name);
      emitUserJoinedToBoard(socket, name, user);
      tracing.setActiveSpanAttributes({
        "user.name": user.name,
        "wbo.board.users": board.users.size,
        "wbo.board.result": "success",
      });
      logger.info("board.joined", {
        board: name,
        socket: socket.id,
        "user.name": user.name,
        "client.address": user.ip,
        users: board.users.size,
      });
    }
    return board;
  }

  socket.on(
    "error",
    noFail(function onSocketError(error) {
      logger.error("socket.error", {
        socket: socket.id,
        error: error,
      });
    }, "error"),
  );

  socket.on(
    "getboard",
    noFail(async function onGetBoard(/** @type {string} */ name) {
      const boardName = normalizedBoardName(socket, name);
      return tracing.withActiveSpan(
        "socket.getboard",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: socketTraceAttributes("getboard", {
            "wbo.board": boardName,
          }),
        },
        async function traceGetBoard() {
          const board = await joinBoard(boardName);
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "success",
            "user.name": getBoardUser(boardName, socket.id)?.name || undefined,
          });
          socket.emit("boardstate", {
            readonly: board.isReadOnly(),
            canWrite: canWriteToBoard(board, socket),
          });
          //Send all the board's data as soon as it's loaded
          socket.emit("broadcast", {
            _children: board.getAll(),
            revision: board.getRevision(),
          });
        },
      );
    }, "getboard"),
  );

  socket.on(
    "joinboard",
    noFail(async function onJoinBoard(name) {
      const boardName = normalizedBoardName(socket, name);
      return tracing.withActiveSpan(
        "socket.joinboard",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: socketTraceAttributes("joinboard", {
            "wbo.board": boardName,
          }),
        },
        async function traceJoinBoard() {
          await joinBoard(boardName);
        },
      );
    }, "joinboard"),
  );

  socket.on(
    "turnstile_token",
    noFail(async function onTurnstileToken(token, ack) {
      return tracing.withActiveSpan(
        "socket.turnstile_token",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: socketTraceAttributes("turnstile_token"),
        },
        async function traceTurnstileToken() {
          if (!config.TURNSTILE_SECRET_KEY) {
            if (typeof ack === "function") ack(true);
            return;
          }
          try {
            const clientIp = resolveClientIp(socket, "anonymous");
            const userName = getSocketUserName(socket, clientIp);
            tracing.setActiveSpanAttributes({
              "user.name": userName,
              "client.address": clientIp,
            });
            const requestBody = new URLSearchParams({
              secret: config.TURNSTILE_SECRET_KEY,
              response: token,
            });
            requestBody.set("remoteip", clientIp);
            const verifyUrl = new URL(config.TURNSTILE_VERIFY_URL);
            const verification = await tracing.withActiveSpan(
              "turnstile.verify",
              {
                kind: tracing.SpanKind.CLIENT,
                attributes: {
                  "http.request.method": "POST",
                  "server.address": verifyUrl.hostname,
                  "server.port": verifyUrl.port
                    ? Number(verifyUrl.port)
                    : undefined,
                  "url.scheme": verifyUrl.protocol.replace(":", ""),
                },
              },
              async function verifyTurnstileToken() {
                const response = await fetch(config.TURNSTILE_VERIFY_URL, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: requestBody,
                });
                const result = await response.json();
                tracing.setActiveSpanAttributes({
                  "http.response.status_code": response.status,
                });
                return { response, result };
              },
            );
            const result = verification.result;
            const validation = validateTurnstileResult(socket, result);
            if (validation.ok === true) {
              socket.turnstileValidatedUntil =
                Date.now() + config.TURNSTILE_VALIDATION_WINDOW_MS;
              tracing.setActiveSpanAttributes({
                "wbo.turnstile.result": "success",
              });
              metrics.recordTurnstileVerification();
              if (typeof ack === "function") ack(buildTurnstileAck(socket));
            } else {
              tracing.setActiveSpanAttributes({
                "wbo.turnstile.result": "rejected",
                "wbo.turnstile.reason": validation.reason,
              });
              metrics.recordTurnstileVerification(validation.reason);
              logger.warn("turnstile.rejected", {
                socket: socket.id,
                "client.address": clientIp,
                "user.name": userName,
                error_codes: result["error-codes"],
                reason: validation.reason,
                hostname: result.hostname,
              });
              if (typeof ack === "function") ack({ success: false });
            }
          } catch (err) {
            tracing.recordActiveSpanError(err, {
              "wbo.turnstile.result": "error",
            });
            metrics.recordTurnstileVerification(err);
            logger.error("turnstile.error", {
              socket: socket.id,
              error: err,
            });
            if (typeof ack === "function") ack({ success: false });
          }
        },
      );
    }, "turnstile_token"),
  );

  const generalRateLimit = createRateLimitState(Date.now());
  socket.on(
    "broadcast",
    noFail(async function onBroadcast(message) {
      const now = Date.now();
      const boardName = getBoardName(message);
      const data = getMessageData(message);

      async function handleBroadcastWrite() {
        const clientIp = resolveClientIp(socket, boardName);
        const userName = getSocketUserName(socket, clientIp);
        tracing.setActiveSpanAttributes(
          boardMutationTraceAttributes(boardName, userName, data),
        );
        if (
          config.TURNSTILE_SECRET_KEY &&
          data &&
          WBOMessageCommon.requiresTurnstile(boardName, data.tool) &&
          !isTurnstileValidationActive(socket, now)
        ) {
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "rejected",
            "wbo.rejection.reason": "turnstile_validation_required",
          });
          metrics.recordBoardMessage(
            Object.assign({ board: boardName }, data),
            boardMessageErrorType("turnstile.validation_required"),
          );
          return;
        }
        if (
          !enforceGeneralRateLimit(
            socket,
            boardName,
            data,
            clientIp,
            generalRateLimit,
            now,
          )
        )
          return;
        if (!ensureSocketCanAccessBoard(socket, boardName, data, clientIp))
          return;

        const normalized = normalizeBroadcastData(message, data);
        if (normalized.ok === false) {
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "rejected",
            "wbo.rejection.reason": normalized.reason,
          });
          return;
        }
        const normalizedData = normalized.value;
        tracing.setActiveSpanAttributes(
          boardMutationTraceAttributes(boardName, userName, normalizedData),
        );
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

        const board = await getBoard(boardName);
        if (!canApplyBoardMessage(board, normalizedData, socket)) {
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "rejected",
            "wbo.rejection.reason": "write_blocked",
          });
          logger.warn("board.write_blocked", {
            socket: socket.id,
            board: board.name,
            "client.address": clientIp,
            "user.name": userName,
            tool: normalizedData.tool,
            type: normalizedData.type,
          });
          metrics.recordBoardMessage(
            Object.assign({ board: boardName }, normalizedData),
            boardMessageErrorType("write"),
          );
          return;
        }

        // Save the message in the board
        const handleResult = handleMessage(
          board,
          cloneMessageForPersistence(normalizedData),
          socket,
        );
        if (handleResult.ok === false) {
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "rejected",
            "wbo.rejection.reason": handleResult.reason,
          });
          logger.warn("board.message_rejected", {
            socket: socket.id,
            board: board.name,
            "client.address": clientIp,
            "user.name": userName,
            tool: normalizedData.tool,
            type: normalizedData.type,
            reason: handleResult.reason,
          });
          metrics.recordBoardMessage(
            Object.assign({ board: boardName }, normalizedData),
            boardMessageErrorType("board_message"),
          );
          return;
        }

        const user = updateBoardUserFromMessage(
          socket,
          boardName,
          normalizedData,
          now,
        );
        attachLiveSocketId(normalizedData, user);
        normalizedData.revision = handleResult.revision;
        tracing.setActiveSpanAttributes({
          "wbo.board.result": "success",
          "user.name": user ? user.name : userName,
        });
        metrics.recordBoardMessage(
          Object.assign({ board: boardName }, normalizedData),
        );

        //Send data to all other users connected on the same board
        socket.broadcast.to(boardName).emit("broadcast", normalizedData);
      }

      if (!shouldTraceBroadcast(data)) {
        return handleBroadcastWrite();
      }

      return tracing.withActiveSpan(
        "socket.broadcast_write",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: boardMutationTraceAttributes(boardName, undefined, data),
        },
        handleBroadcastWrite,
      );
    }, "broadcast"),
  );

  socket.on(
    "report_user",
    noFail(function onReportUser(message) {
      const boardName = getBoardName(message);
      return tracing.withActiveSpan(
        "socket.report_user",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: socketTraceAttributes("report_user", {
            "wbo.board": boardName,
          }),
        },
        function traceReportUser() {
          const targetSocketId =
            message && typeof message.socketId === "string"
              ? message.socketId
              : "";
          if (!targetSocketId || !socket.rooms.has(boardName)) {
            tracing.setActiveSpanAttributes({
              "wbo.board.result": "ignored",
            });
            return;
          }

          const reporter = getBoardUser(boardName, socket.id);
          const reported = getBoardUser(boardName, targetSocketId);
          if (!reporter || !reported) {
            tracing.setActiveSpanAttributes({
              "wbo.board.result": "ignored",
            });
            return;
          }

          lastUserReportLog = {
            board: boardName,
            reporter_socket: reporter.socketId,
            reported_socket: reported.socketId,
            reporter_ip: reporter.ip,
            reported_ip: reported.ip,
            reporter_user_agent: reporter.userAgent,
            reported_user_agent: reported.userAgent,
            reporter_language: reporter.language,
            reported_language: reported.language,
            reporter_name: reporter.name,
            reported_name: reported.name,
          };
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "reported",
            "user.name": reporter.name,
            "wbo.reported_user.name": reported.name,
          });
          logger.warn("user.reported", {
            board: lastUserReportLog.board,
            reporter_socket: lastUserReportLog.reporter_socket,
            reported_socket: lastUserReportLog.reported_socket,
            reporter_ip: lastUserReportLog.reporter_ip,
            reported_ip: lastUserReportLog.reported_ip,
            reporter_user_agent: lastUserReportLog.reporter_user_agent,
            reported_user_agent: lastUserReportLog.reported_user_agent,
            reporter_language: lastUserReportLog.reporter_language,
            reported_language: lastUserReportLog.reported_language,
            reporter_name: lastUserReportLog.reporter_name,
            reported_name: lastUserReportLog.reported_name,
          });

          const socketsToDisconnect = [socket];
          const reportedSocket = getActiveSocket(reported.socketId);
          if (reportedSocket && reportedSocket !== socket) {
            socketsToDisconnect.push(reportedSocket);
          }

          socketsToDisconnect.forEach(
            function disconnectReportedUser(
              /** @type {AppSocket} */ targetSocket,
            ) {
              closeSocket(targetSocket, "report_user", {
                board: boardName,
                socket: targetSocket.id,
              });
            },
          );
        },
      );
    }, "report_user"),
  );

  socket.on(
    "disconnecting",
    function onDisconnecting(/** @type {string} */ _reason) {
      activeSockets.delete(socket.id);
      updateActiveSocketConnectionsGauge();
      metrics.recordSocketConnection("disconnected");
      socket.rooms.forEach(
        async function disconnectFrom(/** @type {string} */ room) {
          if (Object.hasOwn(boards, room)) {
            const board = await /** @type {Promise<BoardData>} */ (
              boards[room]
            );
            const removed = board.users.delete(socket.id);
            removeBoardUser(socket, room);
            const userCount = board.users.size;
            if (removed) {
              connectedUsersTotal = Math.max(0, connectedUsersTotal - 1);
              updateConnectedUsersGauge();
            }
            if (userCount === 0) unloadBoard(room);
          }
        },
      );
    },
  );
}

/**
 * Unloads a board from memory.
 * @param {string} boardName
 **/
async function unloadBoard(boardName) {
  if (Object.hasOwn(boards, boardName)) {
    return tracing.withOptionalActiveSpan(
      "board.unload",
      {
        attributes: {
          "wbo.board": boardName,
          "wbo.board.operation": "unload",
        },
      },
      async function traceBoardUnload() {
        const startedAt = Date.now();
        const board = await /** @type {Promise<BoardData>} */ (
          boards[boardName]
        );
        try {
          await board.save();
          tracing.setActiveSpanAttributes({
            "wbo.board": boardName,
            "wbo.board.result": "success",
          });
          metrics.recordBoardOperationDuration(
            "unload",
            boardName,
            (Date.now() - startedAt) / 1000,
          );
          delete boards[boardName];
          updateLoadedBoardsGauge();
        } catch (error) {
          tracing.recordActiveSpanError(error, {
            "wbo.board": boardName,
            "wbo.board.result": "error",
          });
          metrics.recordBoardOperationDuration(
            "unload",
            boardName,
            (Date.now() - startedAt) / 1000,
            error,
          );
          throw error;
        }
      },
    );
  }
}

/**
 * @param {BoardData} board
 * @param {MessageData} message
 * @param {AppSocket} socket
 * @returns {{ok: true, revision?: number} | {ok: false, reason: string}}
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
 * @returns {{ok: true, revision?: number} | {ok: false, reason: string}}
 */
function saveHistory(board, message) {
  if (!(message.tool || message.type === "child") && !message._children) {
    logger.error("board.history_malformed", {
      board: board.name,
      message: message,
    });
  }
  return board.processMessage(/** @type {any} */ (message));
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
    getLastUserReportLog: function getLastUserReportLog() {
      return lastUserReportLog;
    },
    resetRateLimitMaps: function resetRateLimitMaps() {
      destructiveRateLimits.clear();
      constructiveRateLimits.clear();
      boardUsers.clear();
      activeSockets.clear();
      lastUserReportLog = null;
    },
  };
}
