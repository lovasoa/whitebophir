const { logger, metrics, tracing } = require("./observability.js");
const config = require("./configuration");
const RateLimitCommon = require("../client-data/js/rate_limit_common.js");
const normalizeIncomingMessage =
  require("./message_validation.js").normalizeIncomingMessage;
const roleInBoard = require("./jwtBoardnameAuth.js").roleInBoard;

/** @typedef {import("../types/server-runtime").AppSocket} AppSocket */
/** @typedef {import("../types/server-runtime").BoardLike} BoardLike */
/** @typedef {import("../types/server-runtime").BroadcastResult} BroadcastResult */
/** @typedef {import("../types/server-runtime").MessageData} MessageData */
/** @typedef {import("../types/server-runtime").RejectedBroadcast} RejectedBroadcast */
/** @typedef {import("../types/server-runtime").SocketRequest} SocketRequest */

/**
 * @param {AppSocket} socket
 * @returns {SocketRequest}
 */
function getSocketRequest(socket) {
  return socket.client.request;
}

/**
 * @param {AppSocket} socket
 * @returns {{[key: string]: string | string[] | undefined}}
 */
function getSocketHeaders(socket) {
  return getSocketRequest(socket).headers || {};
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function singleHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @param {string} headerName
 * @returns {string}
 */
function normalizeHeaderName(headerName) {
  return headerName.trim().toLowerCase();
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function parseForwardedChain(value) {
  return value
    .split(",")
    .map(function parseForwardedEntry(/** @type {string} */ proxyEntry) {
      var forwardedFor = proxyEntry
        .split(";")
        .map(function trimPart(/** @type {string} */ part) {
          return part.trim();
        })
        .find(function isForPart(/** @type {string} */ part) {
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
    })
    .filter(Boolean);
}

/**
 * @param {string} value
 * @returns {string}
 */
function parseForwardedHeader(value) {
  return parseForwardedChain(value)[0] || "";
}

/**
 * @param {string[]} chain
 * @returns {string}
 */
function selectTrustedClientIp(chain) {
  var trustedHops = Math.max(0, config.TRUST_PROXY_HOPS || 0);
  var selectedIndex = Math.min(trustedHops, chain.length - 1);
  return chain[selectedIndex] || "";
}

/**
 * @param {AppSocket} socket
 * @returns {string}
 */
function getClientIp(socket) {
  var request = getSocketRequest(socket);
  var headers = getSocketHeaders(socket);
  var directRemoteAddress =
    request.socket && request.socket.remoteAddress
      ? request.socket.remoteAddress
      : "";
  var ipSource = config.IP_SOURCE || "remoteAddress";
  var normalizedIpSource = normalizeHeaderName(ipSource);

  if (normalizedIpSource === "remoteaddress") {
    if (directRemoteAddress) return directRemoteAddress;
    throw new Error("Missing remoteAddress");
  }

  switch (normalizedIpSource) {
    case "x-forwarded-for":
      var forwardedForHeader = singleHeaderValue(headers["x-forwarded-for"]);
      if (forwardedForHeader) {
        var xForwardedFor = forwardedForHeader
          .split(",")
          .map(function trimHop(/** @type {string} */ hop) {
            return hop.trim();
          })
          .filter(Boolean);
        if (config.TRUST_PROXY_HOPS > 0 && directRemoteAddress) {
          xForwardedFor.reverse();
          xForwardedFor.unshift(directRemoteAddress);
          return selectTrustedClientIp(xForwardedFor);
        }
        return xForwardedFor[0] || "";
      }
      throw new Error(
        "Missing x-forwarded-for header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
      );

    case "forwarded":
      var forwardedHeader = singleHeaderValue(headers["forwarded"]);
      if (forwardedHeader) {
        var forwardedChain = parseForwardedChain(forwardedHeader);
        if (config.TRUST_PROXY_HOPS > 0 && directRemoteAddress) {
          forwardedChain.reverse();
          forwardedChain.unshift(directRemoteAddress);
          return selectTrustedClientIp(forwardedChain);
        }
        return forwardedChain[0] || "";
      }
      throw new Error(
        "Missing Forwarded header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
      );

    default:
      var customHeader = singleHeaderValue(headers[normalizedIpSource]);
      if (customHeader && customHeader.trim()) {
        return customHeader.trim();
      }
      throw new Error("Missing " + ipSource + " header");
  }
}

/**
 * @param {MessageData | null | undefined} data
 * @returns {number}
 */
var countDestructiveActions = RateLimitCommon.countDestructiveActions;
var countConstructiveActions = RateLimitCommon.countConstructiveActions;

/**
 * @param {MessageData | null | undefined} message
 * @returns {string}
 */
function getBoardName(message) {
  return (message && message.board) || "anonymous";
}

/**
 * @param {MessageData | null | undefined} message
 * @param {MessageData | null | undefined} data
 * @returns {BroadcastResult}
 */
function normalizeBroadcastData(message, data) {
  if (!data) {
    return rejectedBroadcast("missing data");
  }

  if (
    typeof data.tool === "string" &&
    config.BLOCKED_TOOLS.includes(data.tool)
  ) {
    return rejectedBroadcast("blocked tool");
  }

  const normalized = normalizeIncomingMessage(data);
  if (normalized.ok === false) {
    return rejectedBroadcast(normalized.reason);
  }

  if (config.BLOCKED_TOOLS.includes(normalized.value.tool)) {
    return rejectedBroadcast("blocked tool");
  }

  return normalized;

  /**
   * @param {string} reason
   * @returns {RejectedBroadcast}
   */
  function rejectedBroadcast(reason) {
    return tracing.withDetachedSpan(
      "socket.message_invalid",
      {
        attributes: {
          "wbo.socket.event": "broadcast_write",
          "wbo.board": getBoardName(message),
          "wbo.rejection.reason": reason,
          "wbo.tool": data && data.tool,
          "wbo.message.type": data && data.type,
        },
      },
      function recordRejectedBroadcast() {
        logger.warn("socket.message_invalid", {
          board: getBoardName(message),
          tool: data && data.tool,
          type: data && data.type,
          reason: reason,
        });
        metrics.recordRejection("invalid_message", reason);
        return { ok: false, reason: reason };
      },
    );
  }
}

/**
 * @param {AppSocket} socket
 * @returns {string | undefined}
 */
function getSocketToken(socket) {
  return socket.handshake.query && socket.handshake.query.token;
}

/**
 * @param {string} boardName
 * @param {AppSocket} socket
 * @returns {"editor" | "moderator" | "reader" | "forbidden"}
 */
function accessRole(boardName, socket) {
  if (!config.AUTH_SECRET_KEY) return "editor";
  const token = getSocketToken(socket);
  return /** @type {"editor" | "moderator" | "reader" | "forbidden"} */ (
    token ? roleInBoard(token, boardName) : "forbidden"
  );
}

/**
 * @param {string} boardName
 * @param {AppSocket} socket
 * @returns {boolean}
 */
function canAccessBoard(boardName, socket) {
  return accessRole(boardName, socket) !== "forbidden";
}

/**
 * @param {string} boardName
 * @param {AppSocket} socket
 * @returns {"editor" | "moderator" | "forbidden"}
 */
function writerRole(boardName, socket) {
  if (!config.AUTH_SECRET_KEY) return "forbidden";
  const role = accessRole(boardName, socket);
  return role === "editor" || role === "moderator" ? role : "forbidden";
}

/**
 * @param {BoardLike} board
 * @param {AppSocket} socket
 * @returns {boolean}
 */
function canWriteToBoard(board, socket) {
  if (!board.isReadOnly()) return true;
  return writerRole(board.name, socket) !== "forbidden";
}

/**
 * @param {BoardLike} board
 * @param {MessageData} data
 * @param {AppSocket} socket
 * @returns {boolean}
 */
function canApplyBoardMessage(board, data, socket) {
  if (data.tool === "Cursor") return true;
  if (!canWriteToBoard(board, socket)) return false;
  if (data.type === "clear" && writerRole(board.name, socket) !== "moderator") {
    return false;
  }
  return true;
}

module.exports = {
  canAccessBoard,
  canApplyBoardMessage,
  canWriteToBoard,
  countConstructiveActions,
  countDestructiveActions,
  getClientIp,
  normalizeBroadcastData,
  parseForwardedChain,
  parseForwardedHeader,
};
