const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SOCKETS_PATH, createSocket, withEnv } = require("./test_helpers.js");
const { withConsole } = require("./test_console.js");

/**
 * @param {{[event: string]: ((...args: any[]) => any) | undefined}} handlers
 * @param {string} eventName
 * @returns {(...args: any[]) => any}
 */
function getRequiredHandler(handlers, eventName) {
  var handler = handlers[eventName];
  assert.equal(typeof handler, "function");
  return /** @type {(...args: any[]) => any} */ (handler);
}

/**
 * @template T
 * @param {T | undefined} value
 * @returns {T}
 */
function getRequiredValue(value) {
  assert.notEqual(value, undefined);
  return /** @type {T} */ (value);
}

test("user id and visible name are deterministic from userSecret and ip", async function () {
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async function () {
    const sockets = require(SOCKETS_PATH);
    const { socket } = createSocket({
      remoteAddress: "203.0.113.40",
      query: {
        userSecret: "alpha-secret",
      },
    });

    const userId = sockets.__test.buildUserId("alpha-secret");
    const name = sockets.__test.buildUserName("203.0.113.40", "alpha-secret");
    const record = sockets.__test.buildBoardUserRecord(
      socket,
      "anonymous",
      123,
    );

    assert.equal(userId, sockets.__test.buildUserId("alpha-secret"));
    assert.match(userId, /^[a-z]+$/);
    assert.equal(
      name,
      sockets.__test.buildUserName("203.0.113.40", "alpha-secret"),
    );
    assert.equal(record.userId, userId);
    assert.equal(record.name, name);
    assert.equal(record.lastSeen, 123);
  });
});

test("board user record seeds tool color and size from socket query", async function () {
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async function () {
    const sockets = require(SOCKETS_PATH);
    const { socket } = createSocket({
      remoteAddress: "203.0.113.41",
      query: {
        userSecret: "beta-secret",
        tool: "Rectangle",
        color: "#123456",
        size: "12",
      },
    });

    const record = sockets.__test.buildBoardUserRecord(socket, "board-a", 456);
    assert.equal(record.socketId, "socket-1");
    assert.equal(record.ip, "203.0.113.41");
    assert.equal(record.lastTool, "Rectangle");
    assert.equal(record.color, "#123456");
    assert.equal(record.size, 12);
    assert.equal(record.lastSeen, 456);
  });
});

test("board user maps are created lazily and cleaned when emptied", async function () {
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async function () {
    const sockets = require(SOCKETS_PATH);
    sockets.__test.resetRateLimitMaps();

    const users = sockets.__test.getBoardUserMap("board-a");
    users.set("socket-1", {
      socketId: "socket-1",
      userId: "sample",
      name: "north sample",
      ip: "203.0.113.50",
      color: "#001f3f",
      size: 4,
      lastTool: "Hand",
      lastSeen: 1,
    });
    assert.equal(sockets.__test.getBoardUserMap("board-a").size, 1);

    users.delete("socket-1");
    sockets.__test.cleanupBoardUserMap("board-a");

    const freshUsers = sockets.__test.getBoardUserMap("board-a");
    assert.equal(freshUsers.size, 0);
    assert.notEqual(freshUsers, users);
  });
});

test("joining a board replays joined users to the socket and broadcasts newcomer joins", async function () {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-join-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async function () {
      const sockets = require(SOCKETS_PATH);
      sockets.__test.resetRateLimitMaps();

      const first = createSocket({
        id: "socket-1",
        remoteAddress: "203.0.113.60",
        query: {
          userSecret: "first-secret",
          tool: "Hand",
          color: "#111111",
          size: "6",
        },
      });
      sockets.__test.handleSocketConnection(first.socket);
      await getRequiredHandler(first.handlers, "getboard")("board-a");

      const firstJoined = first.emitted.filter(function (event) {
        return event.event === "user_joined";
      });
      assert.equal(firstJoined.length, 1);
      assert.equal(
        getRequiredValue(firstJoined[0]).payload.socketId,
        "socket-1",
      );

      const second = createSocket({
        id: "socket-2",
        remoteAddress: "203.0.113.61",
        query: {
          userSecret: "second-secret",
          tool: "Rectangle",
          color: "#222222",
          size: "8",
        },
      });
      sockets.__test.handleSocketConnection(second.socket);
      await getRequiredHandler(second.handlers, "getboard")("board-a");

      const secondJoined = second.emitted.filter(function (event) {
        return event.event === "user_joined";
      });
      assert.equal(secondJoined.length, 2);
      assert.deepEqual(
        secondJoined.map(function (event) {
          return event.payload.socketId;
        }),
        ["socket-1", "socket-2"],
      );
      assert.deepEqual(second.broadcasted[0], {
        event: "user_joined",
        payload: getRequiredValue(secondJoined[1]).payload,
        room: "board-a",
      });
    },
  );
});

