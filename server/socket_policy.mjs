import RateLimitCommon from "../client-data/js/rate_limit_common.js";
import { isValidBoardName } from "../client-data/js/board_name.js";
import { readConfiguration } from "./configuration.mjs";
import { roleInBoard } from "./jwtBoardnameAuth.mjs";
import { normalizeIncomingMessage } from "./message_validation.mjs";
import observability from "./observability.mjs";

const { logger, metrics, tracing } = observability;

/** @typedef {import("../types/server-runtime.d.ts").AppSocket} AppSocket */
/** @typedef {import("../types/server-runtime.d.ts").BoardLike} BoardLike */
/** @typedef {import("../types/server-runtime.d.ts").BroadcastResult} BroadcastResult */
/** @typedef {import("../types/server-runtime.d.ts").MessageData} MessageData */
/** @typedef {import("../types/server-runtime.d.ts").RejectedBroadcast} RejectedBroadcast */
/** @typedef {import("../types/server-runtime.d.ts").SocketRequest} SocketRequest */

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
 * @param {string} headerValue
 * @returns {string[]}
 */
function parseHeaderChain(headerValue) {
  return headerValue
    .split(",")
    .map(function trimHop(/** @type {string} */ hop) {
      return hop.trim();
    })
    .filter(Boolean);
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function parseForwardedChain(value) {
  return value
    .split(",")
    .map(function parseForwardedEntry(/** @type {string} */ proxyEntry) {
      const forwardedFor = proxyEntry
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

      let resolved = forwardedFor.replace(/^for=/i, "").trim();
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
  const { TRUST_PROXY_HOPS } = readConfiguration();
  const trustedHops = Math.max(0, TRUST_PROXY_HOPS || 0);
  const selectedIndex = Math.min(trustedHops, chain.length - 1);
  return chain[selectedIndex] || "";
}

/**
 * @param {string[]} chain
 * @param {string} directRemoteAddress
 * @returns {string}
 */
function resolveClientIpChain(chain, directRemoteAddress) {
  const { TRUST_PROXY_HOPS } = readConfiguration();
  if (TRUST_PROXY_HOPS > 0 && directRemoteAddress) {
    chain.reverse();
    chain.unshift(directRemoteAddress);
    return selectTrustedClientIp(chain);
  }
  return chain[0] || "";
}

/**
 * @param {string | undefined} directRemoteAddress
 * @returns {string}
 */
function resolveRemoteAddressClientIp(directRemoteAddress) {
  if (directRemoteAddress) return directRemoteAddress;
  throw new Error("Missing remoteAddress");
}

/**
 * @param {{[key: string]: string | string[] | undefined}} headers
 * @param {string} directRemoteAddress
 * @returns {string}
 */
function resolveForwardedForClientIp(headers, directRemoteAddress) {
  const forwardedForHeader = singleHeaderValue(headers["x-forwarded-for"]);
  if (!forwardedForHeader) {
    throw new Error(
      "Missing x-forwarded-for header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
    );
  }
  return resolveClientIpChain(
    parseHeaderChain(forwardedForHeader),
    directRemoteAddress,
  );
}

/**
 * @param {{[key: string]: string | string[] | undefined}} headers
 * @param {string} directRemoteAddress
 * @returns {string}
 */
function resolveForwardedHeaderClientIp(headers, directRemoteAddress) {
  const forwardedHeader = singleHeaderValue(headers.forwarded);
  if (!forwardedHeader) {
    throw new Error(
      "Missing Forwarded header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.",
    );
  }
  return resolveClientIpChain(
    parseForwardedChain(forwardedHeader),
    directRemoteAddress,
  );
}

/**
 * @param {{[key: string]: string | string[] | undefined}} headers
 * @param {string} normalizedIpSource
 * @param {string} ipSource
 * @returns {string}
 */
function resolveCustomHeaderClientIp(headers, normalizedIpSource, ipSource) {
  const customHeader = singleHeaderValue(headers[normalizedIpSource]);
  if (customHeader?.trim()) return customHeader.trim();
  throw new Error(`Missing ${ipSource} header`);
}

/**
 * @param {AppSocket} socket
 * @returns {string}
 */
function getClientIp(socket) {
  const { IP_SOURCE } = readConfiguration();
  const request = getSocketRequest(socket);
  const headers = getSocketHeaders(socket);
  const directRemoteAddress = request.socket?.remoteAddress
    ? request.socket.remoteAddress
    : "";
  const ipSource = IP_SOURCE || "remoteAddress";
  const normalizedIpSource = normalizeHeaderName(ipSource);

  switch (normalizedIpSource) {
    case "remoteaddress":
      return resolveRemoteAddressClientIp(directRemoteAddress);
    case "x-forwarded-for":
      return resolveForwardedForClientIp(headers, directRemoteAddress);
    case "forwarded":
      return resolveForwardedHeaderClientIp(headers, directRemoteAddress);
    default:
      return resolveCustomHeaderClientIp(headers, normalizedIpSource, ipSource);
  }
}

/**
 * @param {MessageData | null | undefined} data
 * @returns {number}
 */
const countDestructiveActions = RateLimitCommon.countDestructiveActions;
const countConstructiveActions = RateLimitCommon.countConstructiveActions;
const countTextCreationActions = RateLimitCommon.countTextCreationActions;

/**
 * @param {string} boardName
 * @param {MessageData | null | undefined} data
 * @returns {BroadcastResult}
 */
function normalizeBroadcastData(boardName, data) {
  if (!data) {
    return rejectedBroadcast(boardName, "missing data");
  }

  const { BLOCKED_TOOLS } = readConfiguration();
  if (typeof data.tool === "string" && BLOCKED_TOOLS.includes(data.tool)) {
    return rejectedBroadcast(boardName, "blocked tool");
  }

  const normalized = normalizeIncomingMessage(data);
  if (normalized.ok === false) {
    return rejectedBroadcast(boardName, normalized.reason);
  }

  if (BLOCKED_TOOLS.includes(normalized.value.tool)) {
    return rejectedBroadcast(boardName, "blocked tool");
  }

  return normalized;

  /**
   * @param {string} rejectedBoardName
   * @param {string} reason
   * @returns {RejectedBroadcast}
   */
  function rejectedBroadcast(rejectedBoardName, reason) {
    return tracing.withDetachedSpan(
      "socket.message_invalid",
      {
        attributes: {
          "wbo.socket.event": "broadcast_write",
          "wbo.board": rejectedBoardName,
          "wbo.rejection.reason": reason,
          "wbo.tool": data?.tool,
          "wbo.message.type": data?.type,
        },
      },
      function recordRejectedBroadcast() {
        logger.warn("socket.message_invalid", {
          board: rejectedBoardName,
          tool: data?.tool,
          type: data?.type,
          reason: reason,
        });
        metrics.recordBoardMessage(
          { board: rejectedBoardName, ...(data || {}) },
          "invalid_message",
        );
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
  const token = socket.handshake.query?.token;
  return typeof token === "string" ? token : undefined;
}

/**
 * @param {unknown} boardName
 * @returns {string | null}
 */
function normalizeBoardName(boardName) {
  if (boardName === undefined || boardName === null || boardName === "") {
    return "anonymous";
  }
  return isValidBoardName(boardName) ? boardName : null;
}

/**
 * @param {string} boardName
 * @param {AppSocket} socket
 * @returns {"editor" | "moderator" | "reader" | "forbidden"}
 */
function accessRole(boardName, socket) {
  const { AUTH_SECRET_KEY } = readConfiguration();
  if (!AUTH_SECRET_KEY) return "editor";
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
  const { AUTH_SECRET_KEY } = readConfiguration();
  if (!AUTH_SECRET_KEY) return "forbidden";
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

export {
  canAccessBoard,
  canApplyBoardMessage,
  canWriteToBoard,
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
  getClientIp,
  normalizeBoardName,
  normalizeBroadcastData,
  parseForwardedChain,
  parseForwardedHeader,
};
