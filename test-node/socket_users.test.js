const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const jsonwebtoken = require("jsonwebtoken");

const {
  createConfig,
  createSocketScenario,
  createSocket,
  SOCKETS_PATH,
} = require("./test_helpers.js");
const { MutationType } = require("../client-data/js/mutation_type.js");
const {
  Cursor,
  Eraser,
  Hand,
  Pencil,
  Rectangle,
} = require("../client-data/tools/index.js");
const USER_SECRET_COOKIE_NAME = "wbo-user-secret-v1";

require(SOCKETS_PATH);

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
 * @param {any} payload
 * @returns {boolean}
 */
function isReplayBatch(payload) {
  return (
    payload &&
    payload.type === MutationType.BATCH &&
    Array.isArray(payload._children) &&
    typeof payload.fromSeq === "number" &&
    typeof payload.seq === "number"
  );
}

/**
 * @param {{emitted: Array<{event: string, payload: any}>}} created
 * @returns {Array<{event: string, payload: any}>}
 */
function replayBatchEvents(created) {
  return created.emitted.filter(
    (event) => event.event === "broadcast" && isReplayBatch(event.payload),
  );
}

/**
 * @param {{emitted: Array<{event: string, payload: any}>}} created
 * @returns {Array<{event: string, payload: any}>}
 */
function liveBroadcastEvents(created) {
  return created.emitted.filter(
    (event) => event.event === "broadcast" && !isReplayBatch(event.payload),
  );
}

/**
 * @param {any} message
 * @returns {any}
 */
function withoutSocket(message) {
  const { socket, ...rest } = message;
  void socket;
  return rest;
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

test("connection replay and live broadcasts carry contiguous seq for deterministic client replay", async () => {
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
        liveBroadcastEvents(created)[0],
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

      const replayEvents = replayBatchEvents(getRequiredValue(nextSocket));
      assert.equal(replayEvents.length, 1);
      assert.deepEqual(getRequiredValue(replayEvents[0]).payload, {
        type: MutationType.BATCH,
        fromSeq: 0,
        seq: 1,
        _children: [withoutSocket(liveBroadcast.mutation)],
      });
    },
  );
});

test("connection-replay clients bootstrap with an explicit empty replay batch", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-bootstrap-" },
    async ({ connect }) => {
      const created = await connect({
        id: "socket-seq-empty",
        remoteAddress: "203.0.113.80",
        headers: withUserSecretCookie("55555555555555555555555555555555"),
        query: {
          board: "board-seq-empty",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });

      const replayEvents = created.emitted.filter((event) =>
        ["boardstate", "broadcast"].includes(event.event),
      );
      assert.deepEqual(
        replayEvents.map((event) => event.event),
        ["boardstate", "broadcast"],
      );
      assert.deepEqual(getRequiredValue(replayEvents[1]).payload, {
        type: MutationType.BATCH,
        fromSeq: 0,
        seq: 0,
        _children: [],
      });
    },
  );
});

test("socket boardstate uses the same capability-shaped state as rendered board pages", async () => {
  const authSecret = "test-secret";
  const token = jsonwebtoken.sign(
    { sub: "moderator", roles: ["moderator:socket-capability"] },
    authSecret,
  );

  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-capability-boardstate-",
      config: { AUTH_SECRET_KEY: authSecret },
    },
    async ({ connect }) => {
      const created = await connect({
        id: "socket-capability",
        remoteAddress: "203.0.113.80",
        headers: withUserSecretCookie("55555555555555555555555555555556"),
        token,
        query: {
          board: "socket-capability",
          tool: "rectangle",
          color: "#333333",
          size: "4",
        },
      });

      const boardStateEvent = created.emitted.find(
        (event) => event.event === "boardstate",
      );
      assert.deepEqual(getRequiredValue(boardStateEvent).payload, {
        readonly: false,
        canEdit: true,
        canClear: true,
        canWrite: true,
      });
    },
  );
});

test("presence payloads expose canEdit/canClear for sidebar status", async () => {
  const moderatorSecret = "dddddddddddddddddddddddddddddddd";
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-presence-caps-",
      config: {
        BOARD_MODERATORS: new Map([["caps-board", new Set([moderatorSecret])]]),
      },
    },
    async ({ connect }) => {
      await connect({
        id: "socket-caps-mod",
        remoteAddress: "203.0.113.90",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: "caps-board", tool: "hand" },
      });
      const viewer = await connect({
        id: "socket-caps-viewer",
        remoteAddress: "203.0.113.91",
        headers: withUserSecretCookie("99999999999999999999999999999999"),
        query: { board: "caps-board", tool: "hand" },
      });

      const joined = viewer.emitted.filter(
        (event) => event.event === "user_joined",
      );
      const moderatorPayload = getRequiredValue(
        joined.find((event) => event.payload.socketId === "socket-caps-mod"),
      ).payload;
      const viewerPayload = getRequiredValue(
        joined.find((event) => event.payload.socketId === "socket-caps-viewer"),
      ).payload;

      assert.equal(moderatorPayload.canEdit, true);
      assert.equal(moderatorPayload.canClear, true);
      assert.equal(viewerPayload.canEdit, true);
      assert.equal(viewerPayload.canClear, false);
      assert.deepEqual(moderatorPayload.position, { x: 0, y: 0 });
      assert.deepEqual(viewerPayload.position, { x: 0, y: 0 });
    },
  );
});

