const assert = require("node:assert/strict");
const test = require("node:test");
const { createSocketScenario } = require("./test_helpers.js");
const { parseBoardNamesEnv } = require("../server/configuration/helpers.mjs");
const { MutationType } = require("../client-data/js/mutation_type.js");
const {
  Clear,
  Cursor,
  Hand,
  Rectangle,
  Text,
} = require("../client-data/tools/index.js");
const {
  getBoardUser,
  hasOnlineModerator,
} = require("../server/socket/presence.mjs");
const { banBoardUser } = require("../server/socket/bans.mjs");

const boardName = "moderated";
const secret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const config = {
  MODERATOR_REQUIRED_BOARDS: [boardName],
  BOARD_MODERATORS: new Map([[boardName, new Set([secret])]]),
};
const moderator = { headers: { cookie: `wbo-user-secret-v1=${secret}` } };

/** @param {{emitted: Array<{event: string, payload: any}>}} created */
function boardState(created) {
  return created.emitted
    .filter((event) => event.event === "boardstate")
    .slice(-1)[0]?.payload;
}

test("moderator-required boards are opt-in, canonicalized and validated at startup", () => {
  for (const value of [undefined, "", " , "]) {
    assert.deepEqual(
      parseBoardNamesEnv("WBO_MODERATOR_REQUIRED_BOARDS", {
        WBO_MODERATOR_REQUIRED_BOARDS: value,
      }),
      [],
    );
  }
  assert.deepEqual(
    parseBoardNamesEnv("BOARDS", { BOARDS: " Anonymous, team " }),
    ["anonymous", "team"],
  );
  assert.throws(
    () =>
      parseBoardNamesEnv("WBO_MODERATOR_REQUIRED_BOARDS", {
        WBO_MODERATOR_REQUIRED_BOARDS: "anonymous other",
      }),
    /Invalid WBO_MODERATOR_REQUIRED_BOARDS/,
  );
});

test("last moderator departure blocks persistent writes, not cursors or other boards", async () => {
  await createSocketScenario(
    { boardName, config },
    async ({ connect, invoke, getLoadedBoard }) => {
      const visitor = await connect({ id: "visitor" });
      const board = await getLoadedBoard(boardName);
      assert.equal(boardState(visitor).moderationUnavailable, true);
      assert.equal(boardState(visitor).readonly, true);
      const create = {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "r",
        color: "#112233",
        size: 10,
        x: 10,
        y: 10,
        x2: 30,
        y2: 30,
      };
      await invoke(visitor, "broadcast", create);
      assert.equal(board.getSeq(), 0);
      assert.equal(visitor.emitted.slice(-1)[0]?.event, "mutation_rejected");
      await invoke(visitor, "broadcast", {
        tool: Cursor.id,
        type: MutationType.UPDATE,
        x: 20,
        y: 20,
        color: "#112233",
        size: 20,
      });
      assert.equal(visitor.broadcasted.slice(-1)[0]?.event, "broadcast");
      assert.equal(board.getSeq(), 0);

      const first = await connect({ id: "mod-1", ...moderator });
      const second = await connect({ id: "mod-2", ...moderator });
      assert.equal(boardState(visitor).canEdit, true);
      assert.equal(boardState(first).canEdit, true);
      assert.equal(boardState(visitor).readonly, false);
      await invoke(visitor, "broadcast", create);
      assert.equal(board.getSeq(), 1);
      await invoke(first, "disconnecting", "transport close");
      assert.equal(boardState(visitor).canEdit, true);
      await invoke(second, "disconnecting", "transport close");
      assert.equal(hasOnlineModerator(boardName), false);
      assert.equal(boardState(visitor).canEdit, false);
      await invoke(visitor, "broadcast", {
        tool: Hand.id,
        _children: [{ type: MutationType.DELETE, id: "r" }],
      });
      assert.equal(board.getSeq(), 1);
      assert.ok(board.board.r);
      assert.equal(
        board.isReadOnly(),
        false,
        "the pause must not become stored board state",
      );

      const other = await connect({ id: "other", query: { board: "other" } });
      assert.equal(boardState(other).canEdit, true);
      assert.equal(boardState(other).moderationUnavailable, undefined);
      assert.equal(hasOnlineModerator("other"), false);
    },
  );
});

