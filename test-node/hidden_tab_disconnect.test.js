const assert = require("node:assert/strict");
const test = require("node:test");
const { SocketEvents } = require("../client-data/js/socket_events.js");
const { createSocketScenario } = require("./test_helpers.js");

test("a board socket disconnects after 15 continuous minutes hidden", async (t) => {
  const boardName = "hidden-tab";
  await createSocketScenario(
    { boardName },
    async ({ connect, handler, invoke, getLoadedBoard }) => {
      const tab = await connect({ id: "hidden" });
      const peer = await connect({ id: "visible" });
      const board = await getLoadedBoard(boardName);
      assert.ok(board);
      const disconnecting = handler(tab, "disconnecting");
      const disconnect = tab.socket.disconnect.bind(tab.socket);
      let cleanup = Promise.resolve();
      t.mock.method(
        tab.socket,
        "disconnect",
        (/** @type {boolean} */ close) => {
          cleanup = disconnecting("server namespace disconnect");
          disconnect(close);
        },
      );

      t.mock.timers.enable({ apis: ["setTimeout"] });
      try {
        const minute = 60_000;
        await invoke(tab, SocketEvents.TAB_HIDDEN, true);
        t.mock.timers.tick(10 * minute);
        await invoke(tab, SocketEvents.TAB_HIDDEN, false);
        t.mock.timers.tick(15 * minute);
        assert.deepEqual(tab.socket.disconnectCalls, []);

        await invoke(tab, SocketEvents.TAB_HIDDEN, true);
        t.mock.timers.tick(15 * minute - 1);
        await invoke(tab, SocketEvents.TAB_HIDDEN, true);
        await invoke(tab, SocketEvents.TAB_HIDDEN, "false");
        assert.deepEqual(tab.socket.disconnectCalls, []);
        t.mock.timers.tick(1);
        await cleanup;
        assert.deepEqual(tab.socket.disconnectCalls, [true]);
        assert.deepEqual([...board.users], [peer.socket.id]);
        assert.ok(
          tab.broadcasted.some(
            ({ event, payload }) =>
              event === SocketEvents.USER_LEFT &&
              payload.socketId === tab.socket.id,
          ),
        );
      } finally {
        t.mock.timers.reset();
      }
    },
  );
});
