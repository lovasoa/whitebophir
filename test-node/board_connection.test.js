const test = require("node:test");
const assert = require("node:assert/strict");

const BoardConnection =
  require("../client-data/js/board_transport.js").connection;

test("normalizeSocketIOExtraHeaders keeps only string header values", () => {
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

test("buildSocketParams keeps board prefixes and omits empty tokens", () => {
  assert.deepEqual(
    BoardConnection.buildSocketParams(
      "/prefix/boards/demo",
      { test: "1" },
      "",
      "demo",
    ),
    {
      path: "/prefix/socket.io",
      reconnection: true,
      reconnectionDelay: 100,
      autoConnect: false,
      timeout: 1000 * 60 * 20,
      extraHeaders: { test: "1" },
      query: "board=demo",
    },
  );

  assert.deepEqual(
    BoardConnection.buildSocketParams("/boards/demo", null, "abc 123", "demo"),
    {
      path: "/socket.io",
      reconnection: true,
      reconnectionDelay: 100,
      autoConnect: false,
      timeout: 1000 * 60 * 20,
      query: "board=demo&token=abc+123",
    },
  );

  assert.deepEqual(
    BoardConnection.buildSocketParams("/boards/demo", null, "abc 123", "demo", {
      userSecret: "secret",
      tool: "Hand",
      color: "#123456",
      size: "4",
    }),
    {
      path: "/socket.io",
      reconnection: true,
      reconnectionDelay: 100,
      autoConnect: false,
      timeout: 1000 * 60 * 20,
      query:
        "board=demo&token=abc+123&userSecret=secret&tool=Hand&color=%23123456&size=4",
    },
  );
});

test("closeSocket prefers disconnect over destroy", () => {
  /** @type {string[]} */
  const calls = [];
  BoardConnection.closeSocket({
    disconnect: () => {
      calls.push("disconnect");
    },
    destroy: () => {
      calls.push("destroy");
    },
  });
  assert.deepEqual(calls, ["disconnect"]);
});
