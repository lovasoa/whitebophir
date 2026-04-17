/** @typedef {import("../../types/app-runtime").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime").PendingMessages} PendingMessages */
/** @typedef {{[name: string]: string}} SocketQueryParams */
/** @typedef {import("../../types/app-runtime").SocketHeaders} SocketHeaders */
/** @typedef {import("../../types/app-runtime").SocketParams} SocketParams */
/** @typedef {import("../../types/app-runtime").TurnstileAck} TurnstileAck */

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
    reconnection: true,
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
    const batch = args.slice(offset, offset + BATCH_SIZE);
    await Promise.all(batch.map(fn));
    if (offset + BATCH_SIZE < args.length) {
      await nextAnimationFrame();
    }
  }
}

/**
 * @param {PendingMessages} pendingMessages
 * @param {string} toolName
 * @param {BoardMessage} message
 * @returns {void}
 */
function queuePendingMessage(pendingMessages, toolName, message) {
  if (!pendingMessages[toolName]) pendingMessages[toolName] = [message];
  else pendingMessages[toolName].push(message);
}

/**
 * @param {BoardMessage} message
 * @returns {message is BoardMessage & {_children: BoardMessage[]}}
 */
function hasChildMessages(message) {
  return Array.isArray(message._children);
}

/**
 * @param {BoardMessage} parent
 * @param {BoardMessage} child
 * @returns {BoardMessage}
 */
function normalizeChildMessage(parent, child) {
  child.parent = parent.id;
  child.tool = parent.tool;
  child.type = "child";
  return child;
}

/**
 * @param {unknown} result
 * @param {number | undefined} defaultValidationWindowMs
 * @returns {TurnstileAck}
 */
function normalizeTurnstileAck(result, defaultValidationWindowMs) {
  if (result === true) {
    return {
      success: true,
      validationWindowMs: defaultValidationWindowMs,
      validatedUntil: Date.now() + Number(defaultValidationWindowMs || 0),
    };
  }
  if (result && typeof result === "object") {
    return /** @type {TurnstileAck} */ (result);
  }
  return { success: false };
}

/**
 * @param {unknown} result
 * @param {number | undefined} defaultValidationWindowMs
 * @returns {{validatedUntil: number, validationWindowMs: number}}
 */
function computeTurnstileValidation(result, defaultValidationWindowMs) {
  const ack = normalizeTurnstileAck(result, defaultValidationWindowMs);
  if (ack.success !== true) {
    return { validatedUntil: 0, validationWindowMs: 0 };
  }
  const validationWindowMs =
    Number(ack.validationWindowMs) || Number(defaultValidationWindowMs) || 0;
  const safeWindowMs = Math.max(0, validationWindowMs - 5000);
  return {
    validatedUntil: safeWindowMs > 0 ? Date.now() + safeWindowMs : 0,
    validationWindowMs: validationWindowMs,
  };
}

/**
 * @param {unknown} api
 * @param {unknown} widgetId
 * @returns {boolean}
 */
function resetTurnstileWidget(api, widgetId) {
  if (
    api &&
    typeof api === "object" &&
    "reset" in api &&
    typeof api.reset === "function" &&
    widgetId !== null &&
    widgetId !== undefined
  ) {
    api.reset(widgetId);
    return true;
  }
  return false;
}

export const connection = {
  normalizeSocketIOExtraHeaders: normalizeSocketIOExtraHeaders,
  buildSocketParams: buildSocketParams,
  closeSocket: closeSocket,
};

export const messages = {
  batchCall: batchCall,
  queuePendingMessage: queuePendingMessage,
  hasChildMessages: hasChildMessages,
  normalizeChildMessage: normalizeChildMessage,
};

export const turnstile = {
  normalizeTurnstileAck: normalizeTurnstileAck,
  computeTurnstileValidation: computeTurnstileValidation,
  resetTurnstileWidget: resetTurnstileWidget,
};

const boardTransport = {
  connection,
  messages,
  turnstile,
};
export default boardTransport;
