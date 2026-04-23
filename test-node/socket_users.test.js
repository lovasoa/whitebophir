const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  createConfig,
  createSocketScenario,
  createSocket,
} = require("./test_helpers.js");
const { MutationType } = require("../client-data/js/mutation_type.js");
const {
  Cursor,
  Eraser,
  Pencil,
  Rectangle,
} = require("../client-data/tools/index.js");
const USER_SECRET_COOKIE_NAME = "wbo-user-secret-v1";

/**
 * @template T
 * @param {T | undefined} value
 * @returns {T}
 */
function getRequiredValue(value) {
  assert.notEqual(value, undefined);
  return /** @type {T} */ (value);
}

/**
 * @param {string} userSecret
 * @param {{[key: string]: string}=} headers
 * @returns {{[key: string]: string}}
 */
function withUserSecretCookie(userSecret, headers) {
  return {
    ...(headers || {}),
    cookie: `${USER_SECRET_COOKIE_NAME}=${userSecret}`,
  };
}

/**
 * @param {{[key: string]: any}} fields
 * @returns {{[key: string]: any}}
 */
function rectangleCreate(fields) {
  const size =
    typeof fields.size === "number" ? Math.max(10, fields.size) : fields.size;
  return {
    tool: Rectangle.id,
    type: MutationType.CREATE,
    ...fields,
    ...(size === undefined ? {} : { size }),
  };
}

/**
 * @param {{[key: string]: any}} fields
 * @returns {{[key: string]: any}}
 */
function rectangleUpdate(fields) {
  return {
    tool: Rectangle.id,
    type: MutationType.UPDATE,
    ...fields,
  };
}

/**
 * @param {{[key: string]: any}} fields
 * @returns {{[key: string]: any}}
 */
function cursorUpdate(fields) {
  const size =
    typeof fields.size === "number" ? Math.max(10, fields.size) : fields.size;
  return {
    tool: Cursor.id,
    type: MutationType.UPDATE,
    ...fields,
    ...(size === undefined ? {} : { size }),
  };
}

/**
 * @param {{[key: string]: any}} fields
 * @returns {{[key: string]: any}}
 */
function pencilAppend(fields) {
  return {
    tool: Pencil.id,
    type: MutationType.APPEND,
    ...fields,
  };
}

test("user id and visible name are deterministic from the cookie-backed user secret and ip", async () => {
  await createSocketScenario(
    { historyDirPrefix: false },
    async ({ sockets }) => {
      const userSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const { socket } = createSocket({
        remoteAddress: "203.0.113.40",
        headers: withUserSecretCookie(userSecret),
      });

      const userId = sockets.__test.buildUserId(userSecret);
      const name = sockets.__test.buildUserName("203.0.113.40", userSecret);
      const record = sockets.__test.buildBoardUserRecord(
        socket,
        "anonymous",
        createConfig(),
        123,
      );

      assert.equal(userId, sockets.__test.buildUserId(userSecret));
      assert.match(userId, /^[a-z]+$/);
      assert.equal(
        name,
        sockets.__test.buildUserName("203.0.113.40", userSecret),
      );
      assert.equal(record.userId, userId);
      assert.equal(record.name, name);
      assert.equal(record.lastSeen, 123);
    },
  );
});

test("board user record seeds tool color and size from socket query", async () => {
  await createSocketScenario(
    { historyDirPrefix: false },
    async ({ sockets }) => {
      const { socket } = createSocket({
        remoteAddress: "203.0.113.41",
        headers: withUserSecretCookie("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        query: {
          tool: "rectangle",
          color: "#123456",
          size: "12",
        },
      });

      const record = sockets.__test.buildBoardUserRecord(
        socket,
        "board-a",
        createConfig(),
        456,
      );
      assert.equal(record.socketId, "socket-1");
      assert.equal(record.ip, "203.0.113.41");
      assert.equal(record.lastTool, "rectangle");
      assert.equal(record.color, "#123456");
      assert.equal(record.size, 12);
      assert.equal(record.lastSeen, 456);
    },
  );
});

test("board user maps are created lazily and cleaned when emptied", async () => {
  await createSocketScenario({ historyDirPrefix: false }, async ({ test }) => {
    const users = test.getBoardUserMap("board-a");
    users.set("socket-1", {
      socketId: "socket-1",
      userId: "sample",
      name: "north sample",
      ip: "203.0.113.50",
      color: "#001f3f",
      size: 4,
      lastTool: "hand",
      lastSeen: 1,
    });
    assert.equal(test.getBoardUserMap("board-a").size, 1);

    users.delete("socket-1");
    test.cleanupBoardUserMap("board-a");

    const freshUsers = test.getBoardUserMap("board-a");
    assert.equal(freshUsers.size, 0);
    assert.notEqual(freshUsers, users);
  });
});