test("temporary moderation covers a board only until expiry, without another client request", async (t) => {
  await createSocketScenario(
    { boardName, config },
    async ({ connect, invoke, getLoadedBoard }) => {
      const permanent = await connect({ id: "permanent", ...moderator });
      const temporary = await connect({
        id: "temporary",
        headers: {
          cookie: "wbo-user-secret-v1=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      });
      const visitor = await connect({ id: "viewer" });
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
      await invoke(permanent, "set_temporary_moderator", {
        socketId: temporary.socket.id,
        durationMs: 900_000,
      });
      await invoke(permanent, "disconnecting", "transport close");
      assert.equal(boardState(visitor).canEdit, true);
      assert.equal(boardState(temporary).canBan, true);
      t.mock.timers.tick(900_000);
      assert.equal(hasOnlineModerator(boardName), false);
      assert.equal(boardState(visitor).canEdit, false);
      assert.equal(boardState(temporary).canBan, false);
      const board = await getLoadedBoard(boardName);
      await invoke(temporary, "broadcast", {
        tool: Clear.id,
        type: MutationType.CLEAR,
      });
      assert.equal(board.getSeq(), 0);
      t.mock.timers.reset();
    },
  );
});

test("revoking a temporary moderator updates coverage and all identity tabs", async () => {
  await createSocketScenario(
    { boardName, config },
    async ({ connect, invoke }) => {
      const permanent = await connect({ id: "permanent", ...moderator });
      const options = {
        headers: {
          cookie: "wbo-user-secret-v1=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      };
      const temporary = await connect({ id: "temporary", ...options });
      const tab = await connect({ id: "temporary-tab", ...options });
      await invoke(permanent, "set_temporary_moderator", {
        socketId: temporary.socket.id,
        durationMs: 900_000,
      });
      assert.equal(boardState(tab).canBan, true);
      await invoke(permanent, "set_temporary_moderator", {
        socketId: tab.socket.id,
        durationMs: 0,
      });
      assert.equal(boardState(temporary).canBan, false);
      assert.equal(boardState(tab).canBan, false);
      await invoke(permanent, "disconnecting", "transport close");
      assert.equal(boardState(temporary).canEdit, false);
      assert.equal(boardState(tab).canEdit, false);
    },
  );
});

test("accepted personal-info text auto-reports only to moderators, with a typing cooldown and no bans", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  await createSocketScenario(
    { boardName, config },
    async ({ connect, invoke, getLoadedBoard }) => {
      const mod = await connect({ id: "mod", ...moderator });
      const visitor = await connect({
        id: "writer",
        remoteAddress: "203.0.113.10",
      });
      const peer = await connect({ id: "peer", remoteAddress: "203.0.113.11" });
      const reports = () =>
        mod.emitted.filter((event) => event.event === "user_reported");
      const update = (/** @type {string} */ txt, id = "t") =>
        invoke(visitor, "broadcast", {
          tool: Text.id,
          type: MutationType.UPDATE,
          id,
          txt,
        });
      await update("alex@example.org", "missing");
      assert.equal(
        reports().length,
        0,
        "rejected writes must not create alerts",
      );
      await invoke(visitor, "broadcast", {
        tool: Text.id,
        type: MutationType.CREATE,
        id: "t",
        color: "#112233",
        size: 20,
        x: 100,
        y: 100,
      });
      await update("hello");
      assert.equal(reports().length, 0);
      await update("alex@example.org");
      assert.equal(reports().length, 1);
      assert.deepEqual(reports()[0]?.payload, {
        reporterName: "",
        reportedName: getBoardUser(boardName, visitor.socket.id)?.name,
        automatic: true,
      });
      await update("alex@example.org please send photos");
      assert.equal(
        reports().length,
        1,
        "live updates must not flood moderators",
      );
      now += 60_000;
      await update("скинь номер");
      assert.equal(reports().length, 2);
      assert.equal(
        peer.emitted.some((event) => event.event === "user_reported"),
        false,
      );
      assert.equal(
        visitor.emitted.some((event) => event.event === "user_reported"),
        false,
      );
      assert.equal(visitor.socket.disconnected, undefined);
      assert.equal(
        (await getLoadedBoard(boardName)).board.t.txt,
        "скинь номер",
      );
      banBoardUser(boardName, "", "203.0.113.10", now);
      now += 60_000;
      await update("other@example.org");
      assert.equal(reports().length, 2);
    },
  );
});

test("auto-reports work without the presence gate and missed notifications do not consume cooldown", async () => {
  await createSocketScenario(
    { boardName, config: { ...config, MODERATOR_REQUIRED_BOARDS: [] } },
    async ({ connect, invoke }) => {
      const visitor = await connect({ id: "writer" });
      await invoke(visitor, "broadcast", {
        tool: Text.id,
        type: MutationType.CREATE,
        id: "t",
        color: "#112233",
        size: 20,
        x: 100,
        y: 100,
      });
      await invoke(visitor, "broadcast", {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "t",
        txt: "alex@example.org",
      });
      const mod = await connect({ id: "mod", ...moderator });
      await invoke(visitor, "broadcast", {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "t",
        txt: "other@example.org",
      });
      assert.equal(
        mod.emitted.some((event) => event.event === "user_reported"),
        true,
      );
    },
  );
});