test("report_user ignores canClear targets without disconnecting the moderator", async () => {
  const moderatorSecret = "fdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfd";
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-protected-",
      config: {
        BOARD_MODERATORS: new Map([
          ["report-protected-board", new Set([moderatorSecret])],
        ]),
      },
    },
    async ({ connect, handler, test }) => {
      const reporter = await connect({
        id: "socket-report-protected-reporter",
        remoteAddress: "203.0.113.92",
        headers: withUserSecretCookie("88888888888888888888888888888888"),
        query: { board: "report-protected-board", tool: "hand" },
      });
      const moderator = await connect({
        id: "socket-report-protected-mod",
        remoteAddress: "203.0.113.93",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: "report-protected-board", tool: "hand" },
      });

      handler(
        reporter,
        "report_user",
      )({
        socketId: "socket-report-protected-mod",
      });

      assert.equal(reporter.socket.client.conn.closeCalls.length, 1);
      assert.equal(moderator.socket.client.conn.closeCalls.length, 0);
      assert.equal(test.getLastUserReportLog(), null);
    },
  );
});

test("presence reflects JWT moderator role, not just configured moderators", async () => {
  const authSecret = "test-secret";
  const moderatorToken = jsonwebtoken.sign(
    { sub: "mod", roles: ["moderator:jwt-caps-board"] },
    authSecret,
  );
  const editorToken = jsonwebtoken.sign(
    { sub: "ed", roles: ["editor:jwt-caps-board"] },
    authSecret,
  );

  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-presence-jwt-mod-",
      config: { AUTH_SECRET_KEY: authSecret },
    },
    async ({ connect }) => {
      await connect({
        id: "socket-jwt-mod",
        remoteAddress: "203.0.113.92",
        headers: withUserSecretCookie("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"),
        token: moderatorToken,
        query: { board: "jwt-caps-board", tool: "hand" },
      });
      const viewer = await connect({
        id: "socket-jwt-viewer",
        remoteAddress: "203.0.113.93",
        headers: withUserSecretCookie("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"),
        token: editorToken,
        query: { board: "jwt-caps-board", tool: "hand" },
      });

      const moderatorPayload = getRequiredValue(
        viewer.emitted
          .filter((event) => event.event === "user_joined")
          .find((event) => event.payload.socketId === "socket-jwt-mod"),
      ).payload;
      assert.equal(moderatorPayload.canClear, true);
      assert.equal(moderatorPayload.canEdit, true);
    },
  );
});

test("a banned user reconnects read-only in their own boardstate and in presence", async () => {
  const moderatorSecret = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const targetSecret = "ffffffffffffffffffffffffffffffff";
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-banned-readonly-",
      config: {
        BOARD_MODERATORS: new Map([
          ["ban-readonly-board", new Set([moderatorSecret])],
        ]),
      },
    },
    async ({ connect, handler }) => {
      const moderator = await connect({
        id: "socket-ban-mod",
        remoteAddress: "203.0.113.94",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: "ban-readonly-board", tool: "hand" },
      });
      await connect({
        id: "socket-ban-target",
        remoteAddress: "203.0.113.95",
        headers: withUserSecretCookie(targetSecret),
        query: { board: "ban-readonly-board", tool: "hand" },
      });

      handler(moderator, "report_user")({ socketId: "socket-ban-target" });

      // The banned user reconnects (same secret + ip): now read-only everywhere.
      const reconnected = await connect({
        id: "socket-ban-target-2",
        remoteAddress: "203.0.113.95",
        headers: withUserSecretCookie(targetSecret),
        query: { board: "ban-readonly-board", tool: "hand" },
      });

      // Own boardstate hides editing tools.
      assert.equal(
        getRequiredValue(
          reconnected.emitted.find((event) => event.event === "boardstate"),
        ).payload.canEdit,
        false,
      );
      // Own presence row.
      assert.equal(
        getRequiredValue(
          reconnected.emitted
            .filter((event) => event.event === "user_joined")
            .find((event) => event.payload.socketId === "socket-ban-target-2"),
        ).payload.canEdit,
        false,
      );
      // What other users on the board receive.
      assert.equal(
        getRequiredValue(
          reconnected.broadcasted.find(
            (event) =>
              event.event === "user_joined" &&
              event.payload.socketId === "socket-ban-target-2",
          ),
        ).payload.canEdit,
        false,
      );

      // The moderator stays fully capable.
      const moderatorPayload = getRequiredValue(
        moderator.emitted
          .filter((event) => event.event === "user_joined")
          .find((event) => event.payload.socketId === "socket-ban-mod"),
      ).payload;
      assert.equal(moderatorPayload.canEdit, true);
      assert.equal(moderatorPayload.canClear, true);
    },
  );
});

