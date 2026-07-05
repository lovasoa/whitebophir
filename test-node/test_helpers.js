const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "server", "configuration.mjs");
const SOCKETS_PATH = path.join(ROOT, "server", "socket", "index.mjs");
const SOCKET_POLICY_PATH = path.join(ROOT, "server", "socket", "policy.mjs");
const BOARD_DATA_PATH = path.join(ROOT, "server", "board", "data.mjs");
const MESSAGE_VALIDATION_PATH = path.join(
  ROOT,
  "server",
  "socket",
  "message_validation.mjs",
);
const BOARD_CAPABILITIES_PATH = path.join(
  ROOT,
  "server",
  "auth",
  "board_capabilities.mjs",
);

/** @typedef {{[key: string]: any}} Dict */
/** @typedef {{headers?: {[key: string]: string | string[] | undefined}, remoteAddress?: string, token?: string, query?: {[key: string]: any}, id?: string}} SocketOptions */
/** @typedef {{event: string, payload: any, room?: string}} EmittedEvent */
/** @typedef {{[event: string]: (...args: any[]) => any}} HandlerMap */
/** @typedef {{id: string, boardName?: string, replayBootstrap?: unknown, turnstileValidatedUntil?: number, disconnected?: boolean, handshake: {query: {board?: string, token?: string, tool?: string, color?: string, size?: string, baselineSeq?: string}}, rooms: Set<string>, client: {request: {headers: {[key: string]: string | string[] | undefined}, socket: {remoteAddress: string}}, conn: {closeCalls: number[], close: () => void}}, broadcast: {to: (room: string) => {emit: (event: string, payload: any) => void}}, disconnectCalls: boolean[], on: (event: string, handler: (...args: any[]) => any) => void, join: (room: string) => void, emit: (event: string, payload: any, ack?: (...args: any[]) => void) => void, disconnect: (close: boolean) => void}} TestSocket */
/** @typedef {{socket: TestSocket, handlers: HandlerMap, emitted: EmittedEvent[], broadcasted: EmittedEvent[]}} CreatedSocket */

const DEFAULT_CLEARED_MODULES = [CONFIG_PATH];

/**
 * @param {string} modulePath
 * @returns {void}
 */