test("disconnecting from a board broadcasts user_left and cleans the board user map", async function () {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-left-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async function () {
      const sockets = require(SOCKETS_PATH);
      sockets.__test.resetRateLimitMaps();

      const created = createSocket({
        id: "socket-9",
        remoteAddress: "203.0.113.69",
        query: {
          userSecret: "left-secret",
          tool: "Hand",
          color: "#999999",
          size: "5",
        },
      });
      sockets.__test.handleSocketConnection(created.socket);
      await getRequiredHandler(created.handlers, "getboard")("board-left");

      await getRequiredHandler(
        created.handlers,
        "disconnecting",
      )("transport close");

      assert.deepEqual(created.broadcasted[0], {
        event: "user_joined",
        payload: getRequiredValue(
          created.emitted.find(function (event) {
            return event.event === "user_joined";
          }),
        ).payload,
        room: "board-left",
      });
      assert.deepEqual(created.broadcasted[1], {
        event: "user_left",
        payload: {
          board: "board-left",
          socketId: "socket-9",
        },
        room: "board-left",
      });
      assert.equal(sockets.__test.getBoardUserMap("board-left").size, 0);
    },
  );
});

test("live broadcasts attach userId and keep the user's latest non-cursor state", async function () {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-live-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async function () {
      const sockets = require(SOCKETS_PATH);
      sockets.__test.resetRateLimitMaps();

      const created = createSocket({
        id: "socket-live",
        remoteAddress: "203.0.113.80",
        query: {
          userSecret: "live-secret",
          tool: "Hand",
          color: "#101010",
          size: "4",
        },
      });
      sockets.__test.handleSocketConnection(created.socket);
      await getRequiredHandler(created.handlers, "getboard")("board-live");

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
        board: "board-live",
        data: {
          tool: "Rectangle",
          type: "rect",
          id: "shape-1",
          color: "#123456",
          size: 9,
          x: 1,
          y: 2,
          x2: 11,
          y2: 22,
        },
      });

      const user = getRequiredValue(
        sockets.__test.getBoardUserMap("board-live").get("socket-live"),
      );
      assert.equal(
        user.userId,
        getRequiredValue(created.broadcasted[1]).payload.userId,
      );
      assert.equal(user.lastTool, "Rectangle");
      assert.equal(user.color, "#123456");
      assert.equal(user.size, 9);

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
        board: "board-live",
        data: {
          tool: "Cursor",
          type: "update",
          x: 9,
          y: 10,
          color: "#abcdef",
          size: 12,
        },
      });

      assert.equal(user.lastTool, "Rectangle");
      assert.equal(user.color, "#abcdef");
      assert.equal(user.size, 12);
      assert.equal(
        getRequiredValue(created.broadcasted[2]).payload.userId,
        user.userId,
      );
    },
  );
});

test("report_user logs reporter and reported user details for active board members", async function () {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-report-"),
  );
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_HISTORY_DIR: historyDir,
      WBO_SILENT: "false",
    },
    async function () {
      const sockets = require(SOCKETS_PATH);
      sockets.__test.resetRateLimitMaps();

      const reporter = createSocket({
        id: "socket-reporter",
        remoteAddress: "203.0.113.90",
        query: {
          userSecret: "reporter-secret",
          tool: "Hand",
          color: "#222222",
          size: "4",
        },
      });
      sockets.__test.handleSocketConnection(reporter.socket);
      await getRequiredHandler(reporter.handlers, "getboard")("board-report");

      const reported = createSocket({
        id: "socket-reported",
        remoteAddress: "203.0.113.91",
        query: {
          userSecret: "reported-secret",
          tool: "Ellipse",
          color: "#333333",
          size: "7",
        },
      });
      sockets.__test.handleSocketConnection(reported.socket);
      await getRequiredHandler(reported.handlers, "getboard")("board-report");

      /** @type {string[]} */
      const logged = [];
      withConsole(
        {
          log: function (message) {
            logged.push(String(message));
          },
        },
        function () {
          getRequiredHandler(
            reporter.handlers,
            "report_user",
          )({
            board: "board-report",
            socketId: "socket-reported",
          });
        },
      );

      assert.equal(logged.length, 1);
      assert.match(getRequiredValue(logged[0]), /USER_REPORTED/);
      assert.match(getRequiredValue(logged[0]), /203\.0\.113\.90/);
      assert.match(getRequiredValue(logged[0]), /203\.0\.113\.91/);
      assert.match(getRequiredValue(logged[0]), /socket-reporter/);
      assert.match(getRequiredValue(logged[0]), /socket-reported/);
    },
  );
});