test("connection replay records outcome metrics with signed seq gap inputs", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-connection-replay-metrics-" },
    async ({ connect, getLoadedBoard, invoke }) => {
      const observability = await import("../server/observability/index.mjs");
      const originalRecordSocketConnectionReplay =
        observability.metrics.recordSocketConnectionReplay;
      /** @type {any[]} */
      const recorded = [];
      observability.metrics.recordSocketConnectionReplay = (sample) => {
        recorded.push(sample);
      };

      try {
        const writer = await connect({
          id: "socket-connection-replay-metrics-writer",
          remoteAddress: "203.0.113.92",
          headers: withUserSecretCookie("99999999999999999999999999999989"),
          query: {
            board: "board-connection-replay-metrics",
            tool: "rectangle",
            color: "#666666",
            size: "4",
          },
        });
        await invoke(
          writer,
          "broadcast",
          rectangleCreate({
            id: "rect-replay-metrics-1",
            x: 0,
            y: 0,
            x2: 10,
            y2: 10,
            color: "#666666",
            size: 4,
          }),
        );

        await connect({
          id: "socket-connection-replay-metrics-replay",
          remoteAddress: "203.0.113.93",
          headers: withUserSecretCookie("99999999999999999999999999999988"),
          query: {
            board: "board-connection-replay-metrics",
            tool: "hand",
            color: "#777777",
            size: "4",
          },
        });

        const loadedBoard = await getLoadedBoard(
          "board-connection-replay-metrics",
        );
        loadedBoard.trimMutationLogBefore(2);

        const stale = await connect({
          id: "socket-connection-replay-metrics-stale",
          remoteAddress: "203.0.113.94",
          headers: withUserSecretCookie("99999999999999999999999999999987"),
          query: {
            board: "board-connection-replay-metrics",
            baselineSeq: "0",
            tool: "hand",
            color: "#777777",
            size: "4",
          },
        });
        assert.equal(stale.socket.disconnected, true);

        const future = await connect({
          id: "socket-connection-replay-metrics-future",
          remoteAddress: "203.0.113.95",
          headers: withUserSecretCookie("99999999999999999999999999999986"),
          query: {
            board: "board-connection-replay-metrics",
            baselineSeq: "9",
            tool: "hand",
            color: "#777777",
            size: "4",
          },
        });
        assert.equal(future.socket.disconnected, true);

        loadedBoard.readMutationsAfter = () => {
          throw new Error("forced connection replay failure");
        };
        const failing = await connect({
          id: "socket-connection-replay-metrics-error",
          remoteAddress: "203.0.113.96",
          headers: withUserSecretCookie("99999999999999999999999999999985"),
          query: {
            board: "board-connection-replay-metrics",
            baselineSeq: "1",
            tool: "hand",
            color: "#777777",
            size: "4",
          },
        });
        assert.equal(failing.socket.disconnected, true);

        assert.deepEqual(
          recorded.map((sample) => sample.outcome),
          [
            "empty",
            "replayed",
            "baseline_not_replayable",
            "future_baseline",
            "error",
          ],
        );
        assert.deepEqual(
          recorded.map(({ baselineSeq, latestSeq, outcome }) => ({
            baselineSeq,
            latestSeq,
            outcome,
          })),
          [
            {
              baselineSeq: 0,
              latestSeq: 0,
              outcome: "empty",
            },
            {
              baselineSeq: 0,
              latestSeq: 1,
              outcome: "replayed",
            },
            {
              baselineSeq: 0,
              latestSeq: 1,
              outcome: "baseline_not_replayable",
            },
            {
              baselineSeq: 9,
              latestSeq: 1,
              outcome: "future_baseline",
            },
            {
              baselineSeq: 1,
              latestSeq: 1,
              outcome: "error",
            },
          ],
        );
      } finally {
        observability.metrics.recordSocketConnectionReplay =
          originalRecordSocketConnectionReplay;
      }
    },
  );
});

