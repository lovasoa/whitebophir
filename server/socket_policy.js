const { log } = require("./log.js");
const config = require("./configuration");
const normalizeIncomingMessage =
  require("./message_validation.js").normalizeIncomingMessage;
const roleInBoard = require("./jwtBoardnameAuth.js").roleInBoard;

/** @typedef {{ok: false, reason: string}} RejectedBroadcast */
/** @typedef {{ok: true, value: any} | RejectedBroadcast} BroadcastResult */
/** @typedef {{[key: string]: any}} MessageData */
/** @typedef {{headers?: {[key: string]: string | string[] | undefined}, socket?: {remoteAddress?: string}}} SocketRequest */
/** @typedef {{client: {request: SocketRequest}, handshake: {query?: {token?: string}}}} SocketLike */
/** @typedef {{name: string, isReadOnly: () => boolean}} BoardLike */

/**
 * @param {SocketLike} socket
 * @returns {SocketRequest}
 */
function getSocketRequest(socket) {
  return socket.client.request;
}

/**
 * @param {SocketLike} socket
 * @returns {{[key: string]: string | string[] | undefined}}
 */
function getSocketHeaders(socket) {
  return getSocketRequest(socket).headers || {};
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @param {string} value
 * @returns {string}
 */
function parseForwardedHeader(value) {
  var firstProxy = value.split(",")[0];
  var forwardedFor = firstProxy
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
}

/**
 * @param {SocketLike} socket
 * @returns {string}
 */
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
      var forwardedForHeader = firstHeaderValue(headers["x-forwarded-for"]);
      if (forwardedForHeader) {
        var xForwardedFor = forwardedForHeader.split(",")[0].trim();
        if (xForwardedFor) return xForwardedFor;
      }
      throw new Error(
        "Missing x-forwarded-for header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
      );

    case "Forwarded":
      var forwardedHeader = firstHeaderValue(headers["forwarded"]);
      if (forwardedHeader) {
        return parseForwardedHeader(forwardedHeader);
      }
      throw new Error(
        "Missing Forwarded header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
      );
  }
}

/**
 * @param {MessageData | null | undefined} data
 * @returns {number}
 */
function countDestructiveActions(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data._children)) {
    return data._children.reduce(function countDeletes(
      /** @type {number} */ total,
      /** @type {MessageData | null | undefined} */ child,
    ) {
      return total + (child && child.type === "delete" ? 1 : 0);
    }, 0);
  }
  return data.type === "delete" || data.type === "clear" ? 1 : 0;
}

/**
 * @param {MessageData | null | undefined} data
 * @returns {boolean}
 */
function isConstructiveAction(data) {
  if (!data || !data.id) return false;
  if (data.type === "delete" || data.type === "clear") return false;
  if (data.type === "update" || data.type === "child") return false;
  return true;
}

/**
 * @param {MessageData | null | undefined} data
 * @returns {number}
 */
function countConstructiveActions(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data._children)) {
    return data._children.reduce(function countConstructs(
      /** @type {number} */ total,
      /** @type {MessageData | null | undefined} */ child,
    ) {
      return total + (isConstructiveAction(child) ? 1 : 0);
    }, 0);
  }
  return isConstructiveAction(data) ? 1 : 0;
}

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

  if (config.BLOCKED_TOOLS.includes(data.tool)) {
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
    log("INVALID MESSAGE", {
      board: getBoardName(message),
      tool: data && data.tool,
      type: data && data.type,
      reason: reason,
    });
    return { ok: false, reason: reason };
  }
}

/**
 * @param {SocketLike} socket
 * @returns {string | undefined}
 */
function getSocketToken(socket) {
  return socket.handshake.query && socket.handshake.query.token;
}

/**
 * @param {string} boardName
 * @param {SocketLike} socket
 * @returns {"editor" | "moderator" | "forbidden"}
 */
function accessRole(boardName, socket) {
  if (!config.AUTH_SECRET_KEY) return "editor";
  return roleInBoard(getSocketToken(socket), boardName);
}

/**
 * @param {string} boardName
 * @param {SocketLike} socket
 * @returns {boolean}
 */
function canAccessBoard(boardName, socket) {
  return accessRole(boardName, socket) !== "forbidden";
}

/**
 * @param {string} boardName
 * @param {SocketLike} socket
 * @returns {"editor" | "moderator" | "forbidden"}
 */
function writerRole(boardName, socket) {
  if (!config.AUTH_SECRET_KEY) return "forbidden";
  const role = accessRole(boardName, socket);
  return role === "editor" || role === "moderator" ? role : "forbidden";
}

/**
 * @param {BoardLike} board
 * @param {SocketLike} socket
 * @returns {boolean}
 */
function canWriteToBoard(board, socket) {
  if (!board.isReadOnly()) return true;
  return writerRole(board.name, socket) !== "forbidden";
}

/**
 * @param {BoardLike} board
 * @param {MessageData} data
 * @param {SocketLike} socket
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
  parseForwardedHeader,
};
