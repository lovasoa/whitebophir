import crypto from "node:crypto";
import * as socketIO from "socket.io";
import WBOMessageCommon from "../client-data/js/message_common.js";
import RateLimitCommon from "../client-data/js/rate_limit_common.js";
import { BoardData } from "./boardData.mjs";
import { readConfiguration } from "./configuration.mjs";
import observability from "./observability.mjs";
import {
  canAccessBoard,
  canApplyBoardMessage,
  canWriteToBoard,
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
  getClientIp,
  normalizeBoardName,
  normalizeBroadcastData,
  parseForwardedHeader,
} from "./socket_policy.mjs";
import { getUserSecretFromCookieHeader } from "./user_secret_cookie.mjs";

const createRateLimitState = RateLimitCommon.createRateLimitState;
const consumeFixedWindowRateLimit = RateLimitCommon.consumeFixedWindowRateLimit;
const getRateLimitRemainingMs = RateLimitCommon.getRateLimitRemainingMs;
const getEffectiveRateLimitDefinition =
  RateLimitCommon.getEffectiveRateLimitDefinition;
const isRateLimitStateStale = RateLimitCommon.isRateLimitStateStale;
const { Server } = socketIO;
const { logger, metrics, tracing } = observability;

function getConfig() {
  return readConfiguration();
}

/** @typedef {{board?: string, token?: string, tool?: string, color?: string, size?: string}} SocketQuery */
/** @typedef {{socketId: string, userId: string, name: string, ip: string, userAgent: string, language: string, color: string, size: number, lastTool: string, lastSeen: number}} BoardUser */
/** @typedef {import("../types/server-runtime.d.ts").AppSocket} AppSocket */
/** @typedef {import("../types/server-runtime.d.ts").MessageData} MessageData */
/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {import("../types/server-runtime.d.ts").RateLimitState} BaseRateLimitState */
/** @typedef {import("../types/server-runtime.d.ts").SocketRequest} SocketRequest */
/** @typedef {import("../types/server-runtime.d.ts").TurnstileAck} TurnstileAck */
/** @typedef {import("../types/server-runtime.d.ts").ValidationStatus} ValidationStatus */
/** @typedef {"general" | "constructive" | "destructive" | "text"} RateLimitKind */
/** @typedef {"disconnect" | "exceeded" | "expired" | "pruned"} RateLimitWindowOutcome */
/** @typedef {"ip" | "socket"} RateLimitScope */
/**
 * @typedef {BaseRateLimitState & {
 *   metricBoardAnonymous?: boolean,
 *   metricLimit?: number,
 *   metricPeriodMs?: number,
 *   metricRecordedWindowStart?: number,
 * }} RateLimitState
 */

/** Map from name to *promises* of BoardData
  @type {{[boardName: string]: Promise<BoardData>}}
*/
const boards = {};
/** @type {Map<string, RateLimitState>} */
const destructiveRateLimits = new Map();
/** @type {Map<string, RateLimitState>} */
const constructiveRateLimits = new Map();
/** @type {Map<string, RateLimitState>} */
const textRateLimits = new Map();
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
 * Wraps a socket event handler with standard error logging and metrics.
 * @template {any[]} Args
 * @param {(...args: Args) => unknown} fn
 * @param {string=} eventName
 * @returns {(...args: Args) => Promise<unknown | undefined>}
 */
function wrapSocketEventHandler(fn, eventName) {
  return async function wrappedSocketEventHandler(...args) {
    const startedAt = eventName ? Date.now() : 0;
    /** @type {unknown} */
    let eventErrorType;
    const recordEventMetric = () => {
      if (!eventName) return;
      metrics.recordSocketEvent({
        event: eventName,
        durationMs: Date.now() - startedAt,
        errorType: eventErrorType,
      });
    };
    /**
     * @param {unknown} error
     */
    const logError = (error) => {
      eventErrorType = error;
      logger.error("socket.event_failed", {
        "wbo.socket.event": eventName,
        error: error,
      });
    };
    try {
      return await fn(...args);
    } catch (error) {
      logError(error);
      return undefined;
    } finally {
      recordEventMetric();
    }
  };
}

/**
 * Registers a socket event handler with standard error logging and metrics.
 * @template {any[]} Args
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {(...args: Args) => unknown} handler
 * @returns {void}
 */