test("connection-replay clients receive contiguous replay entries and can replay them on reconnect", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-replay-" },
    async ({ connect, handler }) => {
      const writer = await connect({
        id: "socket-seq-writer",
        remoteAddress: "203.0.113.81",
        headers: withUserSecretCookie("66666666666666666666666666666666"),
        query: {
          board: "board-seq-live",
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

      const acceptedBroadcast = getRequiredValue(
        liveBroadcastEvents(writer)[0],
      ).payload;
      assert.equal(acceptedBroadcast.seq, 1);
      assert.equal(acceptedBroadcast.mutation.id, "rect-1");

      const reconnect = await connect({
        id: "socket-seq-reconnect",
        remoteAddress: "203.0.113.82",
        headers: withUserSecretCookie("77777777777777777777777777777777"),
        query: {
          board: "board-seq-live",
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        ["boardstate", "broadcast"].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "broadcast"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[1]).payload, {
        type: MutationType.BATCH,
        fromSeq: 0,
        seq: 1,
        _children: [withoutSocket(acceptedBroadcast.mutation)],
      });
    },
  );
});

test("connection-replay clients with a stale cached baseline replay only newer contiguous entries", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-stale-baseline-" },
    async ({ connect, handler }) => {
      const writer = await connect({
        id: "socket-seq-stale-writer",
        remoteAddress: "203.0.113.85",
        headers: withUserSecretCookie("99999999999999999999999999999995"),
        query: {
          board: "board-seq-stale",
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
          baselineSeq: "1",
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        ["boardstate", "broadcast"].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "broadcast"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[1]).payload, {
        type: MutationType.BATCH,
        fromSeq: 1,
        seq: 2,
        _children: [
          {
            tool: Rectangle.id,
            type: MutationType.CREATE,
            id: "rect-2",
            x: 20,
            y: 20,
            x2: 30,
            y2: 30,
            color: "#555555",
            size: 10,
          },
        ],
      });
    },
  );
});

test("connection replay stays correct when persistence finishes between baseline fetch and replay start", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-persist-race-" },
    async ({ connect, handler, getLoadedBoard }) => {
      const writer = await connect({
        id: "socket-seq-race-writer",
        remoteAddress: "203.0.113.92",
        headers: withUserSecretCookie("99999999999999999999999999999992"),
        query: {
          board: "board-seq-race",
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
          baselineSeq: "1",
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        ["boardstate", "broadcast"].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "broadcast"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[1]).payload, {
        type: MutationType.BATCH,
        fromSeq: 1,
        seq: 2,
        _children: [
          {
            tool: Rectangle.id,
            type: MutationType.CREATE,
            id: "rect-2",
            x: 20,
            y: 20,
            x2: 30,
            y2: 30,
            color: "#555555",
            size: 10,
          },
        ],
      });
    },
  );
});

test("connection-replay sockets receive live persistent broadcasts after connection replay", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-live-gated-" },
    async ({ connect, handler }) => {
      const writer = await connect({
        id: "socket-seq-gated-writer",
        remoteAddress: "203.0.113.185",
        headers: withUserSecretCookie("99999999999999999999999999999185"),
        query: {
          board: "board-seq-live-gated",
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
          tool: "hand",
          color: "#555555",
          size: "4",
        },
      });

      const broadcast = handler(writer, "broadcast");
      assert.deepEqual(getRequiredValue(replayBatchEvents(peer)[0]).payload, {
        type: MutationType.BATCH,
        fromSeq: 0,
        seq: 0,
        _children: [],
      });

      await broadcast(
        rectangleCreate({
          id: "rect-before-replay",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 4,
        }),
      );

      assert.equal(
        getRequiredValue(liveBroadcastEvents(peer)[0]).payload.seq,
        1,
      );

      await broadcast(
        rectangleCreate({
          id: "rect-after-replay",
          x: 20,
          y: 20,
          x2: 30,
          y2: 30,
          color: "#555555",
          size: 4,
        }),
      );

      const liveBroadcasts = liveBroadcastEvents(peer);
      assert.equal(liveBroadcasts.length, 2);
      assert.equal(getRequiredValue(liveBroadcasts[1]).payload.seq, 2);
    },
  );
});

test("connection replay gaps reject connections when the requested baseline is no longer replayable", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-gap-replay-reject-" },
    async ({ connect, getLoadedBoard, handler, sockets }) => {
      const writer = await connect({
        id: "socket-seq-gap-writer",
        remoteAddress: "203.0.113.87",
        headers: withUserSecretCookie("99999999999999999999999999999993"),
        query: {
          board: "board-seq-gap",
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
          baselineSeq: "0",
          tool: "hand",
          color: "#777777",
          size: "4",
        },
      });
      assert.equal(reconnect.socket.disconnected, true);

      const replay = await sockets.__test.prepareConnectionReplay(
        reconnect.socket,
        sockets.__config,
      );
      assert.deepEqual(
        {
          ok: replay.ok,
          reason: replay.reason,
          baselineSeq: replay.baselineSeq,
          latestSeq: replay.latestSeq,
          minReplayableSeq: replay.minReplayableSeq,
        },
        {
          ok: false,
          reason: "baseline_not_replayable",
          baselineSeq: 0,
          latestSeq: 2,
          minReplayableSeq: 1,
        },
      );
    },
  );
});

