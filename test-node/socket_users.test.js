const test = require("node:test");
const assert = require("node:assert/strict");

const { SOCKETS_PATH, createSocket, withEnv } = require("./test_helpers.js");

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
    assert.equal(name, sockets.__test.buildUserName("203.0.113.40", "alpha-secret"));
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
