const { log } = require("./log.js");
const config = require("./configuration");
const normalizeIncomingMessage =
  require("./message_validation.js").normalizeIncomingMessage;
const roleInBoard = require("./jwtBoardnameAuth.js").roleInBoard;

/** @typedef {{ok: false, reason: string}} RejectedBroadcast */

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

function isConstructiveAction(data) {
  if (!data || !data.id) return false;
  if (data.type === "delete" || data.type === "clear") return false;
  if (data.type === "update" || data.type === "child") return false;
  return true;
}

function countConstructiveActions(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data._children)) {
    return data._children.reduce(function countConstructs(total, child) {
      return total + (isConstructiveAction(child) ? 1 : 0);
    }, 0);
  }
  return isConstructiveAction(data) ? 1 : 0;
}

function getBoardName(message) {
  return (message && message.board) || "anonymous";
}

/**
 * @param {any} message
 * @param {any} data
 * @returns {{ok: true, value: any} | RejectedBroadcast}
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