test("connection replay baseline rejection does not join the stale socket to board users", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-gap-replay-reject-log-" },
    async ({ connect, getLoadedBoard, invoke, sockets }) => {
      const writer = await connect({
        id: "socket-seq-gap-log-writer",
        remoteAddress: "203.0.113.90",
        headers: withUserSecretCookie("99999999999999999999999999999990"),
        query: {
          board: "board-seq-gap-log",
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
      loadedBoard.trimMutationLogBefore(2);

      const reconnectSecret = "99999999999999999999999999999991";
      const reconnect = await connect({
        id: "socket-seq-gap-log-reconnect",
        remoteAddress: "203.0.113.91",
        headers: withUserSecretCookie(reconnectSecret),
        query: {
          board: "board-seq-gap-log",
          baselineSeq: "0",
          tool: "hand",
          color: "#777777",
          size: "4",
        },
      });

      assert.equal(reconnect.socket.disconnected, true);
      assert.deepEqual(
        sockets.__test.boardUserDebugFields(
          "board-seq-gap-log",
          "socket-seq-gap-log-reconnect",
        ),
        {},
      );
    },
  );
});

test("persistent writes fan out as sequenced mutation broadcasts to every peer", async () => {
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

      const seqPeerBroadcasts = liveBroadcastEvents(seqPeer);
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
        "board" in getRequiredValue(seqPeerBroadcasts[0]).payload,
        false,
      );
      assert.equal(
        "clientMutationId" in getRequiredValue(seqPeerBroadcasts[0]).payload,
        false,
      );
      assert.equal(
        "socketId" in getRequiredValue(seqPeerBroadcasts[0]).payload,
        false,
      );
      assert.equal(
        "revision" in getRequiredValue(seqPeerBroadcasts[0]).payload,
        false,
      );

      const defaultPeerBroadcasts = liveBroadcastEvents(defaultPeer);
      assert.equal(defaultPeerBroadcasts.length, 1);
      assert.deepEqual(
        getRequiredValue(defaultPeerBroadcasts[0]).payload,
        getRequiredValue(seqPeerBroadcasts[0]).payload,
      );
    },
  );
});

