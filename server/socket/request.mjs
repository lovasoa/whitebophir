import { getUserSecretFromCookieHeader } from "../auth/user_secret_cookie.mjs";

/** @import { AppSocket, SocketRequest } from "../../types/server-runtime.d.ts" */

/**
 * @param {AppSocket} socket
 * @returns {SocketRequest}
 */
function getSocketRequest(socket) {
  return /** @type {SocketRequest} */ (socket.client.request);
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
  if (typeof value === "number") return String(value);
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

export {
  getSocketHeaderValue,
  getSocketQueryValue,
  getSocketRequest,
  getSocketUserSecret,
};