test("joining a board replays joined users to the socket and broadcasts newcomer joins", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-join-" },
    async ({ connect }) => {
      const first = await connect({
        id: "socket-1",
        remoteAddress: "203.0.113.60",
        headers: withUserSecretCookie("11111111111111111111111111111111"),
        query: {
          board: "board-a",
          tool: "hand",
          color: "#111111",
          size: "6",
        },
      });

      const firstJoined = first.emitted.filter(
        (event) => event.event === "user_joined",
      );
      assert.equal(firstJoined.length, 1);
      assert.equal(
        getRequiredValue(firstJoined[0]).payload.socketId,
        "socket-1",
      );

      const second = await connect({
        id: "socket-2",
        remoteAddress: "203.0.113.61",
        headers: withUserSecretCookie("22222222222222222222222222222222"),
        query: {
          board: "board-a",
          tool: "rectangle",
          color: "#222222",
          size: "8",
        },
      });

      const secondJoined = second.emitted.filter(
        (event) => event.event === "user_joined",
      );
      assert.equal(secondJoined.length, 2);
      assert.deepEqual(
        secondJoined.map((event) => event.payload.socketId),
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

test("sync replay and live broadcasts carry contiguous seq for deterministic client replay", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-deterministic-" },
    async ({ connect, invoke }) => {
      const created = await connect({
        id: "socket-seq-deterministic",
        remoteAddress: "203.0.113.70",
        headers: withUserSecretCookie("33333333333333333333333333333333"),
        query: {
          board: "board-seq-deterministic",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });
      await invoke(created, "sync_request", {
        baselineSeq: 0,
      });

      await invoke(
        created,
        "broadcast",
        rectangleCreate({
          id: "rect-1",
          color: "#123456",
          size: 4,
          x: 0,
          y: 0,
          x2: 20,
          y2: 20,
        }),
      );

      const liveBroadcast = getRequiredValue(
        created.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(liveBroadcast.seq, 1);
      assert.deepEqual(liveBroadcast.mutation, {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "rect-1",
        color: "#123456",
        size: 10,
        x: 0,
        y: 0,
        x2: 20,
        y2: 20,
        socket: "socket-seq-deterministic",
      });

      const nextSocket = await connect({
        id: "socket-seq-deterministic-2",
        remoteAddress: "203.0.113.71",
        headers: withUserSecretCookie("44444444444444444444444444444444"),
        query: {
          board: "board-seq-deterministic",
          tool: "hand",
          color: "#444444",
          size: "5",
        },
      });
      await invoke(nextSocket, "sync_request", {
        baselineSeq: 0,
      });

      const replayEvents = nextSocket.emitted.filter((event) =>
        ["sync_replay_start", "broadcast", "sync_replay_end"].includes(
          event.event,
        ),
      );
      assert.deepEqual(
        replayEvents.map((event) => event.event),
        ["sync_replay_start", "broadcast", "sync_replay_end"],
      );
      assert.deepEqual(
        getRequiredValue(replayEvents[1]).payload,
        liveBroadcast,
      );
    },
  );
});

test("seq-sync clients bootstrap without a snapshot and receive an explicit empty replay", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-bootstrap-" },
    async ({ connect, handler }) => {
      const created = await connect({
        id: "socket-seq-empty",
        remoteAddress: "203.0.113.80",
        headers: withUserSecretCookie("55555555555555555555555555555555"),
        query: {
          board: "board-seq-empty",
          sync: "seq",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });

      assert.equal(
        created.emitted.some((event) => event.event === "broadcast"),
        false,
      );

      const syncRequest = handler(created, "sync_request");
      await syncRequest({ baselineSeq: 0 });

      const replayEvents = created.emitted.filter((event) =>
        ["boardstate", "sync_replay_start", "sync_replay_end"].includes(
          event.event,
        ),
      );
      assert.deepEqual(
        replayEvents.map((event) => event.event),
        ["boardstate", "sync_replay_start", "sync_replay_end"],
      );
      assert.deepEqual(getRequiredValue(replayEvents[1]).payload, {
        fromExclusiveSeq: 0,
        toInclusiveSeq: 0,
      });
      assert.deepEqual(getRequiredValue(replayEvents[2]).payload, {
        toInclusiveSeq: 0,
      });
    },
  );
});

test("board sockets use seq replay and seq envelopes even without a legacy sync flag", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-default-" },
    async ({ connect, handler, invoke }) => {
      const created = await connect({
        id: "socket-seq-default",
        remoteAddress: "203.0.113.80",
        headers: withUserSecretCookie("55555555555555555555555555555550"),
        query: {
          board: "board-seq-default",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });

      assert.equal(
        created.emitted.some((event) => event.event === "broadcast"),
        false,
      );

      const syncRequest = handler(created, "sync_request");
      await syncRequest({ baselineSeq: 0 });

      const replayEvents = created.emitted.filter((event) =>
        ["boardstate", "sync_replay_start", "sync_replay_end"].includes(
          event.event,
        ),
      );
      assert.deepEqual(
        replayEvents.map((event) => event.event),
        ["boardstate", "sync_replay_start", "sync_replay_end"],
      );

      await invoke(
        created,
        "broadcast",
        rectangleCreate({
          id: "rect-default-seq-1",
          color: "#123456",
          size: 4,
          x: 0,
          y: 0,
          x2: 20,
          y2: 20,
        }),
      );

      const seqBroadcasts = created.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.equal(seqBroadcasts.length, 1);
      assert.equal(getRequiredValue(seqBroadcasts[0]).payload.seq, 1);
      assert.deepEqual(getRequiredValue(seqBroadcasts[0]).payload.mutation, {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "rect-default-seq-1",
        color: "#123456",
        size: 10,
        x: 0,
        y: 0,
        x2: 20,
        y2: 20,
        socket: "socket-seq-default",
      });
      assert.equal(
        "revision" in getRequiredValue(seqBroadcasts[0]).payload,
        false,
      );
    },
  );
});

test("seq-sync clients receive contiguous mutation envelopes and can replay them on reconnect", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-replay-" },
    async ({ connect, handler }) => {
      const writer = await connect({
        id: "socket-seq-writer",
        remoteAddress: "203.0.113.81",
        headers: withUserSecretCookie("66666666666666666666666666666666"),
        query: {
          board: "board-seq-live",
          sync: "seq",
          tool: "rectangle",
          color: "#444444",
          size: "4",
        },
      });

      const _livePeer = await connect({
        id: "socket-seq-cursor-peer",
        remoteAddress: "203.0.113.84",
        headers: withUserSecretCookie("99999999999999999999999999999997"),
        query: {
          board: "board-seq-cursor",
          sync: "seq",
          tool: "hand",
          color: "#777777",
          size: "4",
        },
      });

      const broadcast = handler(writer, "broadcast");
      await broadcast(
        rectangleCreate({
          id: "rect-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 4,
        }),
      );

      const acceptedEnvelope = getRequiredValue(
        writer.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(acceptedEnvelope.seq, 1);
      assert.equal(acceptedEnvelope.mutation.id, "rect-1");

      const reconnect = await connect({
        id: "socket-seq-reconnect",
        remoteAddress: "203.0.113.82",
        headers: withUserSecretCookie("77777777777777777777777777777777"),
        query: {
          board: "board-seq-live",
          sync: "seq",
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });
      const syncRequest = handler(reconnect, "sync_request");
      await syncRequest({ baselineSeq: 0 });

      const replayedEvents = reconnect.emitted.filter((event) =>
        [
          "boardstate",
          "sync_replay_start",
          "broadcast",
          "sync_replay_end",
        ].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "sync_replay_start", "broadcast", "sync_replay_end"],
      );
      assert.equal(getRequiredValue(replayedEvents[2]).payload.seq, 1);
      assert.deepEqual(getRequiredValue(replayedEvents[3]).payload, {
        toInclusiveSeq: 1,
      });
    },
  );
});