test("connection-replay cursor updates stay ephemeral and are not replayed", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-seq-cursor-" },
    async ({ connect, invoke }) => {
      const writer = await connect({
        id: "socket-seq-cursor-writer",
        remoteAddress: "203.0.113.83",
        headers: withUserSecretCookie("88888888888888888888888888888888"),
        query: {
          board: "board-seq-cursor",
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
      assert.equal(liveBroadcastEvents(writer).length, 0);

      const reconnect = await connect({
        id: "socket-seq-cursor-reconnect",
        remoteAddress: "203.0.113.84",
        headers: withUserSecretCookie("99999999999999999999999999999998"),
        query: {
          board: "board-seq-cursor",
          tool: "hand",
          color: "#777777",
          size: "4",
        },
      });

      const replayedEvents = reconnect.emitted.filter((event) =>
        ["boardstate", "broadcast"].includes(event.event),
      );
      assert.deepEqual(
        replayedEvents.map((event) => event.event),
        ["boardstate", "broadcast"],
      );
      assert.deepEqual(getRequiredValue(replayedEvents[1]).payload, {
        type: MutationType.BATCH,
        fromSeq: 0,
        seq: 0,
        _children: [],
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
      assert.equal(liveBroadcastEvents(writer).length, 0);
    },
  );
});

test("canClear users bypass the socket batch child-count limit", async () => {
  const moderatorSecret = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-can-clear-large-batch-",
      config: {
        MAX_CHILDREN: 1,
        BOARD_MODERATORS: new Map([
          ["large-selection-board", new Set([moderatorSecret])],
        ]),
      },
    },
    async ({ connect, invoke }) => {
      const moderator = await connect({
        id: "socket-large-batch-mod",
        remoteAddress: "203.0.113.96",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: "large-selection-board", tool: "hand" },
      });
      await invoke(
        moderator,
        "broadcast",
        rectangleCreate({
          id: "rect-large-1",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 10,
        }),
      );
      await invoke(
        moderator,
        "broadcast",
        rectangleCreate({
          id: "rect-large-2",
          x: 20,
          y: 0,
          x2: 30,
          y2: 10,
          color: "#444444",
          size: 10,
        }),
      );

      const normal = await connect({
        id: "socket-large-batch-normal",
        remoteAddress: "203.0.113.97",
        headers: withUserSecretCookie("ffffffffffffffffffffffffffffffff"),
        query: { board: "large-selection-board", tool: "hand" },
      });
      await invoke(normal, "broadcast", {
        tool: Hand.id,
        clientMutationId: "cm-normal-large-batch",
        _children: [
          {
            type: MutationType.UPDATE,
            id: "rect-large-1",
            transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 0 },
          },
          {
            type: MutationType.UPDATE,
            id: "rect-large-2",
            transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 0 },
          },
        ],
      });
      assert.deepEqual(
        getRequiredValue(
          normal.emitted.find((event) => event.event === "mutation_rejected"),
        ).payload,
        {
          clientMutationId: "cm-normal-large-batch",
          reason: "too many children",
        },
      );

      await invoke(moderator, "broadcast", {
        tool: Hand.id,
        clientMutationId: "cm-mod-large-batch",
        _children: [
          {
            type: MutationType.UPDATE,
            id: "rect-large-1",
            transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 },
          },
          {
            type: MutationType.UPDATE,
            id: "rect-large-2",
            transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 },
          },
        ],
      });

      assert.equal(
        moderator.emitted.some((event) => event.event === "mutation_rejected"),
        false,
      );
      assert.equal(
        liveBroadcastEvents(moderator).some(
          (event) =>
            event.payload.mutation?.clientMutationId === "cm-mod-large-batch" &&
            event.payload.mutation?._children?.length === 2,
        ),
        true,
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

      const seqBroadcasts = liveBroadcastEvents(writer);
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

      const seqBroadcasts = liveBroadcastEvents(writer);
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
      const svgBoardStore = require("../server/persistence/svg_board_store.mjs");
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
      const sequencedBroadcast = getRequiredValue(
        liveBroadcastEvents(created)[0],
      ).payload;
      assert.equal(sequencedBroadcast.mutation.socket, "socket-live");
      assert.equal("userId" in sequencedBroadcast.mutation, false);
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
      assert.deepEqual(user.position, { x: 9, y: 10 });
      let cursorBroadcast;
      for (let index = created.broadcasted.length - 1; index >= 0; index--) {
        const event = created.broadcasted[index];
        if (!event) continue;
        if (event.event === "broadcast") {
          cursorBroadcast = event;
          break;
        }
      }
      cursorBroadcast = getRequiredValue(cursorBroadcast);
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

      const liveBroadcast = getRequiredValue(liveBroadcastEvents(second)[0]);
      const payload = liveBroadcast.payload.mutation;
      assert.equal(payload.socket, "socket-a");
      assert.equal("userId" in payload, false);
      assert.equal(firstUser.lastTool, "rectangle");
      assert.equal(secondUser.lastTool, "hand");
    },
  );
});

test("report_user logs reporter and reported user details for active board members", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-",
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

test("report_user notifies connected moderators about reporter and reported users", async () => {
  const moderatorSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-moderator-notice-",
      config: {
        BOARD_MODERATORS: new Map([
          ["board-report-moderator-notice", new Set([moderatorSecret])],
        ]),
      },
    },
    async ({ connect, handler, sockets }) => {
      const moderator = await connect({
        id: "socket-report-notice-mod",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: "board-report-moderator-notice", tool: "hand" },
      });
      const reporter = await connect({
        id: "socket-report-notice-reporter",
        remoteAddress: "203.0.113.92",
        query: { board: "board-report-moderator-notice", tool: "hand" },
      });
      const reported = await connect({
        id: "socket-report-notice-reported",
        remoteAddress: "203.0.113.93",
        query: { board: "board-report-moderator-notice", tool: "hand" },
      });

      handler(
        reporter,
        "report_user",
      )({
        socketId: "socket-report-notice-reported",
      });

      const reportLog = getRequiredValue(sockets.__test.getLastUserReportLog());
      const notice = moderator.emitted.find(
        (event) => event.event === "user_reported",
      );
      assert.deepEqual(notice?.payload, {
        reporterName: reportLog.reporter_name,
        reportedName: reportLog.reported_name,
      });
      assert.equal(
        reporter.emitted.some((event) => event.event === "user_reported"),
        false,
      );
      assert.equal(
        reported.emitted.some((event) => event.event === "user_reported"),
        false,
      );
    },
  );
});

test("report_user respects custom header ip sources for active board members", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-header-",
      config: { IP_SOURCE: "CF-Connecting-IP" },
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
        query: { board: "stale-save-drop", baselineSeq: "99" },
      });

      const reloadedBoard = await getLoadedBoard("stale-save-drop");
      assert.notEqual(reloadedBoard, board);
      assert.deepEqual(Object.keys(reloadedBoard.board), ["rect-1"]);

      handler(reconnect, "disconnecting")("transport close");
    },
  );
});