function clearModuleCache(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function createConfig(overrides = {}) {
  return { ...require(CONFIG_PATH), ...overrides };
}

async function loadSockets(config = require(CONFIG_PATH)) {
  const sockets = require(SOCKETS_PATH);
  sockets.__test.resetRateLimitMaps();
  return {
    ...sockets,
    __config: config,
  };
}

function loadBoardData() {
  return require(BOARD_DATA_PATH).BoardData;
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
 * @template T
 * @param {string} prefix
 * @param {(context: {historyDir: string}) => T | Promise<T>} fn
 * @param {Dict} [envOverrides]
 * @param {string[]} [extraModules]
 * @returns {Promise<T>}
 */
async function withBoardHistoryDir(prefix, fn, envOverrides, extraModules) {
  const historyDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return withEnv(
    {
      ...(envOverrides || {}),
      WBO_HISTORY_DIR: historyDir,
    },
    () => fn({ historyDir }),
    extraModules,
  );
}

/**
 * @template T
 * @param {string} prefix
 * @param {(context: {historyDir: string}) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTemporaryHistoryDir(prefix, fn) {
  const historyDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return fn({ historyDir });
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
      query: Object.assign(
        {},
        settings.query || {},
        settings.token ? { token: settings.token } : {},
      ),
    },
    rooms: new Set(),
    client: {
      request: {
        headers: settings.headers || {},
        socket: { remoteAddress: settings.remoteAddress || "127.0.0.1" },
      },
      conn: {
        closeCalls: [],
        close: function () {
          this.closeCalls.push(Date.now());
          socket.disconnected = true;
        },
      },
    },
    broadcast: {
      to: (room) => ({
        emit: (event, payload) => {
          broadcasted.push({ event, payload, room });
        },
      }),
    },
    disconnectCalls: [],
    on: (event, handler) => {
      handlers[event] = handler;
    },
    join: function (room) {
      this.rooms.add(room);
    },
    emit: (event, payload, ack) => {
      emitted.push({ event, payload });
      if (typeof ack === "function") ack();
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
 * @param {{[event: string]: ((...args: any[]) => any) | undefined}} handlers
 * @param {string} eventName
 * @returns {(...args: any[]) => any}
 */
function getRequiredHandler(handlers, eventName) {
  const handler = handlers[eventName];
  if (typeof handler !== "function") {
    throw new Error(`Missing required socket handler: ${eventName}`);
  }
  return /** @type {(...args: any[]) => any} */ (handler);
}

/**
 * @param {any} sockets
 * @returns {Promise<void>}
 */
async function resetSocketTestState(sockets) {
  const loadedBoards = /** @type {string[]} */ (
    sockets.__test.listLoadedBoards()
  );
  await Promise.allSettled(
    loadedBoards.map(async (boardName) => {
      const board = await sockets.__test.getLoadedBoard(boardName);
      board.dispose();
    }),
  );
  sockets.__test.resetRateLimitMaps();
}

/**
 * @template T
 * @param {{
 *   env?: Dict,
 *   config?: Dict,
 *   historyDirPrefix?: string | false,
 *   boardName?: string,
 *   resetRateLimitMaps?: boolean,
 * }} options
 * @param {(scenario: {
 *   historyDir?: string,
 *   sockets: any,
 *   test: any,
 *   connect: (socketOptions?: SocketOptions) => Promise<CreatedSocket>,
 *   handler: (created: CreatedSocket, eventName: string) => (...args: any[]) => any,
 *   invoke: (created: CreatedSocket, eventName: string, ...args: any[]) => Promise<any>,
 *   getLoadedBoard: (boardName: string) => Promise<any>,
 * }) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function createSocketScenario(options = {}, fn) {
  const settings = options;
  const env = settings.env || {};
  /**
   * @param {string | undefined} historyDir
   * @returns {Promise<T>}
   */
  const run = async (historyDir) => {
    const scenarioConfig =
      historyDir === undefined
        ? createConfig({
            IP_SOURCE: "remoteAddress",
            ...(settings.config || {}),
          })
        : createConfig({
            IP_SOURCE: "remoteAddress",
            ...(settings.config || {}),
            HISTORY_DIR: historyDir,
          });
    const sockets = await loadSockets(scenarioConfig);
    if (settings.resetRateLimitMaps !== false) {
      sockets.__test.resetRateLimitMaps();
    }

    try {
      return await fn({
        historyDir,
        sockets,
        test: sockets.__test,
        async connect(socketOptions) {
          /** @type {SocketOptions} */
          const resolvedOptions = socketOptions || {};
          const created = createSocket({
            ...resolvedOptions,
            query: {
              baselineSeq: "0",
              ...(settings.boardName ? { board: settings.boardName } : {}),
              ...(resolvedOptions.query || {}),
            },
          });
          await sockets.__test.handleSocketConnection(
            created.socket,
            sockets.__config,
          );
          return created;
        },
        handler(created, eventName) {
          return getRequiredHandler(created.handlers, eventName);
        },
        async invoke(created, eventName, ...args) {
          return getRequiredHandler(created.handlers, eventName)(...args);
        },
        getLoadedBoard(boardName) {
          return sockets.__test.getLoadedBoard(boardName);
        },
      });
    } finally {
      await resetSocketTestState(sockets);
    }
  };

  if (settings.historyDirPrefix === false) {
    return Object.keys(env).length > 0
      ? withEnv(env, () => run(undefined))
      : run(undefined);
  }

  const runWithHistoryDir = () =>
    withTemporaryHistoryDir(
      settings.historyDirPrefix || "wbo-socket-scenario-",
      ({ historyDir }) => run(historyDir),
    );
  return Object.keys(env).length > 0
    ? withEnv(env, runWithHistoryDir)
    : runWithHistoryDir();
}

/**
 * @param {string} historyDir
 * @param {string} name
 * @returns {string}
 */
function boardFile(historyDir, name) {
  return path.join(historyDir, `board-${name}.json`);
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

/**
 * @param {import("http").Server} server
 * @returns {Promise<void>}
 */
function waitForListening(server) {
  return new Promise((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
}

/**
 * @param {import("http").Server} server
 * @returns {Promise<void>}
 */
function closeServer(server) {
  const shutdown =
    /** @type {import("http").Server & {shutdown?: () => Promise<void>}} */ (
      server
    ).shutdown;
  if (typeof shutdown === "function") {
    return shutdown();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * @param {import("http").Server} server
 * @returns {import("node:net").AddressInfo}
 */
function getTcpAddress(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server is not listening on a TCP port");
  }
  return address;
}

/**
 * @param {import("http").IncomingMessage} response
 * @returns {Promise<{statusCode: number, headers: import("http").IncomingHttpHeaders, body: string}>}
 */
function collectIncomingMessage(response) {
  return new Promise((resolve, reject) => {
    /** @type {string[]} */
    const chunks = [];
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      chunks.push(chunk);
    });
    response.on("end", () => {
      resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: chunks.join(""),
      });
    });
    response.on("error", reject);
  });
}

/**
 * @param {import("http").Server} server
 * @returns {{finished: Promise<void>, cancel: () => void}}
 */
function nextServerResponseCompletion(server) {
  /** @type {() => void} */
  let cancel = () => {};
  const finished = new Promise((resolve) => {
    function complete() {
      cancel();
      resolve(undefined);
    }

    /**
     * @param {import("http").IncomingMessage} _request
     * @param {import("http").ServerResponse} response
     */
    function onRequest(_request, response) {
      cancel = () => {
        response.removeListener("finish", complete);
      };
      response.once("finish", complete);
    }

    cancel = () => {
      server.removeListener("request", onRequest);
    };
    server.once("request", onRequest);
  });
  return {
    finished,
    cancel() {
      cancel();
    },
  };
}

/**
 * @param {import("http").Server} server
 * @param {string} requestPath
 * @param {{[key: string]: string}=} headers
 * @returns {Promise<{statusCode: number, headers: import("http").IncomingHttpHeaders, body: string}>}
 */
function request(server, requestPath, headers) {
  const serverResponse = nextServerResponseCompletion(server);
  return new Promise((resolve, reject) => {
    const address = getTcpAddress(server);
    const req = http.get(
      {
        host: "127.0.0.1",
        port: address.port,
        path: requestPath,
        headers: headers,
      },
      (response) => {
        collectIncomingMessage(response).then(
          async (message) => {
            await serverResponse.finished;
            resolve(message);
          },
          (error) => {
            serverResponse.cancel();
            reject(error);
          },
        );
      },
    );
    req.on("error", (error) => {
      serverResponse.cancel();
      reject(error);
    });
  });
}

/**
 * @param {import("http").Server} server
 * @param {string} rawRequest
 * @returns {Promise<string>}
 */
function requestRaw(server, rawRequest) {
  return new Promise((resolve, reject) => {
    const address = getTcpAddress(server);
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: address.port,
    });
    /** @type {Buffer[]} */
    const chunks = [];

    socket.on("connect", () => {
      socket.write(rawRequest);
    });
    socket.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    socket.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    socket.on("error", reject);
  });
}

/**
 * @template T
 * @param {number} value
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withMockedNow(value, fn) {
  const originalNow = Date.now;
  Date.now = () => value;
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

module.exports = {
  BOARD_DATA_PATH,
  BOARD_CAPABILITIES_PATH,
  CONFIG_PATH,
  MESSAGE_VALIDATION_PATH,
  SOCKET_POLICY_PATH,
  SOCKETS_PATH,
  boardFile,
  closeServer,
  clearModuleCache,
  collectIncomingMessage,
  createConfig,
  createSocketScenario,
  createSocket,
  getRequiredHandler,
  getTcpAddress,
  loadBoardData,
  loadSockets,
  request,
  requestRaw,
  resetSocketTestState,
  waitForListening,
  withBoardHistoryDir,
  withTemporaryHistoryDir,
  withMockedNow,
  withEnv,
  writeBoard,
};