test("seq-sync clients with a stale cached baseline replay only newer contiguous envelopes", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-stale-baseline-" },
    async ({ connect, handler, invoke }) => {
      const writer = await connect({
        id: "socket-seq-stale-writer",
        remoteAddress: "203.0.113.85",
        headers: withUserSecretCookie("99999999999999999999999999999995"),
        query: {
          board: "board-seq-stale",
          sync: "seq",
          tool: "rectangle",
          color: "#444444",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast(
        rectangleCreate({
          id: "rect-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 4,
        }),
      );
      await broadcast(
        rectangleCreate({
          id: "rect-2",
          x: 20,
          y: 20,
          x2: 30,
          y2: 30,
          color: "#555555",
          size: 4,
        }),
      );

      const reconnect = await connect({
        id: "socket-seq-stale-reconnect",
        remoteAddress: "203.0.113.86",
        headers: withUserSecretCookie("99999999999999999999999999999994"),
        query: {
          board: "board-seq-stale",
          sync: "seq",
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });
      await invoke(reconnect, "sync_request", {
        baselineSeq: 1,
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        [
          "boardstate",
          "sync_replay_start",
          "broadcast",
          "sync_replay_end",
        ].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "sync_replay_start", "broadcast", "sync_replay_end"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[1]).payload, {
        fromExclusiveSeq: 1,
        toInclusiveSeq: 2,
      });
      assert.equal(getRequiredValue(replayedEvents[2]).payload.seq, 2);
      assert.equal(
        getRequiredValue(replayedEvents[2]).payload.mutation.id,
        "rect-2",
      );
    },
  );
});

test("seq-sync replay stays correct when persistence finishes between baseline fetch and replay start", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-persist-race-" },
    async ({ connect, handler, getLoadedBoard, invoke }) => {
      const writer = await connect({
        id: "socket-seq-race-writer",
        remoteAddress: "203.0.113.92",
        headers: withUserSecretCookie("99999999999999999999999999999992"),
        query: {
          board: "board-seq-race",
          sync: "seq",
          tool: "rectangle",
          color: "#444444",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast(
        rectangleCreate({
          id: "rect-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 4,
        }),
      );
      await broadcast(
        rectangleCreate({
          id: "rect-2",
          x: 20,
          y: 20,
          x2: 30,
          y2: 30,
          color: "#555555",
          size: 4,
        }),
      );

      const loadedBoard = await getLoadedBoard("board-seq-race");
      await loadedBoard.save();

      const reconnect = await connect({
        id: "socket-seq-race-reconnect",
        remoteAddress: "203.0.113.93",
        headers: withUserSecretCookie("99999999999999999999999999999993"),
        query: {
          board: "board-seq-race",
          sync: "seq",
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });
      await invoke(reconnect, "sync_request", {
        baselineSeq: 1,
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        [
          "boardstate",
          "sync_replay_start",
          "broadcast",
          "sync_replay_end",
        ].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "sync_replay_start", "broadcast", "sync_replay_end"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[1]).payload, {
        fromExclusiveSeq: 1,
        toInclusiveSeq: 2,
      });
      assert.equal(getRequiredValue(replayedEvents[2]).payload.seq, 2);
      assert.equal(
        getRequiredValue(replayedEvents[2]).payload.mutation.id,
        "rect-2",
      );
    },
  );
});

test("seq-sync sockets do not receive live persistent broadcasts before replay catch-up completes", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-live-gated-" },
    async ({ connect, handler, invoke }) => {
      const writer = await connect({
        id: "socket-seq-gated-writer",
        remoteAddress: "203.0.113.185",
        headers: withUserSecretCookie("99999999999999999999999999999185"),
        query: {
          board: "board-seq-live-gated",
          sync: "seq",
          tool: "rectangle",
          color: "#444444",
          size: "4",
        },
      });
      const peer = await connect({
        id: "socket-seq-gated-peer",
        remoteAddress: "203.0.113.186",
        headers: withUserSecretCookie("99999999999999999999999999999186"),
        query: {
          board: "board-seq-live-gated",
          sync: "seq",
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });

      const broadcast = handler(writer, "broadcast");
      await broadcast(
        rectangleCreate({
          id: "rect-before-sync",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 4,
        }),
      );

      assert.equal(
        peer.emitted.filter((event) => event.event === "broadcast").length,
        0,
      );

      await invoke(peer, "sync_request", {
        baselineSeq: 0,
      });

      const replayedBroadcasts = peer.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.equal(replayedBroadcasts.length, 1);
      assert.equal(getRequiredValue(replayedBroadcasts[0]).payload.seq, 1);

      await broadcast(
        rectangleCreate({
          id: "rect-after-sync",
          x: 20,
          y: 20,
          x2: 30,
          y2: 30,
          color: "#555555",
          size: 4,
        }),
      );

      const liveBroadcasts = peer.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.equal(liveBroadcasts.length, 2);
      assert.equal(getRequiredValue(liveBroadcasts[1]).payload.seq, 2);
    },
  );
});

test("seq-sync replay gaps force resync_required when the requested baseline is no longer replayable", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-gap-resync-" },
    async ({ connect, getLoadedBoard, handler, invoke }) => {
      const writer = await connect({
        id: "socket-seq-gap-writer",
        remoteAddress: "203.0.113.87",
        headers: withUserSecretCookie("99999999999999999999999999999993"),
        query: {
          board: "board-seq-gap",
          sync: "seq",
          tool: "rectangle",
          color: "#666666",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast(
        rectangleCreate({
          id: "rect-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#666666",
          size: 4,
        }),
      );
      await broadcast(
        rectangleCreate({
          id: "rect-2",
          x: 20,
          y: 20,
          x2: 30,
          y2: 30,
          color: "#777777",
          size: 4,
        }),
      );

      const loadedBoard = await getLoadedBoard("board-seq-gap");
      loadedBoard.trimMutationLogBefore(2);

      const reconnect = await connect({
        id: "socket-seq-gap-reconnect",
        remoteAddress: "203.0.113.88",
        headers: withUserSecretCookie("99999999999999999999999999999992"),
        query: {
          board: "board-seq-gap",
          sync: "seq",
          tool: "hand",
          color: "#777777",
          size: "4",
        },
      });
      await invoke(reconnect, "sync_request", {
        baselineSeq: 0,
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        ["boardstate", "sync_replay_start", "resync_required"].includes(
          event.event,
        ),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "resync_required"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[1]).payload, {
        latestSeq: 2,
        minReplayableSeq: 1,
      });
    },
  );
});

test("seq-sync resync_required warning includes client identity fields", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-gap-resync-log-" },
    async ({ connect, getLoadedBoard, invoke, sockets }) => {
      const writer = await connect({
        id: "socket-seq-gap-log-writer",
        remoteAddress: "203.0.113.90",
        headers: withUserSecretCookie("99999999999999999999999999999990"),
        query: {
          board: "board-seq-gap-log",
          sync: "seq",
          tool: "rectangle",
          color: "#666666",
          size: "4",
        },
      });
      await invoke(writer, "broadcast", {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "rect-log-1",
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        color: "#666666",
        size: 10,
      });

      const loadedBoard = await getLoadedBoard("board-seq-gap-log");
      loadedBoard.trimMutationLogBefore(1);

      const reconnectSecret = "99999999999999999999999999999991";
      const reconnect = await connect({
        id: "socket-seq-gap-log-reconnect",
        remoteAddress: "203.0.113.91",
        headers: withUserSecretCookie(reconnectSecret),
        query: {
          board: "board-seq-gap-log",
          sync: "seq",
          tool: "hand",
          color: "#777777",
          size: "4",
        },
      });

      await invoke(reconnect, "sync_request", {
        baselineSeq: 0,
      });

      assert.deepEqual(
        sockets.__test.boardUserDebugFields(
          "board-seq-gap-log",
          "socket-seq-gap-log-reconnect",
        ),
        {
          "user.name": sockets.__test.buildUserName(
            "203.0.113.91",
            reconnectSecret,
          ),
          "client.address": "203.0.113.91",
        },
      );
    },
  );
});

test("persistent writes fan out as seq envelopes to every peer", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-fanout-" },
    async ({ connect, invoke }) => {
      const writer = await connect({
        id: "socket-mixed-writer",
        remoteAddress: "203.0.113.89",
        headers: withUserSecretCookie("99999999999999999999999999999989"),
        query: {
          board: "board-mixed-sync",
          tool: "rectangle",
          color: "#111111",
          size: "4",
        },
      });
      const seqPeer = await connect({
        id: "socket-mixed-seq-peer",
        remoteAddress: "203.0.113.90",
        headers: withUserSecretCookie("99999999999999999999999999999990"),
        query: {
          board: "board-mixed-sync",
          tool: "hand",
          color: "#222222",
          size: "4",
        },
      });
      const defaultPeer = await connect({
        id: "socket-mixed-default-peer",
        remoteAddress: "203.0.113.91",
        headers: withUserSecretCookie("99999999999999999999999999999991"),
        query: {
          board: "board-mixed-sync",
          tool: "hand",
          color: "#333333",
          size: "4",
        },
      });

      writer.socket.broadcast = {
        to(room) {
          return {
            emit(event, payload) {
              writer.broadcasted.push({ event, payload, room });
              [seqPeer.socket, defaultPeer.socket]
                .filter((target) => target.rooms.has(room))
                .forEach((target) => {
                  target.emit(event, payload);
                });
            },
          };
        },
      };

      await invoke(
        writer,
        "broadcast",
        rectangleCreate({
          id: "rect-mixed-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#111111",
          size: 4,
        }),
      );

      const seqPeerBroadcasts = seqPeer.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.equal(seqPeerBroadcasts.length, 1);
      assert.equal(getRequiredValue(seqPeerBroadcasts[0]).payload.seq, 1);
      assert.deepEqual(
        getRequiredValue(seqPeerBroadcasts[0]).payload.mutation,
        {
          tool: Rectangle.id,
          type: MutationType.CREATE,
          id: "rect-mixed-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#111111",
          size: 10,
          socket: "socket-mixed-writer",
        },
      );
      assert.equal(
        typeof getRequiredValue(seqPeerBroadcasts[0]).payload.acceptedAtMs,
        "number",
      );
      assert.equal(
        "revision" in getRequiredValue(seqPeerBroadcasts[0]).payload,
        false,
      );

      const defaultPeerBroadcasts = defaultPeer.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.equal(defaultPeerBroadcasts.length, 1);
      assert.deepEqual(
        getRequiredValue(defaultPeerBroadcasts[0]).payload,
        getRequiredValue(seqPeerBroadcasts[0]).payload,
      );
    },
  );
});