test("future baseline rejection does not reload when stored seq is not ahead", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-future-baseline-no-reload-",
      boardName: "future-baseline-no-reload",
    },
    async ({ connect, invoke, getLoadedBoard }) => {
      const writer = await connect({
        id: "socket-future-no-reload-writer",
        query: { board: "future-baseline-no-reload" },
      });

      await invoke(
        writer,
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

      const board = await getLoadedBoard("future-baseline-no-reload");
      assert.deepEqual(await board.save(), { status: "saved" });

      const firstFuture = await connect({
        id: "socket-future-no-reload-first",
        query: { board: "future-baseline-no-reload", baselineSeq: "99" },
      });
      assert.equal(firstFuture.socket.disconnected, true);
      assert.equal(await getLoadedBoard("future-baseline-no-reload"), board);

      const secondFuture = await connect({
        id: "socket-future-no-reload-second",
        query: { board: "future-baseline-no-reload", baselineSeq: "99" },
      });
      assert.equal(secondFuture.socket.disconnected, true);
      assert.equal(await getLoadedBoard("future-baseline-no-reload"), board);
    },
  );
});

test("future baseline reloads stale board when stored seq is ahead", async () => {
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-future-baseline-reload-",
      boardName: "future-baseline-reload",
    },
    async ({ historyDir, connect, invoke, handler, getLoadedBoard }) => {
      const first = await connect({
        id: "socket-future-reload-first",
        query: { board: "future-baseline-reload" },
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

      const board = await getLoadedBoard("future-baseline-reload");
      assert.deepEqual(await board.save(), { status: "saved" });

      const svgPath = path.join(
        /** @type {string} */ (historyDir),
        "board-future-baseline-reload.svg",
      );
      const persistedSvg = await fs.readFile(svgPath, "utf8");
      await fs.writeFile(
        svgPath,
        persistedSvg.replace('data-wbo-seq="1"', 'data-wbo-seq="3"'),
        "utf8",
      );

      const reconnect = await connect({
        id: "socket-future-reload-reconnect",
        query: { board: "future-baseline-reload", baselineSeq: "3" },
      });

      const reloadedBoard = await getLoadedBoard("future-baseline-reload");
      assert.notEqual(reconnect.socket.disconnected, true);
      assert.equal(first.socket.disconnected, true);
      assert.equal(board.disposed, true);
      assert.notEqual(reloadedBoard, board);
      assert.equal(reloadedBoard.getSeq(), 3);

      handler(reconnect, "disconnecting")("transport close");
    },
  );
});

test("moderator report bans reported secret and ip without disconnecting moderator", async () => {
  const moderatorSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const targetSecret = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-ban-",
      config: {
        BOARD_MODERATORS: new Map([
          ["board-report-ban", new Set([moderatorSecret])],
        ]),
      },
    },
    async ({ connect, handler, invoke }) => {
      const moderator = await connect({
        id: "socket-mod-report",
        remoteAddress: "203.0.113.150",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: "board-report-ban", tool: "hand" },
      });
      const target = await connect({
        id: "socket-target-report",
        remoteAddress: "203.0.113.151",
        headers: withUserSecretCookie(targetSecret),
        query: { board: "board-report-ban", tool: "hand" },
      });

      handler(moderator, "report_user")({ socketId: "socket-target-report" });

      assert.equal(target.socket.client.conn.closeCalls.length, 1);
      assert.equal(moderator.socket.client.conn.closeCalls.length, 0);

      const sameIp = await connect({
        id: "socket-target-same-ip",
        remoteAddress: "203.0.113.151",
        headers: withUserSecretCookie("cccccccccccccccccccccccccccccccc"),
        query: { board: "board-report-ban", tool: "hand" },
      });
      await invoke(
        sameIp,
        "broadcast",
        rectangleCreate({
          id: "rect-ip-ban",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 10,
          clientMutationId: "cm-ip-ban",
        }),
      );
      assert.deepEqual(
        getRequiredValue(
          sameIp.emitted.find((event) => event.event === "mutation_rejected"),
        ).payload,
        { clientMutationId: "cm-ip-ban", reason: "write_blocked" },
      );

      const sameSecret = await connect({
        id: "socket-target-same-secret",
        remoteAddress: "203.0.113.152",
        headers: withUserSecretCookie(targetSecret),
        query: { board: "board-report-ban", tool: "hand" },
      });
      await invoke(
        sameSecret,
        "broadcast",
        rectangleCreate({
          id: "rect-secret-ban",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 10,
          clientMutationId: "cm-secret-ban",
        }),
      );
      assert.deepEqual(
        getRequiredValue(
          sameSecret.emitted.find(
            (event) => event.event === "mutation_rejected",
          ),
        ).payload,
        { clientMutationId: "cm-secret-ban", reason: "write_blocked" },
      );

      await invoke(
        moderator,
        "broadcast",
        rectangleCreate({
          id: "rect-mod-ok",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 10,
          clientMutationId: "cm-mod-ok",
        }),
      );
      assert.equal(
        moderator.emitted.some((event) => event.event === "mutation_rejected"),
        false,
      );
    },
  );
});

