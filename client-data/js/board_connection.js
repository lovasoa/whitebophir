(function (global) {
  "use strict";

  /** @typedef {{[name: string]: string}} SocketHeaders */
  /** @typedef {{path: string, reconnection: boolean, reconnectionDelay: number, timeout: number, extraHeaders?: SocketHeaders, query?: string}} SocketParams */

  /**
   * @param {unknown} value
   * @returns {SocketHeaders | null}
   */
  function normalizeSocketIOExtraHeaders(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    /** @type {SocketHeaders} */
    var headers = {};
    for (const [key, headerValue] of Object.entries(value)) {
      if (typeof headerValue === "string") {
        headers[key] = headerValue;
      }
    }

    return Object.keys(headers).length > 0 ? headers : null;
  }

  /**
   * @param {string} pathname
   * @param {SocketHeaders | null} extraHeaders
   * @param {string | null} token
   * @returns {SocketParams}
   */
  function buildSocketParams(pathname, extraHeaders, token) {
    /** @type {SocketParams} */
    var socketParams = {
      path: pathname.split("/boards/")[0] + "/socket.io",
      reconnection: true,
      reconnectionDelay: 100,
      timeout: 1000 * 60 * 20,
    };

    if (extraHeaders) {
      socketParams.extraHeaders = extraHeaders;
    }
    if (typeof token === "string" && token !== "") {
      socketParams.query = "token=" + encodeURIComponent(token);
    }

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

  var exports = {
    normalizeSocketIOExtraHeaders: normalizeSocketIOExtraHeaders,
    buildSocketParams: buildSocketParams,
    closeSocket: closeSocket,
  };
  var root = /** @type {typeof globalThis & {WBOBoardConnection?: typeof exports}} */ (global);
  root.WBOBoardConnection = exports;

  if ("object" === typeof module && module.exports) {
    module.exports = exports;
  }
})(typeof globalThis === "object" ? globalThis : window);