test("seq-sync cursor updates stay ephemeral and are not replayed", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-cursor-" },
    async ({ connect, invoke }) => {
      const writer = await connect({
        id: "socket-seq-cursor-writer",
        remoteAddress: "203.0.113.83",
        headers: withUserSecretCookie("88888888888888888888888888888888"),
        query: {
          board: "board-seq-cursor",
          sync: "seq",
          tool: "hand",
          color: "#666666",
          size: "4",
        },
      });
      await invoke(
        writer,
        "broadcast",
        cursorUpdate({
          x: 12,
          y: 34,
          color: "#00aa11",
          size: 6,
        }),
      );

      assert.deepEqual(
        getRequiredValue(
          writer.broadcasted.find((event) => event.event === "broadcast"),
        ).payload,
        {
          tool: Cursor.id,
          type: MutationType.UPDATE,
          x: 12,
          y: 34,
          color: "#00aa11",
          size: 10,
          socket: "socket-seq-cursor-writer",
        },
      );
      assert.equal(
        writer.emitted.some((event) => event.event === "broadcast"),
        false,
      );

      const reconnect = await connect({
        id: "socket-seq-cursor-reconnect",
        remoteAddress: "203.0.113.84",
        headers: withUserSecretCookie("99999999999999999999999999999998"),
        query: {
          board: "board-seq-cursor",
          sync: "seq",
          tool: "hand",
          color: "#777777",
          size: "4",
        },
      });
      await invoke(reconnect, "sync_request", {
        baselineSeq: 0,
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        [
          "boardstate",
          "sync_replay_start",
          "broadcast",
          "sync_replay_end",
        ].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "sync_replay_start", "sync_replay_end"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[2]).payload, {
        toInclusiveSeq: 0,
      });
    },
  );
});

