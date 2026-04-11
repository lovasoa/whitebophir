const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "server", "configuration.js");
const LOG_PATH = path.join(ROOT, "server", "log.js");
const SOCKET_POLICY_PATH = path.join(ROOT, "server", "socket_policy.js");
const BOARD_DATA_PATH = path.join(ROOT, "server", "boardData.js");
const MESSAGE_VALIDATION_PATH = path.join(
  ROOT,
  "server",
  "message_validation.js",
);
const MESSAGE_COMMON_PATH = path.join(ROOT, "client-data", "js", "message_common.js");
const JWT_BOARDNAME_AUTH_PATH = path.join(ROOT, "server", "jwtBoardnameAuth.js");

const MODULES_TO_CLEAR = [
  CONFIG_PATH,
  LOG_PATH,
  SOCKET_POLICY_PATH,
  BOARD_DATA_PATH,
  MESSAGE_VALIDATION_PATH,
  MESSAGE_COMMON_PATH,
  JWT_BOARDNAME_AUTH_PATH,
];

function clearModuleCache(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

async function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  MODULES_TO_CLEAR.forEach(clearModuleCache);

  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    MODULES_TO_CLEAR.forEach(clearModuleCache);
  }
}

function createSocket(headers, remoteAddress, token) {
  return {
    handshake: { query: token ? { token: token } : {} },
    client: {
      request: {
        headers: headers || {},
        socket: { remoteAddress: remoteAddress || "127.0.0.1" },
      },
    },
  };
}

function boardFile(historyDir, name) {
  return path.join(
    historyDir,
    "board-" + encodeURIComponent(name) + ".json",
  );
}

test("normalizeIncomingMessage canonicalizes pencil messages", function () {
  const { normalizeIncomingMessage } = require(MESSAGE_VALIDATION_PATH);
  const normalized = normalizeIncomingMessage({
    tool: "Pencil",
    type: "line",
    id: "l1",
    color: "#123456",
    size: 999,
    opacity: 5,
    ignored: true,
  });

  assert.deepEqual(normalized, {
    ok: true,
    value: {
      tool: "Pencil",
      type: "line",
      id: "l1",
      color: "#123456",
      size: 50,
    },
  });
});

test("normalizeBroadcastData rejects malformed hand batches", function () {
  const socketPolicy = require(SOCKET_POLICY_PATH);
  const normalized = socketPolicy.normalizeBroadcastData(
    { board: "anonymous" },
    {
      tool: "Hand",
      _children: [
        {
          type: "update",
          id: "shape-1",
          transform: { a: 1, b: 0, c: 0, d: 1, e: "oops", f: 0 },
        },
      ],
    },
  );

  assert.equal(normalized.ok, false);
  assert.match(normalized.reason, /transform/);
});

test("socket policy resolves Forwarded headers with fresh config", function () {
  return withEnv({ WBO_IP_SOURCE: "Forwarded" }, function () {
    const socketPolicy = require(SOCKET_POLICY_PATH);
    const socket = createSocket({
      forwarded: 'for="198.51.100.9";proto=https, for=203.0.113.7',
    });
    assert.equal(socketPolicy.getClientIp(socket), "198.51.100.9");
  });
});

test("BoardData.update only applies allowed fields", function () {
  const BoardData = require(BOARD_DATA_PATH).BoardData;
  const board = new BoardData("validation-board");

  board.set("r1", {
    tool: "Rectangle",
    type: "rect",
    id: "r1",
    color: "#112233",
    size: 4,
    x: 10,
    y: 10,
    x2: 20,
    y2: 20,
  });

  board.update("r1", {
    tool: "Hand",
    type: "update",
    id: "r1",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
    txt: "ignored",
    size: 999,
  });

  assert.deepEqual(board.get("r1"), {
    tool: "Rectangle",
    type: "rect",
    id: "r1",
    color: "#112233",
    size: 4,
    x: 10,
    y: 10,
    x2: 20,
    y2: 20,
    transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
    time: board.get("r1").time,
  });
});

test("BoardData.load normalizes stored items and drops invalid tools", async function () {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-message-validation-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async function () {
    const BoardData = require(BOARD_DATA_PATH).BoardData;
    await fs.writeFile(
      boardFile(historyDir, "normalized-load"),
      JSON.stringify({
        bad1: {
          tool: "Rectangle",
          type: "rect",
          id: "wrong-id",
          color: "#abcdef",
          size: 200,
          opacity: 3,
          x: -100,
          y: "20.333",
          x2: "70000",
          y2: 40,
          ignored: true,
        },
        bad2: {
          tool: "Unknown",
          id: "bad2",
        },
      }),
    );

    const board = await BoardData.load("normalized-load");

    assert.deepEqual(board.get("bad1"), {
      tool: "Rectangle",
      type: "rect",
      id: "bad1",
      color: "#abcdef",
      size: 50,
      x: 0,
      y: 20.3,
      x2: 65536,
      y2: 40,
    });
    assert.equal(board.get("bad2"), undefined);
  });
});
