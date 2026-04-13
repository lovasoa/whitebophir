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

function clearModuleCache(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function withEnv(overrides, fn, extraModules) {
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

function createSocket(options) {
  const settings = options || {};
  const handlers = {};
  const emitted = [];
  const socket = {
    id: "socket-1",
    turnstileValidatedUntil: undefined,
    handshake: {
      query: settings.token ? { token: settings.token } : {},
    },
    rooms: new Set(),
    client: {
      request: {
        headers: settings.headers || {},
        socket: { remoteAddress: settings.remoteAddress || "127.0.0.1" },
      },
    },
    broadcast: {
      to: function () {
        return {
          emit: function () {},
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
  return { socket, handlers, emitted };
}

function boardFile(historyDir, name) {
  return path.join(historyDir, "board-" + encodeURIComponent(name) + ".json");
}

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