test("rejected board mutations emit mutation_rejected with the clientMutationId", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-mutation-rejected-" },
    async ({ connect, invoke }) => {
      const writer = await connect({
        id: "socket-seq-rejected",
        remoteAddress: "203.0.113.86",
        headers: withUserSecretCookie("99999999999999999999999999999996"),
        query: {
          board: "board-rejected",
          sync: "seq",
          tool: "hand",
          color: "#888888",
          size: "4",
        },
      });
      await invoke(
        writer,
        "broadcast",
        pencilAppend({
          parent: "missing-line",
          x: 10,
          y: 20,
          clientMutationId: "cm-reject-1",
        }),
      );

      assert.deepEqual(
        getRequiredValue(
          writer.emitted.find((event) => event.event === "mutation_rejected"),
        ).payload,
        {
          clientMutationId: "cm-reject-1",
          reason: "invalid parent for child",
        },
      );
      assert.equal(
        writer.emitted.some((event) => event.event === "broadcast"),
        false,
      );
    },
  );
});

test("rejected oversized seed updates emit a sequenced authoritative delete followup", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-rejected-seed-followup-" },
    async ({ connect, getLoadedBoard, handler }) => {
      const writer = await connect({
        id: "socket-seq-rejected-seed",
        remoteAddress: "203.0.113.85",
        headers: withUserSecretCookie("99999999999999999999999999999995"),
        query: {
          board: "board-rejected-seed",
          sync: "seq",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast(
        rectangleCreate({
          id: "rect-seed",
          x: 10,
          y: 10,
          x2: 10,
          y2: 10,
          color: "#333333",
          size: 4,
          clientMutationId: "cm-seed-create",
        }),
      );
      await broadcast(
        rectangleUpdate({
          id: "rect-seed",
          x: 10,
          y: 10,
          x2: 40015,
          y2: 20,
          clientMutationId: "cm-seed-grow",
        }),
      );

      assert.deepEqual(
        getRequiredValue(
          writer.emitted.find((event) => event.event === "mutation_rejected"),
        ).payload,
        {
          clientMutationId: "cm-seed-grow",
          reason: "update rejected: shape too large",
        },
      );

      const seqBroadcasts = writer.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.deepEqual(
        seqBroadcasts.map((event) => getRequiredValue(event).payload.seq),
        [1, 2],
      );
      assert.deepEqual(getRequiredValue(seqBroadcasts[1]).payload.mutation, {
        tool: Eraser.id,
        type: MutationType.DELETE,
        id: "rect-seed",
      });
      assert.deepEqual(getRequiredValue(seqBroadcasts[0]).payload.mutation, {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "rect-seed",
        clientMutationId: "cm-seed-create",
        x: 10,
        y: 10,
        x2: 10,
        y2: 10,
        color: "#333333",
        size: 10,
        socket: "socket-seq-rejected-seed",
      });

      const loadedBoard = await getLoadedBoard("board-rejected-seed");
      assert.equal(loadedBoard.get("rect-seed"), undefined);
    },
  );
});

test("accepted creates that overflow the item cap emit a sequenced live trim delete followup", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-live-item-trim-",
      config: { MAX_ITEM_COUNT: 2 },
    },
    async ({ connect, getLoadedBoard, handler }) => {
      const writer = await connect({
        id: "socket-live-item-trim",
        remoteAddress: "203.0.113.86",
        headers: withUserSecretCookie("99999999999999999999999999999994"),
        query: {
          board: "board-live-item-trim",
          sync: "seq",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast(
        rectangleCreate({
          id: "rect-1",
          x: 10,
          y: 10,
          x2: 20,
          y2: 20,
          color: "#111111",
          size: 4,
          clientMutationId: "cm-rect-1",
        }),
      );
      await broadcast(
        rectangleCreate({
          id: "rect-2",
          x: 20,
          y: 20,
          x2: 30,
          y2: 30,
          color: "#222222",
          size: 4,
          clientMutationId: "cm-rect-2",
        }),
      );
      await broadcast(
        rectangleCreate({
          id: "rect-3",
          x: 30,
          y: 30,
          x2: 40,
          y2: 40,
          color: "#333333",
          size: 4,
          clientMutationId: "cm-rect-3",
        }),
      );

      const seqBroadcasts = writer.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.deepEqual(
        seqBroadcasts.map((event) => getRequiredValue(event).payload.seq),
        [1, 2, 3, 4],
      );
      assert.deepEqual(getRequiredValue(seqBroadcasts[2]).payload.mutation, {
        tool: Rectangle.id,
        type: MutationType.CREATE,
        id: "rect-3",
        clientMutationId: "cm-rect-3",
        x: 30,
        y: 30,
        x2: 40,
        y2: 40,
        color: "#333333",
        size: 10,
        socket: "socket-live-item-trim",
      });
      assert.deepEqual(getRequiredValue(seqBroadcasts[3]).payload.mutation, {
        tool: Eraser.id,
        type: MutationType.DELETE,
        id: "rect-1",
      });

      const loadedBoard = await getLoadedBoard("board-live-item-trim");
      assert.equal(loadedBoard.get("rect-1"), undefined);
      assert.deepEqual(Object.keys(loadedBoard.board).sort(), [
        "rect-2",
        "rect-3",
      ]);
    },
  );
});

test("disconnecting from a board broadcasts user_left and cleans the board user map", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-left-" },
    async ({ connect, invoke, test }) => {
      const created = await connect({
        id: "socket-9",
        remoteAddress: "203.0.113.69",
        headers: withUserSecretCookie("99999999999999999999999999999999"),
        query: {
          board: "board-left",
          tool: "hand",
          color: "#999999",
          size: "5",
        },
      });
      await invoke(created, "disconnecting", "transport close");

      assert.deepEqual(created.broadcasted[0], {
        event: "user_joined",
        payload: getRequiredValue(
          created.emitted.find((event) => event.event === "user_joined"),
        ).payload,
        room: "board-left",
      });
      assert.deepEqual(created.broadcasted[1], {
        event: "user_left",
        payload: {
          socketId: "socket-9",
        },
        room: "board-left",
      });
      assert.equal(test.getBoardUserMap("board-left").size, 0);
    },
  );
});

