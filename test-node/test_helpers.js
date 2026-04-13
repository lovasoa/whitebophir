const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "server", "configuration.js");
const LOG_PATH = path.join(ROOT, "server", "log.js");
const SOCKETS_PATH = path.join(ROOT, "server", "sockets.js");
const SOCKET_POLICY_PATH = path.join(ROOT, "server", "socket_policy.js");
const BOARD_DATA_PATH = path.join(ROOT, "server", "boardData.js");
const MESSAGE_VALIDATION_PATH = path.join(
  ROOT,
  "server",
  "message_validation.js",
);
const MESSAGE_COMMON_PATH = path.join(
  ROOT,
  "client-data",
  "js",
  "message_common.js",
);
const JWT_BOARDNAME_AUTH_PATH = path.join(
  ROOT,
  "server",
  "jwtBoardnameAuth.js",
);

/** @typedef {{[key: string]: any}} Dict */
/** @typedef {{headers?: {[key: string]: string | string[] | undefined}, remoteAddress?: string, token?: string, query?: {[key: string]: string | undefined}, id?: string}} SocketOptions */
/** @typedef {{event: string, payload: any, room?: string}} EmittedEvent */
/** @typedef {{[event: string]: (...args: any[]) => any}} HandlerMap */
/** @typedef {{id: string, turnstileValidatedUntil?: number, disconnected?: boolean, handshake: {query: {token?: string}}, rooms: Set<string>, client: {request: {headers: {[key: string]: string | string[] | undefined}, socket: {remoteAddress: string}}}, broadcast: {to: (room: string) => {emit: (event: string, payload: any) => void}}, disconnectCalls: boolean[], on: (event: string, handler: (...args: any[]) => any) => void, join: (room: string) => void, emit: (event: string, payload: any) => void, disconnect: (close: boolean) => void}} TestSocket */
/** @typedef {{socket: TestSocket, handlers: HandlerMap, emitted: EmittedEvent[], broadcasted: EmittedEvent[]}} CreatedSocket */

const DEFAULT_CLEARED_MODULES = [
  CONFIG_PATH,
  LOG_PATH,
  SOCKETS_PATH,
  SOCKET_POLICY_PATH,
  BOARD_DATA_PATH,
  MESSAGE_VALIDATION_PATH,
  MESSAGE_COMMON_PATH,
  JWT_BOARDNAME_AUTH_PATH,
];

/**
 * @param {string} modulePath
 * @returns {void}
 */
function clearModuleCache(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

/**
 * @param {Dict} overrides
 * @param {() => any | Promise<any>} fn
 * @param {string[]} [extraModules]
 * @returns {Promise<any>}
 */
async function withEnv(overrides, fn, extraModules) {
  /** @type {Dict} */
  const previous = {};
  const modulesToClear = DEFAULT_CLEARED_MODULES.concat(extraModules || []);

  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  for (const modulePath of modulesToClear) {
    clearModuleCache(modulePath);
  }

  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    for (const modulePath of modulesToClear) {
      clearModuleCache(modulePath);
    }
  }
}

/**
 * @param {SocketOptions} [options]
 * @returns {CreatedSocket}
 */
function createSocket(options) {
  /** @type {SocketOptions} */
  const settings = options || {};
  /** @type {HandlerMap} */
  const handlers = {};
  /** @type {EmittedEvent[]} */
  const emitted = [];
  /** @type {EmittedEvent[]} */
  const broadcasted = [];
  /** @type {TestSocket} */
  const socket = {
    id: settings.id || "socket-1",
    turnstileValidatedUntil: undefined,
    handshake: {
      query: Object.assign({}, settings.query || {}, settings.token ? { token: settings.token } : {}),
    },
    rooms: new Set(),
    client: {
      request: {
        headers: settings.headers || {},
        socket: { remoteAddress: settings.remoteAddress || "127.0.0.1" },
      },
    },
    broadcast: {
      to: function (room) {
        return {
          emit: function (event, payload) {
            broadcasted.push({ event, payload, room });
          },
        };
      },
    },
    disconnectCalls: [],
    on: function (event, handler) {
      handlers[event] = handler;
    },
    join: function (room) {
      this.rooms.add(room);
    },
    emit: function (event, payload) {
      emitted.push({ event, payload });
    },
    disconnect: function (close) {
      this.disconnectCalls.push(close);
      this.disconnected = true;
    },
  };
  /** @type {CreatedSocket} */
  return { socket, handlers, emitted, broadcasted };
}

/**
 * @param {string} historyDir
 * @param {string} name
 * @returns {string}
 */
function boardFile(historyDir, name) {
  return path.join(historyDir, "board-" + encodeURIComponent(name) + ".json");
}

/**
 * @param {string} historyDir
 * @param {string} name
 * @param {any} storedBoard
 * @returns {Promise<void>}
 */
async function writeBoard(historyDir, name, storedBoard) {
  await fs.writeFile(boardFile(historyDir, name), JSON.stringify(storedBoard));
}

module.exports = {
  BOARD_DATA_PATH,
  CONFIG_PATH,
  MESSAGE_VALIDATION_PATH,
  SOCKET_POLICY_PATH,
  SOCKETS_PATH,
  boardFile,
  createSocket,
  withEnv,
  writeBoard,
};
