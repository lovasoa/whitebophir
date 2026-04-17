const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  configFromEnv,
  createSocket,
  loadSockets,
  withEnv,
} = require("./test_helpers.js");
const USER_SECRET_COOKIE_NAME = "wbo-user-secret-v1";

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
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async () => {
    const sockets = await loadSockets();
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
  });
});

test("board user record seeds tool color and size from socket query", async () => {
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async () => {
    const sockets = await loadSockets();
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
  });
});

test("board user maps are created lazily and cleaned when emptied", async () => {
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async () => {
    const sockets = await loadSockets();
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

test("joining a board replays joined users to the socket and broadcasts newcomer joins", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-join-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const first = createSocket({
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
      await sockets.__test.handleSocketConnection(first.socket);

      const firstJoined = first.emitted.filter(
        (event) => event.event === "user_joined",
      );
      assert.equal(firstJoined.length, 1);
      assert.equal(
        getRequiredValue(firstJoined[0]).payload.socketId,
        "socket-1",
      );

      const second = createSocket({
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
      await sockets.__test.handleSocketConnection(second.socket);

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

test("snapshot and live broadcasts carry revisions for deterministic client replay", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-revision-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const created = createSocket({
        id: "socket-revision",
        remoteAddress: "203.0.113.70",
        headers: withUserSecretCookie("33333333333333333333333333333333"),
        query: {
          board: "board-revision",
          tool: "Rectangle",
          color: "#333333",
          size: "4",
        },
      });
      await sockets.__test.handleSocketConnection(created.socket);

      const initialSnapshot = getRequiredValue(
        created.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(initialSnapshot.revision, 0);
      assert.deepEqual(initialSnapshot._children, []);

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
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
        created.broadcasted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(liveBroadcast.revision, 1);

      const nextSocket = createSocket({
        id: "socket-revision-2",
        remoteAddress: "203.0.113.71",
        headers: withUserSecretCookie("44444444444444444444444444444444"),
        query: {
          board: "board-revision",
          tool: "Hand",
          color: "#444444",
          size: "5",
        },
      });
      await sockets.__test.handleSocketConnection(nextSocket.socket);

      const replaySnapshot = getRequiredValue(
        nextSocket.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(replaySnapshot.revision, 1);
      assert.equal(replaySnapshot._children.length, 1);
      assert.equal(replaySnapshot._children[0].id, "rect-1");
    },
  );
});

test("seq-sync clients bootstrap without a snapshot and receive an explicit empty replay", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-seq-bootstrap-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const created = createSocket({
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
      await sockets.__test.handleSocketConnection(created.socket);

      assert.equal(
        created.emitted.some((event) => event.event === "broadcast"),
        false,
      );

      const syncRequest = getRequiredHandler(created.handlers, "sync_request");
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

test("seq-sync clients receive contiguous mutation envelopes and can replay them on reconnect", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-seq-replay-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const writer = createSocket({
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
      await sockets.__test.handleSocketConnection(writer.socket);

      const livePeer = createSocket({
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
      await sockets.__test.handleSocketConnection(livePeer.socket);

      const broadcast = getRequiredHandler(writer.handlers, "broadcast");
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

      const reconnect = createSocket({
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
      await sockets.__test.handleSocketConnection(reconnect.socket);
      const syncRequest = getRequiredHandler(
        reconnect.handlers,
        "sync_request",
      );
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
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-seq-stale-baseline-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const writer = createSocket({
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
      await sockets.__test.handleSocketConnection(writer.socket);
      const broadcast = getRequiredHandler(writer.handlers, "broadcast");
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

      const reconnect = createSocket({
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
      await sockets.__test.handleSocketConnection(reconnect.socket);
      await getRequiredHandler(
        reconnect.handlers,
        "sync_request",
      )({
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

test("seq-sync replay gaps force resync_required when the requested baseline is no longer replayable", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-seq-gap-resync-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const writer = createSocket({
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
      await sockets.__test.handleSocketConnection(writer.socket);
      const broadcast = getRequiredHandler(writer.handlers, "broadcast");
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

      const loadedBoard = await sockets.__test.getLoadedBoard("board-seq-gap");
      loadedBoard.trimMutationLogBefore(2);

      const reconnect = createSocket({
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
      await sockets.__test.handleSocketConnection(reconnect.socket);
      await getRequiredHandler(
        reconnect.handlers,
        "sync_request",
      )({
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

test("seq-sync cursor updates stay ephemeral and are not replayed", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-seq-cursor-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const writer = createSocket({
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
      await sockets.__test.handleSocketConnection(writer.socket);

      await getRequiredHandler(
        writer.handlers,
        "broadcast",
      )({
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

      const reconnect = createSocket({
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
      await sockets.__test.handleSocketConnection(reconnect.socket);
      await getRequiredHandler(
        reconnect.handlers,
        "sync_request",
      )({
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
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-mutation-rejected-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const writer = createSocket({
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
      await sockets.__test.handleSocketConnection(writer.socket);

      await getRequiredHandler(
        writer.handlers,
        "broadcast",
      )({
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

test("disconnecting from a board broadcasts user_left and cleans the board user map", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-left-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const created = createSocket({
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
      await sockets.__test.handleSocketConnection(created.socket);

      await getRequiredHandler(
        created.handlers,
        "disconnecting",
      )("transport close");

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
      assert.equal(sockets.__test.getBoardUserMap("board-left").size, 0);
    },
  );
});

test("live broadcasts attach socket attribution and keep the user's latest non-cursor state", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-live-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const created = createSocket({
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
      await sockets.__test.handleSocketConnection(created.socket);

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
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
        sockets.__test.getBoardUserMap("board-live").get("socket-live"),
      );
      assert.equal(
        getRequiredValue(created.broadcasted[1]).payload.socket,
        "socket-live",
      );
      assert.equal(
        Object.hasOwn(
          getRequiredValue(created.broadcasted[1]).payload,
          "userId",
        ),
        false,
      );
      assert.equal(user.lastTool, "Rectangle");
      assert.equal(user.color, "#123456");
      assert.equal(user.size, 9);

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
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
      assert.equal(
        getRequiredValue(created.broadcasted[2]).payload.socket,
        user.socketId,
      );
    },
  );
});

test("same-session sockets keep a shared userId in presence but live payload attribution stays per socket", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-session-"),
  );
  await withEnv(
    { WBO_IP_SOURCE: "remoteAddress", WBO_HISTORY_DIR: historyDir },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const first = createSocket({
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
      await sockets.__test.handleSocketConnection(first.socket);

      const second = createSocket({
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
      await sockets.__test.handleSocketConnection(second.socket);

      const users = sockets.__test.getBoardUserMap("board-session");
      const firstUser = getRequiredValue(users.get("socket-a"));
      const secondUser = getRequiredValue(users.get("socket-b"));
      assert.equal(firstUser.userId, secondUser.userId);

      await getRequiredHandler(
        first.handlers,
        "broadcast",
      )({
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

      const liveBroadcast = getRequiredValue(
        first.broadcasted.find((event) => event.event === "broadcast"),
      );
      const payload = liveBroadcast.payload;
      assert.equal(payload.socket, "socket-a");
      assert.equal(Object.hasOwn(payload, "userId"), false);
      assert.equal(firstUser.lastTool, "Rectangle");
      assert.equal(secondUser.lastTool, "Hand");
    },
  );
});

test("report_user logs reporter and reported user details for active board members", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-report-"),
  );
  await withEnv(
    {
      WBO_IP_SOURCE: "remoteAddress",
      WBO_HISTORY_DIR: historyDir,
      WBO_SILENT: "true",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const reporter = createSocket({
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
      await sockets.__test.handleSocketConnection(reporter.socket);
      const reporterEmitCountBeforeReport = reporter.emitted.length;

      const reported = createSocket({
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
      await sockets.__test.handleSocketConnection(reported.socket);
      const reportedEmitCountBeforeReport = reported.emitted.length;

      getRequiredHandler(
        reporter.handlers,
        "report_user",
      )({
        socketId: "socket-reported",
      });

      const reportedLog = sockets.__test.getLastUserReportLog();
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
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-users-report-header-"),
  );
  await withEnv(
    {
      WBO_IP_SOURCE: "CF-Connecting-IP",
      WBO_HISTORY_DIR: historyDir,
      WBO_SILENT: "true",
    },
    async () => {
      const sockets = await loadSockets();
      sockets.__test.resetRateLimitMaps();

      const reporter = createSocket({
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
      await sockets.__test.handleSocketConnection(reporter.socket);

      const reported = createSocket({
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
      await sockets.__test.handleSocketConnection(reported.socket);

      getRequiredHandler(
        reporter.handlers,
        "report_user",
      )({
        socketId: "socket-reported-header",
      });

      const reportedLog = sockets.__test.getLastUserReportLog();
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