test("socket shutdown persists and unloads boards even when users are still connected", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-shutdown-" },
    async ({ historyDir, connect, invoke, getLoadedBoard, sockets }) => {
      const svgBoardStore = require("../server/svg_board_store.mjs");
      const created = await connect({
        id: "socket-shutdown",
        remoteAddress: "203.0.113.170",
        headers: withUserSecretCookie("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"),
        query: {
          board: "board-shutdown",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });

      await invoke(
        created,
        "broadcast",
        rectangleCreate({
          id: "rect-shutdown",
          color: "#123456",
          size: 4,
          x: 1,
          y: 2,
          x2: 20,
          y2: 30,
        }),
      );

      await sockets.shutdown();

      assert.equal(await getLoadedBoard("board-shutdown"), undefined);
      const savedSvg = await svgBoardStore.readServedBaseline(
        "board-shutdown",
        {
          historyDir,
        },
      );
      assert.match(savedSvg, /id="rect-shutdown"/);
    },
  );
});

test("live broadcasts attach socket attribution and keep the user's latest non-cursor state", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-live-" },
    async ({ connect, invoke, test }) => {
      const created = await connect({
        id: "socket-live",
        remoteAddress: "203.0.113.80",
        headers: withUserSecretCookie("10101010101010101010101010101010"),
        query: {
          board: "board-live",
          tool: "hand",
          color: "#101010",
          size: "4",
        },
      });
      await invoke(
        created,
        "broadcast",
        rectangleCreate({
          id: "shape-1",
          color: "#123456",
          size: 9,
          x: 1,
          y: 2,
          x2: 11,
          y2: 22,
        }),
      );

      const user = getRequiredValue(
        test.getBoardUserMap("board-live").get("socket-live"),
      );
      const persistentEnvelope = getRequiredValue(
        created.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(persistentEnvelope.mutation.socket, "socket-live");
      assert.equal(Object.hasOwn(persistentEnvelope.mutation, "userId"), false);
      assert.equal(user.lastTool, "rectangle");
      assert.equal(user.color, "#123456");
      assert.equal(user.size, 10);

      await invoke(
        created,
        "broadcast",
        cursorUpdate({
          x: 9,
          y: 10,
          color: "#abcdef",
          size: 12,
        }),
      );

      assert.equal(user.lastTool, "rectangle");
      assert.equal(user.color, "#abcdef");
      assert.equal(user.size, 12);
      const cursorBroadcast = getRequiredValue(
        created.broadcasted.findLast((event) => event.event === "broadcast"),
      );
      assert.equal(cursorBroadcast.payload.socket, user.socketId);
    },
  );
});

