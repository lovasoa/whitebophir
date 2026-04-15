const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createSocket, loadSockets, withEnv } = require("./test_helpers.js");

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

test("user id and visible name are deterministic from userSecret and ip", async () => {
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async () => {
    const sockets = await loadSockets();
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

test("board user record seeds tool color and size from socket query", async () => {
  await withEnv({ WBO_IP_SOURCE: "remoteAddress" }, async () => {
    const sockets = await loadSockets();
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
        query: {
          userSecret: "first-secret",
          tool: "Hand",
          color: "#111111",
          size: "6",
        },
      });
      sockets.__test.handleSocketConnection(first.socket);
      await getRequiredHandler(first.handlers, "getboard")("board-a");

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
        query: {
          userSecret: "second-secret",
          tool: "Rectangle",
          color: "#222222",
          size: "8",
        },
      });
      sockets.__test.handleSocketConnection(second.socket);
      await getRequiredHandler(second.handlers, "getboard")("board-a");

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
        query: {
          userSecret: "revision-secret",
          tool: "Rectangle",
          color: "#333333",
          size: "4",
        },
      });
      sockets.__test.handleSocketConnection(created.socket);
      await getRequiredHandler(created.handlers, "getboard")("board-revision");

      const initialSnapshot = getRequiredValue(
        created.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(initialSnapshot.revision, 0);
      assert.deepEqual(initialSnapshot._children, []);

      await getRequiredHandler(
        created.handlers,
        "broadcast",
      )({
        board: "board-revision",
        data: {
          tool: "Rectangle",
          type: "rect",
          id: "rect-1",
          color: "#123456",
          size: 4,
          x: 0,
          y: 0,
          x2: 20,
          y2: 20,
        },
      });

      const liveBroadcast = getRequiredValue(
        created.broadcasted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(liveBroadcast.revision, 1);

      const nextSocket = createSocket({
        id: "socket-revision-2",
        remoteAddress: "203.0.113.71",
        query: {
          userSecret: "revision-secret-2",
          tool: "Hand",
          color: "#444444",
          size: "5",
        },
      });
      sockets.__test.handleSocketConnection(nextSocket.socket);
      await getRequiredHandler(
        nextSocket.handlers,
        "getboard",
      )("board-revision");

      const replaySnapshot = getRequiredValue(
        nextSocket.emitted.find((event) => event.event === "broadcast"),
      ).payload;
      assert.equal(replaySnapshot.revision, 1);
      assert.equal(replaySnapshot._children.length, 1);
      assert.equal(replaySnapshot._children[0].id, "rect-1");
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
          created.emitted.find((event) => event.event === "user_joined"),
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
        query: {
          userSecret: "shared-secret",
          tool: "Hand",
          color: "#111111",
          size: "4",
        },
      });
      sockets.__test.handleSocketConnection(first.socket);
      await getRequiredHandler(first.handlers, "getboard")("board-session");

      const second = createSocket({
        id: "socket-b",
        remoteAddress: "203.0.113.81",
        query: {
          userSecret: "shared-secret",
          tool: "Hand",
          color: "#222222",
          size: "5",
        },
      });
      sockets.__test.handleSocketConnection(second.socket);
      await getRequiredHandler(second.handlers, "getboard")("board-session");

      const users = sockets.__test.getBoardUserMap("board-session");
      const firstUser = getRequiredValue(users.get("socket-a"));
      const secondUser = getRequiredValue(users.get("socket-b"));
      assert.equal(firstUser.userId, secondUser.userId);

      await getRequiredHandler(
        first.handlers,
        "broadcast",
      )({
        board: "board-session",
        data: {
          tool: "Rectangle",
          type: "rect",
          id: "shape-session",
          color: "#123456",
          size: 7,
          x: 10,
          y: 20,
          x2: 30,
          y2: 40,
        },
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
        headers: {
          "user-agent": "ReporterAgent/1.0",
          "accept-language": "fr-FR,fr;q=0.9",
        },
        query: {
          userSecret: "reporter-secret",
          tool: "Hand",
          color: "#222222",
          size: "4",
        },
      });
      sockets.__test.handleSocketConnection(reporter.socket);
      await getRequiredHandler(reporter.handlers, "getboard")("board-report");
      const reporterEmitCountBeforeReport = reporter.emitted.length;

      const reported = createSocket({
        id: "socket-reported",
        remoteAddress: "203.0.113.91",
        headers: {
          "user-agent": "ReportedAgent/2.0",
          "accept-language": "en-US,en;q=0.8",
        },
        query: {
          userSecret: "reported-secret",
          tool: "Ellipse",
          color: "#333333",
          size: "7",
        },
      });
      sockets.__test.handleSocketConnection(reported.socket);
      await getRequiredHandler(reported.handlers, "getboard")("board-report");
      const reportedEmitCountBeforeReport = reported.emitted.length;

      getRequiredHandler(
        reporter.handlers,
        "report_user",
      )({
        board: "board-report",
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
        headers: {
          "cf-connecting-ip": "198.51.100.30",
          "user-agent": "ReporterHeaderAgent/1.0",
          "accept-language": "de-DE,de;q=0.9",
        },
        query: {
          userSecret: "reporter-secret",
          tool: "Hand",
        },
      });
      sockets.__test.handleSocketConnection(reporter.socket);
      await getRequiredHandler(reporter.handlers, "getboard")("board-report");

      const reported = createSocket({
        id: "socket-reported-header",
        remoteAddress: "203.0.113.101",
        headers: {
          "cf-connecting-ip": "198.51.100.31",
          "user-agent": "ReportedHeaderAgent/2.0",
          "accept-language": "es-ES,es;q=0.8",
        },
        query: {
          userSecret: "reported-secret",
          tool: "Ellipse",
        },
      });
      sockets.__test.handleSocketConnection(reported.socket);
      await getRequiredHandler(reported.handlers, "getboard")("board-report");

      getRequiredHandler(
        reporter.handlers,
        "report_user",
      )({
        board: "board-report",
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
