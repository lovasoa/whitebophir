const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  configFromEnv,
  createSocketScenario,
  createSocket,
} = require("./test_helpers.js");
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
        configFromEnv({ WBO_IP_SOURCE: "remoteAddress" }),
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
          tool: "Rectangle",
          color: "#123456",
          size: "12",
        },
      });

      const record = sockets.__test.buildBoardUserRecord(
        socket,
        "board-a",
        configFromEnv({ WBO_IP_SOURCE: "remoteAddress" }),
        456,
      );
      assert.equal(record.socketId, "socket-1");
      assert.equal(record.ip, "203.0.113.41");
      assert.equal(record.lastTool, "Rectangle");
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
      lastTool: "Hand",
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
          tool: "Hand",
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
          tool: "Rectangle",
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
          tool: "Rectangle",
          color: "#333333",
          size: "4",
        },
      });
      await invoke(created, "sync_request", {
        baselineSeq: 0,
      });

      await invoke(created, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        color: "#123456",
        size: 4,
        x: 0,
        y: 0,
        x2: 20,
        y2: 20,
      });

      const liveBroadcast = getRequiredValue(
        created.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(liveBroadcast.seq, 1);
      assert.deepEqual(liveBroadcast.mutation, {
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        color: "#123456",
        size: 4,
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
          tool: "Hand",
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
          tool: "Rectangle",
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
        type: "sync_replay_start",
        fromExclusiveSeq: 0,
        toInclusiveSeq: 0,
      });
      assert.deepEqual(getRequiredValue(replayEvents[2]).payload, {
        type: "sync_replay_end",
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
          tool: "Rectangle",
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

      await invoke(created, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "rect-default-seq-1",
        color: "#123456",
        size: 4,
        x: 0,
        y: 0,
        x2: 20,
        y2: 20,
      });

      const seqBroadcasts = created.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.equal(seqBroadcasts.length, 1);
      assert.equal(getRequiredValue(seqBroadcasts[0]).payload.seq, 1);
      assert.deepEqual(getRequiredValue(seqBroadcasts[0]).payload.mutation, {
        tool: "Rectangle",
        type: "rect",
        id: "rect-default-seq-1",
        color: "#123456",
        size: 4,
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
          tool: "Rectangle",
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
          tool: "Hand",
          color: "#777777",
          size: "4",
        },
      });

      const broadcast = handler(writer, "broadcast");
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        color: "#444444",
        size: 4,
      });

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
          tool: "Hand",
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
        type: "sync_replay_end",
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
          tool: "Rectangle",
          color: "#444444",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        color: "#444444",
        size: 4,
      });
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-2",
        x: 20,
        y: 20,
        x2: 30,
        y2: 30,
        color: "#555555",
        size: 4,
      });

      const reconnect = await connect({
        id: "socket-seq-stale-reconnect",
        remoteAddress: "203.0.113.86",
        headers: withUserSecretCookie("99999999999999999999999999999994"),
        query: {
          board: "board-seq-stale",
          sync: "seq",
          tool: "Hand",
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
        type: "sync_replay_start",
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
          tool: "Rectangle",
          color: "#444444",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        color: "#444444",
        size: 4,
      });
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-2",
        x: 20,
        y: 20,
        x2: 30,
        y2: 30,
        color: "#555555",
        size: 4,
      });

      const loadedBoard = await getLoadedBoard("board-seq-race");
      await loadedBoard.save();

      const reconnect = await connect({
        id: "socket-seq-race-reconnect",
        remoteAddress: "203.0.113.93",
        headers: withUserSecretCookie("99999999999999999999999999999993"),
        query: {
          board: "board-seq-race",
          sync: "seq",
          tool: "Hand",
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
        type: "sync_replay_start",
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
          tool: "Rectangle",
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
          tool: "Hand",
          color: "#555555",
          size: "4",
        },
      });

      const broadcast = handler(writer, "broadcast");
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-before-sync",
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        color: "#444444",
        size: 4,
      });

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

      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-after-sync",
        x: 20,
        y: 20,
        x2: 30,
        y2: 30,
        color: "#555555",
        size: 4,
      });

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
          tool: "Rectangle",
          color: "#666666",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        color: "#666666",
        size: 4,
      });
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-2",
        x: 20,
        y: 20,
        x2: 30,
        y2: 30,
        color: "#777777",
        size: 4,
      });

      const loadedBoard = await getLoadedBoard("board-seq-gap");
      loadedBoard.trimMutationLogBefore(2);

      const reconnect = await connect({
        id: "socket-seq-gap-reconnect",
        remoteAddress: "203.0.113.88",
        headers: withUserSecretCookie("99999999999999999999999999999992"),
        query: {
          board: "board-seq-gap",
          sync: "seq",
          tool: "Hand",
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
        type: "resync_required",
        latestSeq: 2,
        minReplayableSeq: 1,
      });
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
          tool: "Rectangle",
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
          tool: "Hand",
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
          tool: "Hand",
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

      await invoke(writer, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "rect-mixed-1",
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        color: "#111111",
        size: 4,
      });

      const seqPeerBroadcasts = seqPeer.emitted.filter(
        (event) => event.event === "broadcast",
      );
      assert.equal(seqPeerBroadcasts.length, 1);
      assert.equal(getRequiredValue(seqPeerBroadcasts[0]).payload.seq, 1);
      assert.deepEqual(
        getRequiredValue(seqPeerBroadcasts[0]).payload.mutation,
        {
          tool: "Rectangle",
          type: "rect",
          id: "rect-mixed-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#111111",
          size: 4,
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
          tool: "Hand",
          color: "#666666",
          size: "4",
        },
      });
      await invoke(writer, "broadcast", {
        tool: "Cursor",
        type: "update",
        x: 12,
        y: 34,
        color: "#00aa11",
        size: 6,
      });

      assert.deepEqual(
        getRequiredValue(
          writer.broadcasted.find((event) => event.event === "broadcast"),
        ).payload,
        {
          tool: "Cursor",
          type: "update",
          x: 12,
          y: 34,
          color: "#00aa11",
          size: 6,
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
          tool: "Hand",
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
        type: "sync_replay_end",
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
          tool: "Hand",
          color: "#888888",
          size: "4",
        },
      });
      await invoke(writer, "broadcast", {
        tool: "Pencil",
        type: "child",
        parent: "missing-line",
        x: 10,
        y: 20,
        clientMutationId: "cm-reject-1",
      });

      assert.deepEqual(
        getRequiredValue(
          writer.emitted.find((event) => event.event === "mutation_rejected"),
        ).payload,
        {
          type: "mutation_rejected",
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
          tool: "Rectangle",
          color: "#333333",
          size: "4",
        },
      });
      const broadcast = handler(writer, "broadcast");
      await broadcast({
        tool: "Rectangle",
        type: "rect",
        id: "rect-seed",
        x: 10,
        y: 10,
        x2: 10,
        y2: 10,
        color: "#333333",
        size: 4,
        clientMutationId: "cm-seed-create",
      });
      await broadcast({
        tool: "Rectangle",
        type: "update",
        id: "rect-seed",
        x: 10,
        y: 10,
        x2: 5000,
        y2: 20,
        clientMutationId: "cm-seed-grow",
      });

      assert.deepEqual(
        getRequiredValue(
          writer.emitted.find((event) => event.event === "mutation_rejected"),
        ).payload,
        {
          type: "mutation_rejected",
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
        tool: "Eraser",
        type: "delete",
        id: "rect-seed",
      });

      const loadedBoard = await getLoadedBoard("board-rejected-seed");
      assert.equal(loadedBoard.get("rect-seed"), undefined);
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
          tool: "Hand",
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
          tool: "Hand",
          color: "#101010",
          size: "4",
        },
      });
      await invoke(created, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "shape-1",
        color: "#123456",
        size: 9,
        x: 1,
        y: 2,
        x2: 11,
        y2: 22,
      });

      const user = getRequiredValue(
        test.getBoardUserMap("board-live").get("socket-live"),
      );
      const persistentEnvelope = getRequiredValue(
        created.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(persistentEnvelope.mutation.socket, "socket-live");
      assert.equal(Object.hasOwn(persistentEnvelope.mutation, "userId"), false);
      assert.equal(user.lastTool, "Rectangle");
      assert.equal(user.color, "#123456");
      assert.equal(user.size, 9);

      await invoke(created, "broadcast", {
        tool: "Cursor",
        type: "update",
        x: 9,
        y: 10,
        color: "#abcdef",
        size: 12,
      });

      assert.equal(user.lastTool, "Rectangle");
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
          tool: "Hand",
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
          tool: "Hand",
          color: "#222222",
          size: "5",
        },
      });

      const users = test.getBoardUserMap("board-session");
      const firstUser = getRequiredValue(users.get("socket-a"));
      const secondUser = getRequiredValue(users.get("socket-b"));
      assert.equal(firstUser.userId, secondUser.userId);

      await invoke(first, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "shape-session",
        color: "#123456",
        size: 7,
        x: 10,
        y: 20,
        x2: 30,
        y2: 40,
      });

      const liveEnvelope = getRequiredValue(
        second.emitted.find((event) => event.event === "broadcast"),
      );
      const payload = liveEnvelope.payload.mutation;
      assert.equal(payload.socket, "socket-a");
      assert.equal(Object.hasOwn(payload, "userId"), false);
      assert.equal(firstUser.lastTool, "Rectangle");
      assert.equal(secondUser.lastTool, "Hand");
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
          tool: "Hand",
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
          tool: "Ellipse",
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
      env: {
        WBO_IP_SOURCE: "CF-Connecting-IP",
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
          tool: "Hand",
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
          tool: "Ellipse",
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

test("reconnect during missing-baseline recovery keeps newer recoverable creations", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-missing-baseline-race-",
      boardName: "missing-baseline-race",
    },
    async ({ historyDir, connect, invoke, handler, getLoadedBoard }) => {
      const svgBoardStore = require("../server/svg_board_store.mjs");
      const first = await connect({
        id: "socket-first",
        query: { board: "missing-baseline-race" },
      });
      const second = await connect({
        id: "socket-second",
        query: { board: "missing-baseline-race" },
      });

      await invoke(first, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "rect-1",
        color: "#111111",
        size: 2,
        x: 1,
        y: 2,
        x2: 3,
        y2: 4,
      });

      const board = await getLoadedBoard("missing-baseline-race");
      await board.save();

      const svgPath = path.join(
        /** @type {string} */ (historyDir),
        "board-missing-baseline-race.svg",
      );
      await fs.unlink(svgPath);

      await invoke(first, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "rect-2",
        color: "#222222",
        size: 2,
        x: 5,
        y: 6,
        x2: 7,
        y2: 8,
      });

      handler(first, "disconnecting")("transport close");
      handler(second, "disconnecting")("transport close");

      const reconnect = await connect({
        id: "socket-reconnect",
        query: { board: "missing-baseline-race" },
      });
      const peer = await connect({
        id: "socket-peer",
        query: { board: "missing-baseline-race" },
      });

      await invoke(reconnect, "broadcast", {
        tool: "Rectangle",
        type: "rect",
        id: "rect-3",
        color: "#333333",
        size: 2,
        x: 9,
        y: 10,
        x2: 11,
        y2: 12,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.deepEqual(Object.keys(board.board).sort(), [
        "rect-1",
        "rect-2",
        "rect-3",
      ]);

      handler(reconnect, "disconnecting")("transport close");
      handler(peer, "disconnecting")("transport close");
      await new Promise((resolve) => setTimeout(resolve, 50));

      const savedSvg = await svgBoardStore.readServedBaseline(
        "missing-baseline-race",
        { historyDir },
      );
      assert.match(savedSvg, /id="rect-1"/);
      assert.match(savedSvg, /id="rect-2"/);
      assert.match(savedSvg, /id="rect-3"/);
    },
  );
});