function onSocketEvent(socket, eventName, handler) {
  socket.on(eventName, wrapSocketEventHandler(handler, eventName));
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
 * @param {RateLimitKind} kind
 * @param {number} periodMs
 * @param {number} now
 * @returns {void}
 */
function pruneRateLimitMap(map, kind, periodMs, now) {
  map.forEach(
    function pruneEntry(
      /** @type {RateLimitState} */ state,
      /** @type {string} */ key,
    ) {
      if (isRateLimitStateStale(state, periodMs, now)) {
        recordCompletedRateLimitWindow(kind, state, "pruned");
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
 * @param {AppSocket} socket
 * @returns {string}
 */
function getSocketUserSecret(socket) {
  return getUserSecretFromCookieHeader(getSocketHeaderValue(socket, "cookie"));
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
  const userSecret = getSocketUserSecret(socket);
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
 * @returns {{socketId: string, userId: string, name: string, color: string, size: number, lastTool: string}}
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
    socket.emit("user_joined", serializeBoardUser(user));
  });
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {BoardUser} user
 * @returns {void}
 */
function emitUserJoinedToBoard(socket, boardName, user) {
  socket.broadcast.to(boardName).emit("user_joined", serializeBoardUser(user));
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
 * @param {NormalizedMessageData} data
 * @param {number} now
 * @returns {BoardUser | undefined}
 */
function updateBoardUserFromMessage(socket, boardName, data, now) {
  const user = getBoardUser(boardName, socket.id);
  if (!user) return undefined;

  user.lastSeen = now;
  if (data.color !== undefined) user.color = data.color;
  if (data.size !== undefined) user.size = Number(data.size) || user.size;
  if (data.tool !== "Cursor") {
    user.lastTool = data.tool;
  }
  return user;
}

/**
 * @param {NormalizedMessageData} data
 * @param {BoardUser | undefined} user
 * @returns {NormalizedMessageData}
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
  if (eventName === "report_user") {
    const closeConnection = socket.client?.conn?.close;
    if (typeof closeConnection === "function") {
      closeConnection.call(socket.client.conn);
      return;
    }
  }
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
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {{[key: string]: any}} extras
 * @returns {{[key: string]: any}}
 */
function buildSocketLogInfo(socket, boardName, extras) {
  return {
    board: boardName,
    socket: socket.id,
    ...extras,
  };
}

/**
 * @param {string} eventName
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function socketTraceAttributes(eventName, extras) {
  return {
    "wbo.socket.event": eventName,
    ...extras,
  };
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
 * @returns {{ok: true, boardName: string} | {ok: false, reason: string}}
 */
function bindSocketBoard(socket) {
  const rawBoardName =
    typeof socket.boardName === "string"
      ? socket.boardName
      : socket.handshake.query?.board;
  if (typeof rawBoardName !== "string" || rawBoardName === "") {
    return { ok: false, reason: "missing_board_name" };
  }

  const boardName = normalizeBoardName(rawBoardName);
  if (boardName === null) {
    return { ok: false, reason: "invalid_board_name" };
  }
  if (!canAccessBoard(boardName, socket)) {
    return { ok: false, reason: "access_forbidden" };
  }

  socket.boardName = boardName;
  return { ok: true, boardName };
}

/**
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {string} reason
 * @param {{[key: string]: unknown}=} extras
 * @returns {void}
 */
function rejectSocketRequest(socket, eventName, reason, extras) {
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "rejected",
    "wbo.rejection.reason": reason,
  });
  logger.warn("socket.request_rejected", {
    socket: socket.id,
    "wbo.socket.event": eventName,
    reason,
    ...(extras || {}),
  });
}

/**
 * @param {MessageData | undefined} data
 * @returns {boolean}
 */
function shouldTraceBroadcast(data) {
  return !data || data.tool !== "Cursor";
}

/**
 * @param {"general" | "constructive" | "destructive" | "text"} kind
 * @param {string} boardName
 * @returns {{limit: number, periodMs: number}}
 */
function getEffectiveRateLimitConfig(kind, boardName) {
  const config = getConfig();
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
    case "text":
      return getEffectiveRateLimitDefinition(
        config.TEXT_CREATION_RATE_LIMITS,
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
 * @param {RateLimitKind} kind
 * @returns {RateLimitScope}
 */
function getRateLimitScope(kind) {
  return kind === "general" ? "socket" : "ip";
}

/**
 * @param {RateLimitState} state
 * @param {string} boardName
 * @param {number} limit
 * @param {number} periodMs
 * @returns {void}
 */
function updateRateLimitStateMetricMetadata(state, boardName, limit, periodMs) {
  state.metricBoardAnonymous = boardName === "anonymous";
  state.metricLimit = limit;
  state.metricPeriodMs = periodMs;
}

/**
 * @param {RateLimitKind} kind
 * @param {RateLimitState} state
 * @param {RateLimitWindowOutcome} outcome
 * @returns {void}
 */
function recordCompletedRateLimitWindow(kind, state, outcome) {
  const limit = Number(state.metricLimit);
  const periodMs = Number(state.metricPeriodMs);
  const used = Number(state.count);
  const windowStart = Number(state.windowStart);
  if (!(limit > 0) || !(periodMs > 0) || !(used > 0)) return;
  if (!Number.isFinite(windowStart)) return;
  if (state.metricRecordedWindowStart === windowStart) return;
  metrics.recordRateLimitWindowUtilization({
    boardAnonymous: state.metricBoardAnonymous,
    kind: kind,
    limit: limit,
    outcome: outcome,
    periodMs: periodMs,
    scope: getRateLimitScope(kind),
    used: used,
  });
  state.metricRecordedWindowStart = windowStart;
}

/**
 * @param {RateLimitKind} kind
 * @param {RateLimitState} state
 * @param {number} now
 * @returns {void}
 */
function recordExpiredRateLimitWindowIfNeeded(kind, state, now) {
  const periodMs = Number(state.metricPeriodMs);
  if (!(periodMs > 0)) return;
  if (!(state.count > 0)) return;
  if (now - state.windowStart < periodMs) return;
  recordCompletedRateLimitWindow(kind, state, "expired");
}

/**
 * @param {AppSocket} socket
 * @param {string} clientIp
 * @returns {string}
 */
function getSocketUserName(socket, clientIp) {
  return buildUserName(clientIp, getSocketUserSecret(socket));
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
  const config = getConfig();
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
  recordExpiredRateLimitWindowIfNeeded("general", rateLimitState, now);
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
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    generalLimit.limit,
    generalLimit.periodMs,
  );
  if (rateLimitState.count <= generalLimit.limit) return true;
  recordCompletedRateLimitWindow("general", rateLimitState, "exceeded");
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
        { board: boardName, ...(data || {}) },
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
  recordExpiredRateLimitWindowIfNeeded("destructive", rateLimitState, now);
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
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    destructiveLimit.limit,
    destructiveLimit.periodMs,
  );
  if (rateLimitState.count > destructiveLimit.limit) {
    recordCompletedRateLimitWindow("destructive", rateLimitState, "exceeded");
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
          { board: boardName, ...data },
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

  pruneRateLimitMap(
    destructiveRateLimits,
    "destructive",
    destructiveLimit.periodMs,
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
  const rateLimitState =
    constructiveRateLimits.get(clientIp) || createRateLimitState(now);
  constructiveRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

/**
 * @param {string} clientIp
 * @param {number} now
 * @returns {RateLimitState}
 */
function getTextRateLimitState(clientIp, now) {
  const rateLimitState =
    textRateLimits.get(clientIp) || createRateLimitState(now);
  textRateLimits.set(clientIp, rateLimitState);
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
  recordExpiredRateLimitWindowIfNeeded("constructive", rateLimitState, now);
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
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    constructiveLimit.limit,
    constructiveLimit.periodMs,
  );
  if (rateLimitState.count > constructiveLimit.limit) {
    recordCompletedRateLimitWindow("constructive", rateLimitState, "exceeded");
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
          { board: boardName, ...data },
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

  pruneRateLimitMap(
    constructiveRateLimits,
    "constructive",
    constructiveLimit.periodMs,
    now,
  );
  return true;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData} data
 * @param {string} clientIp
 * @param {number} now
 * @returns {boolean}
 */
function enforceTextRateLimit(socket, boardName, data, clientIp, now) {
  const textCost = countTextCreationActions(data);
  if (textCost === 0) return true;

  const rateLimitState = getTextRateLimitState(clientIp, now);
  recordExpiredRateLimitWindowIfNeeded("text", rateLimitState, now);
  const textLimit = getEffectiveRateLimitConfig("text", boardName);
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    textCost,
    textLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    textLimit.limit,
    textLimit.periodMs,
  );
  if (rateLimitState.count > textLimit.limit) {
    recordCompletedRateLimitWindow("text", rateLimitState, "exceeded");
    const retryAfterMs = getRateLimitRemainingMs(
      rateLimitState,
      textLimit.periodMs,
      now,
    );
    const userName = getSocketUserName(socket, clientIp);
    tracing.withDetachedSpan(
      "socket.rate_limited",
      {
        attributes: socketTraceAttributes("broadcast_write", {
          "wbo.board": boardName,
          "user.name": userName,
          "wbo.rate_limit.kind": "text",
          "wbo.rejection.reason": "rate_limit",
          "wbo.text_cost": textCost,
        }),
      },
      function logTextRateLimit() {
        logger.warn("socket.rate_limited", {
          kind: "text",
          socket: socket.id,
          board: boardName,
          "client.address": clientIp,
          "user.name": userName,
          count: rateLimitState.count,
          limit: textLimit.limit,
          period_ms: textLimit.periodMs,
          retry_after_ms: retryAfterMs,
          text_cost: textCost,
        });
        metrics.recordBoardMessage(
          { board: boardName, ...data },
          boardMessageErrorType("rate_limit.text"),
        );
      },
    );
    closeRateLimitedSocket(
      socket,
      "TEXT_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        kind: "text",
        ip: clientIp,
        count: rateLimitState.count,
        limit: textLimit.limit,
        period_ms: textLimit.periodMs,
        retry_after_ms: retryAfterMs,
        text_cost: textCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(textRateLimits, "text", textLimit.periodMs, now);
  return true;
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
 * @returns {import("socket.io").Server}
 */
function startIO(app) {
  io = new Server(app);
  io.use(
    (
      /** @type {AppSocket} */ socket,
      /** @type {(error?: Error) => void} */ next,
    ) => {
      const bound = bindSocketBoard(socket);
      if (bound.ok === true) {
        next();
        return;
      }
      next(new Error(`Connection rejected: ${bound.reason}`));
    },
  );
  io.on(
    "connection",
    wrapSocketEventHandler(handleSocketConnection, "connection"),
  );
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
 * @param {string} boardName
 * @returns {Promise<void>}
 */
async function bootstrapSocketBoard(socket, boardName) {
  return tracing.withActiveSpan(
    "socket.connect_board",
    {
      kind: tracing.SpanKind.INTERNAL,
      attributes: socketTraceAttributes("connect_board", {
        "wbo.board": boardName,
      }),
    },
    async function traceConnectBoard() {
      ensureSocketJoinedBoard(socket, boardName);
      const board = await getBoard(boardName);
      const wasJoined = board.users.has(socket.id);
      board.users.add(socket.id);
      if (!wasJoined || !hasBoardUser(socket, boardName)) {
        const user = ensureBoardUser(socket, boardName);
        if (!wasJoined) {
          connectedUsersTotal += 1;
          updateConnectedUsersGauge();
        }
        emitBoardUsersToSocket(socket, boardName);
        emitUserJoinedToBoard(socket, boardName, user);
        tracing.setActiveSpanAttributes({
          "user.name": user.name,
          "wbo.board.users": board.users.size,
          "wbo.board.result": "success",
        });
        logger.info("board.joined", {
          board: boardName,
          socket: socket.id,
          "user.name": user.name,
          "client.address": user.ip,
          users: board.users.size,
        });
      }
      socket.emit("boardstate", {
        readonly: board.isReadOnly(),
        canWrite: canWriteToBoard(board, socket),
      });
      socket.emit("broadcast", {
        _children: board.getAll(),
        revision: board.getRevision(),
      });
    },
  );
}

/**
 * Executes on every new connection
 * @param {AppSocket} socket
 */
async function handleSocketConnection(socket) {
  const bound = bindSocketBoard(socket);
  if (bound.ok === false) {
    rejectSocketRequest(socket, "connection", bound.reason);
    closeSocket(socket, "connection", { reason: bound.reason });
    return;
  }
  const boardName = bound.boardName;
  activeSockets.set(socket.id, socket);
  updateActiveSocketConnectionsGauge();
  metrics.recordSocketConnection("connected");

  onSocketEvent(socket, "error", function onSocketError(error) {
    logger.error("socket.error", {
      socket: socket.id,
      error: error,
    });
  });

  onSocketEvent(
    socket,
    "turnstile_token",
    async function onTurnstileToken(token, ack) {
      return tracing.withActiveSpan(
        "socket.turnstile_token",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: socketTraceAttributes("turnstile_token"),
        },
        async function traceTurnstileToken() {
          const config = getConfig();
          if (!config.TURNSTILE_SECRET_KEY) {
            if (typeof ack === "function") ack(true);
            return;
          }
          try {
            const clientIp = resolveClientIp(socket, boardName);
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
    },
  );

  const generalRateLimit = createRateLimitState(Date.now());
  onSocketEvent(socket, "broadcast", async function onBroadcast(data) {
    const config = getConfig();
    const now = Date.now();
    const normalizedName = boardName;

    async function handleBroadcastWrite() {
      const clientIp = resolveClientIp(socket, normalizedName);
      const userName = getSocketUserName(socket, clientIp);
      tracing.setActiveSpanAttributes(
        boardMutationTraceAttributes(normalizedName, userName, data),
      );
      if (
        config.TURNSTILE_SECRET_KEY &&
        data &&
        WBOMessageCommon.requiresTurnstile(normalizedName, data.tool) &&
        !isTurnstileValidationActive(socket, now)
      ) {
        tracing.setActiveSpanAttributes({
          "wbo.board.result": "rejected",
          "wbo.rejection.reason": "turnstile_validation_required",
        });
        metrics.recordBoardMessage(
          { board: normalizedName, ...data },
          boardMessageErrorType("turnstile.validation_required"),
        );
        return;
      }
      if (
        !enforceGeneralRateLimit(
          socket,
          normalizedName,
          data,
          clientIp,
          generalRateLimit,
          now,
        )
      )
        return;

      const normalized = normalizeBroadcastData(normalizedName, data);
      if (normalized.ok === false) {
        tracing.setActiveSpanAttributes({
          "wbo.board.result": "rejected",
          "wbo.rejection.reason": normalized.reason,
        });
        return;
      }
      const normalizedData = normalized.value;
      tracing.setActiveSpanAttributes(
        boardMutationTraceAttributes(normalizedName, userName, normalizedData),
      );
      if (
        !enforceDestructiveRateLimit(
          socket,
          normalizedName,
          normalizedData,
          clientIp,
          now,
        )
      )
        return;
      if (
        !enforceConstructiveRateLimit(
          socket,
          normalizedName,
          normalizedData,
          clientIp,
          now,
        )
      )
        return;
      if (
        !enforceTextRateLimit(
          socket,
          normalizedName,
          normalizedData,
          clientIp,
          now,
        )
      )
        return;

      ensureSocketJoinedBoard(socket, normalizedName);

      const board = await getBoard(normalizedName);
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
          { board: normalizedName, ...normalizedData },
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
          { board: normalizedName, ...normalizedData },
          boardMessageErrorType("board_message"),
        );
        return;
      }

      const user = updateBoardUserFromMessage(
        socket,
        normalizedName,
        normalizedData,
        now,
      );
      attachLiveSocketId(normalizedData, user);
      normalizedData.revision = handleResult.revision;
      tracing.setActiveSpanAttributes({
        "wbo.board.result": "success",
        "user.name": user ? user.name : userName,
      });
      metrics.recordBoardMessage({
        board: normalizedName,
        ...normalizedData,
      });

      //Send data to all other users connected on the same board
      socket.broadcast.to(normalizedName).emit("broadcast", normalizedData);
    }

    if (!shouldTraceBroadcast(data)) {
      return handleBroadcastWrite();
    }

    return tracing.withActiveSpan(
      "socket.broadcast_write",
      {
        kind: tracing.SpanKind.INTERNAL,
        attributes: boardMutationTraceAttributes(
          normalizedName,
          undefined,
          data,
        ),
      },
      handleBroadcastWrite,
    );
  });

  onSocketEvent(socket, "report_user", function onReportUser(message) {
    const normalizedName = boardName;
    return tracing.withActiveSpan(
      "socket.report_user",
      {
        kind: tracing.SpanKind.INTERNAL,
        attributes: socketTraceAttributes("report_user", {
          "wbo.board": normalizedName,
        }),
      },
      function traceReportUser() {
        const targetSocketId =
          message && typeof message.socketId === "string"
            ? message.socketId
            : "";
        if (!targetSocketId || !socket.rooms.has(normalizedName)) {
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "ignored",
          });
          return;
        }

        const reporter = getBoardUser(normalizedName, socket.id);
        const reported = getBoardUser(normalizedName, targetSocketId);
        if (!reporter || !reported) {
          tracing.setActiveSpanAttributes({
            "wbo.board.result": "ignored",
          });
          return;
        }

        lastUserReportLog = {
          board: normalizedName,
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
              board: normalizedName,
              socket: targetSocket.id,
            });
          },
        );
      },
    );
  });

  socket.on(
    "disconnecting",
    function onDisconnecting(/** @type {string} */ _reason) {
      recordCompletedRateLimitWindow("general", generalRateLimit, "disconnect");
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

  await bootstrapSocketBoard(socket, boardName);
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

export const __test = {
  buildBoardUserRecord,
  buildIpWord,
  buildUserId,
  buildUserName,
  handleSocketConnection,
  consumeFixedWindowRateLimit,
  countDestructiveActions,
  countConstructiveActions,
  countTextCreationActions,
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
    textRateLimits.clear();
    boardUsers.clear();
    activeSockets.clear();
    lastUserReportLog = null;
  },
};

export { startIO as start };
