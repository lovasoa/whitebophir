const test = require("node:test");
const assert = require("node:assert/strict");

const BoardConnection =
  require("../client-data/js/board_transport.js").connection;

test("normalizeSocketIOExtraHeaders keeps only string header values", function () {
  assert.deepEqual(
    BoardConnection.normalizeSocketIOExtraHeaders({
      authorization: "Bearer abc",
      "x-number": 42,
      "x-array": ["bad"],
    }),
    { authorization: "Bearer abc" },
  );
  assert.equal(BoardConnection.normalizeSocketIOExtraHeaders(["bad"]), null);
  assert.equal(BoardConnection.normalizeSocketIOExtraHeaders(null), null);
});

test("buildSocketParams keeps board prefixes and omits empty tokens", function () {
  assert.deepEqual(
    BoardConnection.buildSocketParams("/prefix/boards/demo", { test: "1" }, ""),
    {
      path: "/prefix/socket.io",
      reconnection: true,
      reconnectionDelay: 100,
      timeout: 1000 * 60 * 20,
      extraHeaders: { test: "1" },
    },
  );

  assert.deepEqual(
    BoardConnection.buildSocketParams("/boards/demo", null, "abc 123"),
    {
      path: "/socket.io",
      reconnection: true,
      reconnectionDelay: 100,
      timeout: 1000 * 60 * 20,
      query: "token=abc+123",
    },
  );

  assert.deepEqual(
    BoardConnection.buildSocketParams("/boards/demo", null, "abc 123", {
      userSecret: "secret",
      tool: "Hand",
      color: "#123456",
      size: "4",
    }),
    {
      path: "/socket.io",
      reconnection: true,
      reconnectionDelay: 100,
      timeout: 1000 * 60 * 20,
      query: "token=abc+123&userSecret=secret&tool=Hand&color=%23123456&size=4",
    },
  );
});

test("closeSocket prefers disconnect over destroy", function () {
  /** @type {string[]} */
  const calls = [];
  BoardConnection.closeSocket({
    disconnect: function () {
      calls.push("disconnect");
    },
    destroy: function () {
      calls.push("destroy");
    },
  });
  assert.deepEqual(calls, ["disconnect"]);
});
