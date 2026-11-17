import { isValidBoardName } from "../../client-data/js/board_name.js";
import {
  formatMessageTypeTag,
  getToolId,
} from "../../client-data/js/message_tool_metadata.js";
import { forBoard } from "../auth/board_capabilities.mjs";
import observability from "../observability/index.mjs";
import { getEditBanExpiresAt } from "./bans.mjs";
import { normalizeIncomingMessage } from "./message_validation.mjs";
import { hasOnlineModerator } from "./presence.mjs";
import { getSocketUserSecret } from "./request.mjs";
import { getTemporaryModeratorExpiresAt } from "./temporary_moderators.mjs";

const { logger, metrics, tracing } = observability;

/** @typedef {import("../../types/server-runtime.d.ts").AppSocket} AppSocket */
/** @typedef {import("../../types/server-runtime.d.ts").BroadcastResult} BroadcastResult */
/** @typedef {import("../../types/server-runtime.d.ts").MessageData} MessageData */
/** @typedef {import("../../types/server-runtime.d.ts").RejectedBroadcast} RejectedBroadcast */
/** @typedef {import("../../types/server-runtime.d.ts").SocketRequest} SocketRequest */
/** @typedef {import("../../types/app-runtime").BoardCapabilities} BoardCapabilities */
/**
 * @typedef {{
 *   AUTH_SECRET_KEY: string,
 *   BLOCKED_TOOLS: string[],
 *   IP_SOURCE: string,
 *   MAX_BOARD_SIZE: number,
 *   MAX_CHILDREN: number,
 *   TRUST_PROXY_HOPS: number,
 *   BOARD_MODERATORS?: Map<string, Set<string>>,
 *   MODERATOR_REQUIRED_BOARDS?: string[],
 * }} SocketPolicyConfig
 */
/** @typedef {ReturnType<typeof forBoard>} SocketBoardPermissions */

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
 * @param {SocketPolicyConfig} config
 * @param {SocketRequest | {headers?: {[key: string]: string | string[] | undefined}, socket?: {remoteAddress?: string | undefined} | undefined}} request
 * @returns {string}
 */
function getRequestClientIp(config, request) {
  const headers = request.headers || {};
  const directRemoteAddress = request.socket?.remoteAddress || "";
  const ipSource = config.IP_SOURCE || "remoteAddress";
  const normalizedIpSource = normalizeHeaderName(ipSource);
  const trustProxyHops = config.TRUST_PROXY_HOPS;

  if (normalizedIpSource === "remoteaddress") {
    if (directRemoteAddress) return directRemoteAddress;
    throw new Error("Missing remoteAddress");
  }

  const header = headers[normalizedIpSource];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const isForwarded = normalizedIpSource === "forwarded";
  if (!isForwarded && normalizedIpSource !== "x-forwarded-for") {
    if (headerValue?.trim()) return headerValue.trim();
    throw new Error(`Missing ${ipSource} header`);
  }
  if (!headerValue) {
    throw new Error(
      `Missing ${isForwarded ? "Forwarded" : "x-forwarded-for"} header. If you are not behind a proxy, set WBO_IP_SOURCE=remoteAddress.`,
    );
  }

  const chain = isForwarded
    ? parseForwardedChain(headerValue)
    : headerValue
        .split(",")
        .map((hop) => hop.trim())
        .filter(Boolean);
  if (trustProxyHops > 0 && directRemoteAddress) {
    chain.reverse();
    chain.unshift(directRemoteAddress);
    return chain[Math.min(trustProxyHops, chain.length - 1)] || "";
  }
  return chain[0] || "";
}

/**
 * Whether the deployment is configured behind a trusted proxy, and forwarded
 * host/proto/IP headers may therefore be honored. Mirrors the IP trust model:
 * any configured `IP_SOURCE` other than the default `remoteAddress` means the
 * operator put WBO behind a proxy whose forwarded headers are trusted, including
 * custom client-IP headers such as `CF-Connecting-IP`. Direct deployments
 * (`remoteAddress`, the default) must ignore those headers.
 *
 * @param {{IP_SOURCE?: string}} config
 * @returns {boolean}
 */
function trustsForwardedHeaders(config) {
  return (
    normalizeHeaderName(config.IP_SOURCE || "remoteAddress") !== "remoteaddress"
  );
}

/**
 * @param {SocketPolicyConfig} config
 * @param {AppSocket} socket
 * @returns {string}
 */
function getClientIp(config, socket) {
  return getRequestClientIp(config, socket.client.request);
}

