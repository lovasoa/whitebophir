import { MutationType } from "./mutation_type.js";

/** @import { BoardMessage, PencilAppendMessage, PencilChildPoint, PencilReplayParent, PendingMessages, SocketHeaders, SocketParams } from "../../types/app-runtime" */
/** @typedef {{[name: string]: string}} SocketQueryParams */
const BATCH_SIZE = 1024;

/**
 * @param {unknown} value
 * @returns {SocketHeaders | null}
 */
function normalizeSocketIOExtraHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  /** @type {SocketHeaders} */
  const headers = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue === "string") headers[key] = headerValue;
  }
  return Object.keys(headers).length > 0 ? headers : null;
}

/**
 * @param {string} pathname
 * @param {SocketHeaders | null} extraHeaders
 * @param {string | null} token
 * @param {string} boardName
 * @param {SocketQueryParams | null} [extraQueryParams]
 * @returns {SocketParams}
 */
function buildSocketParams(
  pathname,
  extraHeaders,
  token,
  boardName,
  extraQueryParams,
) {
  /** @type {SocketParams} */
  const socketParams = {
    path: `${pathname.split("/boards/")[0]}/socket.io`,
    reconnection: false,
    reconnectionDelay: 100,
    autoConnect: false,
    timeout: 1000 * 60 * 20,
  };
  const query = new URLSearchParams();
  if (extraHeaders) socketParams.extraHeaders = extraHeaders;
  if (boardName !== "") query.set("board", boardName);
  if (token) query.set("token", token);
  if (extraQueryParams) {
    Object.entries(extraQueryParams).forEach(([key, value]) => {
      if (value !== "") query.set(key, value);
    });
  }
  const queryString = query.toString();
  if (queryString) socketParams.query = queryString;
  return socketParams;
}

/**
 * @param {unknown} socket
 * @returns {void}
 */
function closeSocket(socket) {
  if (!socket || typeof socket !== "object") return;
  if ("disconnect" in socket && typeof socket.disconnect === "function") {
    socket.disconnect();
    return;
  }
  if ("destroy" in socket && typeof socket.destroy === "function") {
    socket.destroy();
  }
}

/**
 * @returns {Promise<void>}
 */
function nextAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * @template T
 * @param {(value: T) => void | Promise<void>} fn
 * @param {T[]} args
 * @param {number} [index]
 * @returns {Promise<void>}
 */
async function batchCall(fn, args, index) {
  for (
    let offset = (index || 0) | 0;
    offset < args.length;
    offset += BATCH_SIZE
  ) {
    await Promise.all(args.slice(offset, offset + BATCH_SIZE).map(fn));
    if (offset + BATCH_SIZE < args.length) await nextAnimationFrame();
  }
}

/**
 * @param {PendingMessages} pendingMessages
 * @param {string} toolName
 * @param {BoardMessage} message
 * @returns {void}
 */
function queuePendingMessage(pendingMessages, toolName, message) {
  const toolMessages = pendingMessages[toolName];
  if (toolMessages) toolMessages.push(message);
  else pendingMessages[toolName] = [message];
}

/**
 * @param {PencilReplayParent} parent
 * @param {PencilChildPoint} child
 * @returns {PencilAppendMessage}
 */
function normalizeChildMessage(parent, child) {
  return {
    tool: parent.tool,
    type: MutationType.APPEND,
    parent: parent.id,
    x: child.x,
    y: child.y,
  };
}

export const connection = {
  normalizeSocketIOExtraHeaders: normalizeSocketIOExtraHeaders,
  buildSocketParams: buildSocketParams,
  closeSocket: closeSocket,
};

export const messages = {
  batchCall: batchCall,
  queuePendingMessage: queuePendingMessage,
  normalizeChildMessage: normalizeChildMessage,
};