test("moderator report uses requested ban duration", async () => {
  const moderatorSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad";
  const targetSecret = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd";
  const boardName = "board-report-duration";
  const now = 1000;
  const banDurationMs = 2 * 60 * 60 * 1000;
  const reports = require(
    path.join(__dirname, "..", "server", "socket", "reports.mjs"),
  );
  const bans = require(
    path.join(__dirname, "..", "server", "socket", "bans.mjs"),
  );

  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-ban-duration-",
      config: {
        BOARD_MODERATORS: new Map([[boardName, new Set([moderatorSecret])]]),
      },
    },
    async ({ connect, sockets }) => {
      const moderator = await connect({
        id: "socket-mod-report-duration",
        remoteAddress: "203.0.113.180",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: boardName, tool: "hand" },
      });
      const target = await connect({
        id: "socket-target-report-duration",
        remoteAddress: "203.0.113.181",
        headers: withUserSecretCookie(targetSecret),
        query: { board: boardName, tool: "hand" },
      });

      reports.handleReportUserMessage({
        socket: moderator.socket,
        boardName,
        message: {
          socketId: "socket-target-report-duration",
          banDurationMs,
        },
        config: sockets.__config,
        now,
        /** @param {string} socketId */
        getActiveSocket(socketId) {
          if (socketId === moderator.socket.id) return moderator.socket;
          if (socketId === target.socket.id) return target.socket;
          return undefined;
        },
        /** @param {any} socket */
        closeSocket(socket) {
          socket.client.conn.close.call(socket.client.conn);
        },
      });

      assert.equal(target.socket.client.conn.closeCalls.length, 1);
      assert.equal(
        bans.isEditBanned(
          boardName,
          targetSecret,
          "203.0.113.181",
          now + banDurationMs - 1,
        ),
        true,
      );
      assert.equal(
        bans.isEditBanned(
          boardName,
          targetSecret,
          "203.0.113.181",
          now + banDurationMs,
        ),
        false,
      );
    },
  );
});

test("moderator report ignores self targets without banning", async () => {
  const moderatorSecret = "abababababababababababababababab";
  await createSocketScenario(
    {
      historyDirPrefix: "wbo-users-report-self-ban-",
      config: {
        BOARD_MODERATORS: new Map([
          ["board-report-self-ban", new Set([moderatorSecret])],
        ]),
      },
    },
    async ({ connect, handler, invoke }) => {
      const moderator = await connect({
        id: "socket-mod-self-report",
        remoteAddress: "203.0.113.170",
        headers: withUserSecretCookie(moderatorSecret),
        query: { board: "board-report-self-ban", tool: "hand" },
      });

      handler(moderator, "report_user")({ socketId: "socket-mod-self-report" });

      assert.equal(moderator.socket.client.conn.closeCalls.length, 0);

      await invoke(
        moderator,
        "broadcast",
        rectangleCreate({
          id: "rect-self-report-ok",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 10,
          clientMutationId: "cm-self-report-ok",
        }),
      );
      assert.equal(
        moderator.emitted.some((event) => event.event === "mutation_rejected"),
        false,
      );
    },
  );
});

test("non-moderator report disconnects both users without banning", async () => {
  await createSocketScenario(
    { historyDirPrefix: "wbo-users-report-no-ban-" },
    async ({ connect, handler, invoke }) => {
      const reporter = await connect({
        id: "socket-nonmod-report",
        remoteAddress: "203.0.113.160",
        headers: withUserSecretCookie("dddddddddddddddddddddddddddddddd"),
        query: { board: "board-report-no-ban", tool: "hand" },
      });
      const target = await connect({
        id: "socket-nonmod-target",
        remoteAddress: "203.0.113.161",
        headers: withUserSecretCookie("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
        query: { board: "board-report-no-ban", tool: "hand" },
      });

      handler(reporter, "report_user")({ socketId: "socket-nonmod-target" });

      assert.equal(reporter.socket.client.conn.closeCalls.length, 1);
      assert.equal(target.socket.client.conn.closeCalls.length, 1);

      const fresh = await connect({
        id: "socket-nonmod-fresh",
        remoteAddress: "203.0.113.161",
        headers: withUserSecretCookie("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
        query: { board: "board-report-no-ban", tool: "hand" },
      });
      await invoke(
        fresh,
        "broadcast",
        rectangleCreate({
          id: "rect-no-ban",
          x: 0,
          y: 0,
          x2: 10,
          y2: 10,
          color: "#444444",
          size: 10,
          clientMutationId: "cm-no-ban",
        }),
      );
      assert.equal(
        fresh.emitted.some((event) => event.event === "mutation_rejected"),
        false,
      );
    },
  );
});