test("same-session sockets keep a shared userId in presence but live payload attribution stays per socket", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-session-" },
    async ({ connect, invoke, test }) => {
      const first = await connect({
        id: "socket-a",
        remoteAddress: "203.0.113.81",
        headers: withUserSecretCookie("abababababababababababababababab"),
        query: {
          board: "board-session",
          tool: "hand",
          color: "#111111",
          size: "4",
        },
      });
      const second = await connect({
        id: "socket-b",
        remoteAddress: "203.0.113.81",
        headers: withUserSecretCookie("abababababababababababababababab"),
        query: {
          board: "board-session",
          tool: "hand",
          color: "#222222",
          size: "5",
        },
      });

      const users = test.getBoardUserMap("board-session");
      const firstUser = getRequiredValue(users.get("socket-a"));
      const secondUser = getRequiredValue(users.get("socket-b"));
      assert.equal(firstUser.userId, secondUser.userId);

      await invoke(
        first,
        "broadcast",
        rectangleCreate({
          id: "shape-session",
          color: "#123456",
          size: 7,
          x: 10,
          y: 20,
          x2: 30,
          y2: 40,
        }),
      );

      const liveEnvelope = getRequiredValue(
        second.emitted.find((event) => event.event === "broadcast"),
      );
      const payload = liveEnvelope.payload.mutation;
      assert.equal(payload.socket, "socket-a");
      assert.equal(Object.hasOwn(payload, "userId"), false);
      assert.equal(firstUser.lastTool, "rectangle");
      assert.equal(secondUser.lastTool, "hand");
    },
  );
});

test("report_user logs reporter and reported user details for active board members", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-",
      env: { WBO_SILENT: "true" },
    },
    async ({ connect, handler, test }) => {
      const reporter = await connect({
        id: "socket-reporter",
        remoteAddress: "203.0.113.90",
        headers: withUserSecretCookie("cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd", {
          "user-agent": "ReporterAgent/1.0",
          "accept-language": "fr-FR,fr;q=0.9",
        }),
        query: {
          board: "board-report",
          tool: "hand",
          color: "#222222",
          size: "4",
        },
      });
      const reporterEmitCountBeforeReport = reporter.emitted.length;

      const reported = await connect({
        id: "socket-reported",
        remoteAddress: "203.0.113.91",
        headers: withUserSecretCookie("efefefefefefefefefefefefefefefef", {
          "user-agent": "ReportedAgent/2.0",
          "accept-language": "en-US,en;q=0.8",
        }),
        query: {
          board: "board-report",
          tool: "ellipse",
          color: "#333333",
          size: "7",
        },
      });
      const reportedEmitCountBeforeReport = reported.emitted.length;

      handler(
        reporter,
        "report_user",
      )({
        socketId: "socket-reported",
      });

      const reportedLog = test.getLastUserReportLog();
      assert.ok(reportedLog);
      assert.equal(reportedLog.reporter_ip, "203.0.113.90");
      assert.equal(reportedLog.reported_ip, "203.0.113.91");
      assert.equal(reportedLog.reporter_socket, "socket-reporter");
      assert.equal(reportedLog.reported_socket, "socket-reported");
      assert.equal(reportedLog.reporter_user_agent, "ReporterAgent/1.0");
      assert.equal(reportedLog.reported_user_agent, "ReportedAgent/2.0");
      assert.equal(reportedLog.reporter_language, "fr-FR,fr;q=0.9");
      assert.equal(reportedLog.reported_language, "en-US,en;q=0.8");
      assert.equal(reporter.socket.client.conn.closeCalls.length, 1);
      assert.equal(reported.socket.client.conn.closeCalls.length, 1);
      assert.deepEqual(reporter.socket.disconnectCalls, []);
      assert.deepEqual(reported.socket.disconnectCalls, []);
      assert.equal(reporter.emitted.length, reporterEmitCountBeforeReport);
      assert.equal(reported.emitted.length, reportedEmitCountBeforeReport);
    },
  );
});