/**
 * Last-resort client IP from a raw request when the configured source is missing.
 * Shared so sockets, HTTP renders, bans, and presence all key on one value.
 * @param {{socket?: {remoteAddress?: string}} | null | undefined} request
 * @returns {string}
 */
function requestClientIpFallback(request) {
  return request?.socket?.remoteAddress || "unknown";
}

/**
 * Resolve a request's client IP without throwing.
 * @param {SocketPolicyConfig} config
 * @param {SocketRequest | {headers?: {[key: string]: string | string[] | undefined}, socket?: {remoteAddress?: string | undefined} | undefined}} request
 * @returns {string}
 */
function resolveRequestClientIpSafe(config, request) {
  try {
    return getRequestClientIp(config, request);
  } catch {
    return requestClientIpFallback(request);
  }
}

/**
 * @param {AppSocket} socket
 * @returns {string}
 */
function clientIpFallback(socket) {
  return requestClientIpFallback(socket.client?.request);
}

/**
 * Resolve a socket's client IP without throwing.
 * @param {SocketPolicyConfig} config
 * @param {AppSocket} socket
 * @returns {string}
 */
function resolveClientIpSafe(config, socket) {
  return resolveRequestClientIpSafe(config, socket.client?.request);
}

/**
 * @param {SocketPolicyConfig} config
 * @param {string} boardName
 * @param {MessageData | null | undefined} data
 * @param {BoardCapabilities} [capabilities]
 * @returns {BroadcastResult}
 */
function normalizeBroadcastData(config, boardName, data, capabilities) {
  if (!data) {
    return rejectedBroadcast(boardName, "missing data");
  }

  const blockedTools = config.BLOCKED_TOOLS;
  const rawToolId = getToolId(data.tool);
  if (rawToolId && blockedTools.includes(rawToolId)) {
    return rejectedBroadcast(boardName, "blocked tool");
  }

  const normalized = normalizeIncomingMessage(config, data, capabilities);
  if (normalized.ok === false) {
    return rejectedBroadcast(boardName, normalized.reason);
  }

  const normalizedToolId = getToolId(normalized.value.tool);
  if (normalizedToolId && blockedTools.includes(normalizedToolId)) {
    return rejectedBroadcast(boardName, "blocked tool");
  }

  return normalized;

  /**
   * @param {string} rejectedBoardName
   * @param {string} reason
   * @returns {RejectedBroadcast}
   */
  function rejectedBroadcast(rejectedBoardName, reason) {
    tracing.annotateActiveSpan("socket.message_invalid", {
      "wbo.socket.event": "broadcast_write",
      "wbo.board": rejectedBoardName,
      "wbo.rejection.reason": reason,
      "wbo.tool": getToolId(data?.tool),
      "wbo.message.type": formatMessageTypeTag(data?.type),
    });
    logger.warn("socket.message_invalid", {
      board: rejectedBoardName,
      message: data,
      tool: getToolId(data?.tool),
      type: data?.type,
      reason,
    });
    metrics.recordBoardMessage(
      { board: rejectedBoardName, ...(data || {}) },
      "invalid_message",
    );
    return { ok: false, reason };
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
 * @param {SocketPolicyConfig} config
 * @param {string} boardName
 * @param {AppSocket} socket
 * @returns {SocketBoardPermissions}
 */
function boardPermissionsForSocket(config, boardName, socket) {
  const current = socket.boardPermissionContext;
  if (current?.boardName === boardName) return current.permissions;

  const userSecret = getSocketUserSecret(socket);
  const permissions = forBoard({
    config,
    boardName,
    userInfo: { token: getSocketToken(socket), userSecret },
    hasOnlineModerator: () => hasOnlineModerator(boardName),
    // Lazy + live: only resolved when a capability query depends on the ban
    // (so canOpen never needs the IP), and re-read on every query so a ban and
    // its expiry take effect without reconnecting. The expiry is also exposed
    // in board state as a one-shot client access refresh delay. Tolerant of a
    // missing IP source, keying on the same address presence records.
    getBanExpiresAt: () =>
      getEditBanExpiresAt(
        boardName,
        userSecret,
        resolveClientIpSafe(config, socket),
        Date.now(),
      ),
    getTemporaryModeratorExpiresAt: () =>
      getTemporaryModeratorExpiresAt(boardName, userSecret, Date.now()),
  });
  socket.boardPermissionContext = { boardName, permissions };
  return permissions;
}

export {
  boardPermissionsForSocket,
  clientIpFallback,
  resolveRequestClientIpSafe,
  getClientIp,
  getRequestClientIp,
  normalizeBoardName,
  normalizeBroadcastData,
  parseForwardedChain,
  trustsForwardedHeaders,
};
