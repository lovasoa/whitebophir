import { createRequire } from "node:module";
import path from "node:path";

import observability from "./observability.mjs";
import RateLimitCommon from "../client-data/js/rate_limit_common.js";
import { normalizeIncomingMessage } from "./message_validation.mjs";
import { roleInBoard } from "./jwtBoardnameAuth.mjs";

const { logger, metrics, tracing } = observability;
const require = createRequire(
  path.join(process.cwd(), "server", "socket_policy.mjs"),
);

function getConfig() {
  return require("./configuration.js");
}

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
  const trustedHops = Math.max(0, getConfig().TRUST_PROXY_HOPS || 0);
  const selectedIndex = Math.min(trustedHops, chain.length - 1);
  return chain[selectedIndex] || "";
}

/**
 * @param {AppSocket} socket
 * @returns {string}
 */
function getClientIp(socket) {
  const request = getSocketRequest(socket);
  const headers = getSocketHeaders(socket);
  const directRemoteAddress = request.socket?.remoteAddress
    ? request.socket.remoteAddress
    : "";
  const config = getConfig();
  const ipSource = config.IP_SOURCE || "remoteAddress";
  const normalizedIpSource = normalizeHeaderName(ipSource);

  if (normalizedIpSource === "remoteaddress") {
    if (directRemoteAddress) return directRemoteAddress;
    throw new Error("Missing remoteAddress");
  }

  switch (normalizedIpSource) {
    case "x-forwarded-for": {
      const forwardedForHeader = singleHeaderValue(headers["x-forwarded-for"]);
      if (forwardedForHeader) {
        const xForwardedFor = forwardedForHeader
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
    }

    case "forwarded": {
      const forwardedHeader = singleHeaderValue(headers.forwarded);
      if (forwardedHeader) {
        const forwardedChain = parseForwardedChain(forwardedHeader);
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
    }

    default: {
      const customHeader = singleHeaderValue(headers[normalizedIpSource]);
      if (customHeader?.trim()) {
        return customHeader.trim();
      }
      throw new Error(`Missing ${ipSource} header`);
    }
  }
}

/**
 * @param {MessageData | null | undefined} data
 * @returns {number}
 */
const countDestructiveActions = RateLimitCommon.countDestructiveActions;
const countConstructiveActions = RateLimitCommon.countConstructiveActions;

/**
 * @param {MessageData | null | undefined} message
 * @returns {string}
 */
function getBoardName(message) {
  return message?.board || "anonymous";
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
    getConfig().BLOCKED_TOOLS.includes(data.tool)
  ) {
    return rejectedBroadcast("blocked tool");
  }

  const normalized = normalizeIncomingMessage(data);
  if (normalized.ok === false) {
    return rejectedBroadcast(normalized.reason);
  }

  if (getConfig().BLOCKED_TOOLS.includes(normalized.value.tool)) {
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
          "wbo.tool": data?.tool,
          "wbo.message.type": data?.type,
        },
      },
      function recordRejectedBroadcast() {
        logger.warn("socket.message_invalid", {
          board: getBoardName(message),
          tool: data?.tool,
          type: data?.type,
          reason: reason,
        });
        metrics.recordBoardMessage(
          Object.assign({ board: getBoardName(message) }, data || {}),
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
  return socket.handshake.query?.token;
}

/**
 * @param {string} boardName
 * @param {AppSocket} socket
 * @returns {"editor" | "moderator" | "reader" | "forbidden"}
 */
function accessRole(boardName, socket) {
  if (!getConfig().AUTH_SECRET_KEY) return "editor";
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
  if (!getConfig().AUTH_SECRET_KEY) return "forbidden";
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
  getClientIp,
  normalizeBroadcastData,
  parseForwardedChain,
  parseForwardedHeader,
};