test("report_user respects custom header ip sources for active board members", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-header-",
      config: { IP_SOURCE: "CF-Connecting-IP" },
      env: {
        WBO_SILENT: "true",
      },
    },
    async ({ connect, handler, test }) => {
      const reporter = await connect({
        id: "socket-reporter-header",
        remoteAddress: "203.0.113.100",
        headers: withUserSecretCookie("12121212121212121212121212121212", {
          "cf-connecting-ip": "198.51.100.30",
          "user-agent": "ReporterHeaderAgent/1.0",
          "accept-language": "de-DE,de;q=0.9",
        }),
        query: {
          board: "board-report",
          tool: "hand",
        },
      });

      const _reported = await connect({
        id: "socket-reported-header",
        remoteAddress: "203.0.113.101",
        headers: withUserSecretCookie("34343434343434343434343434343434", {
          "cf-connecting-ip": "198.51.100.31",
          "user-agent": "ReportedHeaderAgent/2.0",
          "accept-language": "es-ES,es;q=0.8",
        }),
        query: {
          board: "board-report",
          tool: "ellipse",
        },
      });

      handler(
        reporter,
        "report_user",
      )({
        socketId: "socket-reported-header",
      });

      const reportedLog = test.getLastUserReportLog();
      assert.ok(reportedLog);
      assert.equal(reportedLog.reporter_ip, "198.51.100.30");
      assert.equal(reportedLog.reported_ip, "198.51.100.31");
      assert.equal(reportedLog.reporter_user_agent, "ReporterHeaderAgent/1.0");
      assert.equal(reportedLog.reported_user_agent, "ReportedHeaderAgent/2.0");
      assert.equal(reportedLog.reporter_language, "de-DE,de;q=0.9");
      assert.equal(reportedLog.reported_language, "es-ES,es;q=0.8");
      assert.notEqual(reportedLog.reporter_ip, "203.0.113.100");
      assert.notEqual(reportedLog.reported_ip, "203.0.113.101");
    },
  );
});

test("seq mismatch drops the stale board instance and disconnects attached sockets", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-stale-save-drop-",
      boardName: "stale-save-drop",
    },
    async ({ historyDir, connect, invoke, handler, getLoadedBoard, test }) => {
      const first = await connect({
        id: "socket-first",
        query: { board: "stale-save-drop" },
      });
      const second = await connect({
        id: "socket-second",
        query: { board: "stale-save-drop" },
      });

      await invoke(
        first,
        "broadcast",
        rectangleCreate({
          id: "rect-1",
          color: "#111111",
          size: 2,
          x: 1,
          y: 2,
          x2: 3,
          y2: 4,
        }),
      );

      const board = await getLoadedBoard("stale-save-drop");
      assert.deepEqual(await board.save(), { status: "saved" });

      const svgPath = path.join(
        /** @type {string} */ (historyDir),
        "board-stale-save-drop.svg",
      );
      const persistedSvg = await fs.readFile(svgPath, "utf8");
      await fs.writeFile(
        svgPath,
        persistedSvg.replace('data-wbo-seq="1"', 'data-wbo-seq="99"'),
        "utf8",
      );

      await invoke(
        first,
        "broadcast",
        rectangleCreate({
          id: "rect-2",
          color: "#222222",
          size: 2,
          x: 5,
          y: 6,
          x2: 7,
          y2: 8,
        }),
      );

      assert.deepEqual(await board.save(), { status: "stale" });
      assert.equal(board.disposed, true);
      assert.equal(first.socket.disconnected, true);
      assert.equal(second.socket.disconnected, true);
      assert.equal(test.getBoardUserMap("stale-save-drop").size, 0);
      assert.equal(await getLoadedBoard("stale-save-drop"), undefined);

      const reconnect = await connect({
        id: "socket-reconnect",
        query: { board: "stale-save-drop" },
      });

      const reloadedBoard = await getLoadedBoard("stale-save-drop");
      assert.notEqual(reloadedBoard, board);
      assert.deepEqual(Object.keys(reloadedBoard.board), ["rect-1"]);

      handler(reconnect, "disconnecting")("transport close");
    },
  );
});
