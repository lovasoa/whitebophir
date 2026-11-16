/** @import { SocketHeaders, SocketParams } from "../../types/app-runtime" */
/** @typedef {{[name: string]: string}} SocketQueryParams */

/**
 * @param {unknown} value
 * @returns {SocketHeaders | null}
 */
export function normalizeSocketIOExtraHeaders(value) {
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
export function buildSocketParams(
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
