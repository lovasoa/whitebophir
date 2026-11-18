const assert = require("node:assert/strict");
const test = require("node:test");
const { SocketEvents } = require("../client-data/js/socket_events.js");
const { installBrowserHarness } = require("./helpers/browser_harness.js");

test("socket parameters retain board identity", async () => {
  const { buildSocketParams } = await import(
    "../client-data/js/board_transport.js"
  );
  assert.equal(
    buildSocketParams("/boards/test", null, null, "test").query,
    "board=test",
  );
});

test("moderation disconnect payloads normalize explicit and legacy sources", async () => {
  const {
    getModerationDisconnectNoticeDescriptor,
    normalizeModerationDisconnectPayload,
  } = await import("../client-data/js/board_connection_module.js");

  const peerReport = normalizeModerationDisconnectPayload({
    banDurationMs: 0,
    source: "peer_report",
  });
  assert.deepEqual(peerReport, {
    banDurationMs: 0,
    source: "peer_report",
  });
  assert.deepEqual(getModerationDisconnectNoticeDescriptor(peerReport), {
    kind: "report",
    titleKey: "peer_report_disconnect_title",
    messageKey: "peer_report_disconnect_body",
  });

  /** @type {Array<{description: string, payload: unknown}>} */
  const peerReportFallbacks = [
    { description: "missing duration", payload: { source: "peer_report" } },
    { description: "missing payload", payload: undefined },
    { description: "null payload", payload: null },
    {
      description: "negative duration",
      payload: { banDurationMs: -1, source: "peer_report" },
    },
    {
      description: "null duration",
      payload: { banDurationMs: null, source: "peer_report" },
    },
    {
      description: "string duration",
      payload: { banDurationMs: "0", source: "peer_report" },
    },
    {
      description: "non-coercible duration",
      payload: { banDurationMs: Symbol("zero"), source: "peer_report" },
    },
    {
      description: "NaN duration",
      payload: { banDurationMs: Number.NaN, source: "peer_report" },
    },
    {
      description: "infinite duration",
      payload: {
        banDurationMs: Number.POSITIVE_INFINITY,
        source: "peer_report",
      },
    },
    {
      description: "invalid rule",
      payload: {
        banDurationMs: 0,
        source: "peer_report",
        moderationRule: "not-a-rule",
      },
    },
    {
      description: "undefined rule property",
      payload: {
        banDurationMs: 0,
        source: "peer_report",
        moderationRule: undefined,
      },
    },
  ];
  for (const { description, payload } of peerReportFallbacks) {
    assert.equal(
      normalizeModerationDisconnectPayload(payload).source,
      "moderator",
      description,
    );
  }

  const legacyWarning = normalizeModerationDisconnectPayload({
    banDurationMs: "invalid",
  });
  assert.deepEqual(legacyWarning, {
    banDurationMs: 0,
    source: "moderator",
  });
  assert.deepEqual(getModerationDisconnectNoticeDescriptor(legacyWarning), {
    kind: "warning",
    titleKey: "moderation_warning_title",
    messageKey: "moderation_warning_body",
  });

  const malformedPeerBan = normalizeModerationDisconnectPayload({
    banDurationMs: 12_345.9,
    source: "peer_report",
    moderationRule: "not-a-rule",
  });
  assert.deepEqual(malformedPeerBan, {
    banDurationMs: 12_345,
    source: "moderator",
  });
  assert.deepEqual(getModerationDisconnectNoticeDescriptor(malformedPeerBan), {
    kind: "ban",
    titleKey: "moderation_ban_title",
    messageKey: "moderation_ban_body",
  });

  assert.deepEqual(
    normalizeModerationDisconnectPayload({
      banDurationMs: 0,
      source: "peer_report",
      moderationRule: "harassment",
    }),
    {
      banDurationMs: 0,
      source: "moderator",
      moderationRule: "harassment",
    },
  );
});

test("access expiry schedules one replaceable authoritative reconnect", async (t) => {
  const { ConnectionModule, normalizeAccessRefreshDelayMs } = await import(
    "../client-data/js/board_connection_module.js"
  );
  const browser = installBrowserHarness();
  t.after(() => browser.restore());
  let reconnects = 0;
  const connection = new ConnectionModule(
    () => /** @type {any} */ ({}),
    () => {},
  );
  connection.start = async () => {
    reconnects++;
  };
  assert.equal(normalizeAccessRefreshDelayMs(undefined), null);
  assert.equal(normalizeAccessRefreshDelayMs(-1), null);
  assert.equal(normalizeAccessRefreshDelayMs(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeAccessRefreshDelayMs(1_234.9), 1_234);
  connection.scheduleAccessRefresh(1_000);
  browser.advanceTime(1_049);
  assert.equal(reconnects, 0);
  connection.scheduleAccessRefresh(2_000);
  browser.advanceTime(1);
  assert.equal(reconnects, 0);
  browser.advanceTime(2_049);
  assert.equal(reconnects, 1);
  assert.equal(connection.accessRefreshTimerId, null);
  connection.scheduleAccessRefresh(3_000);
  connection.scheduleAccessRefresh(undefined);
  browser.advanceTime(3_050);
  assert.equal(reconnects, 1);
});

test("quick reconnects exhaust the retry budget even after successful sync", async (t) => {
  const { ConnectionModule } = await import(
    "../client-data/js/board_connection_module.js"
  );
  const browser = installBrowserHarness();
  t.after(() => browser.restore());
  const noop = () => {};
  const replay = { synchronizedAt: /** @type {number | null} */ (null) };
  const showReload = t.mock.fn();
  const connection = new ConnectionModule(
    () =>
      /** @type {any} */ ({
        replay,
        writes: { clearBufferedWriteTimer: noop },
        presence: { clearConnectedUsers: noop },
        dom: { clearBoardCursors: noop },
        status: { showUnknownMutationError: showReload },
      }),
    noop,
  );
  const connect = t.mock.method(connection, "start", async () => {
    replay.synchronizedAt = performance.now();
  });

  connection.scheduleSocketReconnect();
  browser.advanceTime(250);
  assert.equal(connect.mock.callCount(), 1);
  browser.advanceTime(30_000);

  for (const delay of [250, 500, 1000, 2000, 4000]) {
    connection.scheduleSocketReconnect();
    browser.advanceTime(delay - 1);
    assert.equal(connection.reloadRequired, false);
    const attempts = connect.mock.callCount();
    browser.advanceTime(1);
    assert.equal(connect.mock.callCount(), attempts + 1);
  }

  connection.scheduleSocketReconnect();
  connection.scheduleSocketReconnect();
  browser.advanceTime(60_000);
  assert.equal(connect.mock.callCount(), 6);
  assert.equal(showReload.mock.callCount(), 1);
  assert.equal(connection.reloadRequired, true);
});

test("connection and replay discard superseded asynchronous work", async (t) => {
  const { ConnectionModule } = await import(
    "../client-data/js/board_connection_module.js"
  );
  const { ReplayModule } = await import(
    "../client-data/js/board_replay_module.js"
  );
  const { MessageModule } = await import(
    "../client-data/js/board_message_module.js"
  );
  const browser = installBrowserHarness();
  t.after(() => browser.restore());
  browser.setWindowProperties({
    location: {
      pathname: "/boards/test",
      href: "https://wbo.test/boards/test",
    },
  });
  const noop = () => {};
  const Tools = /** @type {any} */ ({
    dom: {
      status: "attached",
      clearBoardCursors: noop,
      svg: { setAttribute: noop },
      drawingArea: { innerHTML: "old" },
    },
    presence: { clearConnectedUsers: noop, upsertConnectedUser: noop },
    identity: { boardName: "test", token: null },
    preferences: {
      initial: { tool: "pencil" },
      getColor: () => "#000000",
      getSize: () => 1,
    },
    status: { syncWriteStatusIndicator: noop },
    optimistic: {
      journal: { reset: noop },
      pruneForAuthoritativeMessage: noop,
    },
    writes: {
      pumpBufferedWrites: noop,
      isWritePaused: () => false,
      discardBufferedWrites: noop,
      pruneBufferedWritesForInvalidatingMessage: noop,
    },
    turnstile: { resetConnection: noop },
    interaction: { releaseAll: noop, isOwnCursorSuppressed: () => true },
    toolRegistry: {
      mounted: {},
      pendingMessages: {},
      normalizeServerRenderedElements: noop,
      syncActiveToolInputPolicy: noop,
    },
  });
  Tools.connection = new ConnectionModule(() => Tools, noop);
  Tools.replay = new ReplayModule(() => Tools, noop);
  Tools.replay.incomingBroadcastQueue.push({
    seq: 1,
    mutation: { tool: 3, type: 1, id: "superseded" },
  });
  Tools.replay.beginAuthoritativeResync();
  assert.deepEqual(Tools.replay.incomingBroadcastQueue, []);
  /** @type {Array<Map<string, (...args: any[]) => void>>} */
  const socketHandlers = [];
  const emit = t.mock.fn();
  const connect = t.mock.fn(() => {
    const handlers = new Map();
    socketHandlers.push(handlers);
    return {
      id: "socket",
      connected: true,
      emit,
      on: (
        /** @type {string} */ event,
        /** @type {(...args: any[]) => void} */ handler,
      ) => handlers.set(event, handler),
      connect: noop,
    };
  });
  browser.setGlobal("io", { connect });
  let finish = noop;
  let pending = new Promise((resolve) => {
    finish = () => resolve(undefined);
  });
  browser.setGlobal("fetch", async () => ({
    ok: true,
    text: () => pending.then(() => "stale"),
  }));
  Tools.replay.refreshBaselineBeforeConnect = true;
  const baseline = {
    seq: 100,
    readonly: false,
    drawingAreaMarkup: "fresh",
  };
  const first = Tools.connection.start();
  assert.equal(Tools.connection.start(), first);
  Tools.replay.beginAuthoritativeResync();
  Tools.replay.applyAuthoritativeBaseline(baseline);
  Tools.replay.refreshBaselineBeforeConnect = false;
  finish();
  await first;
  await Tools.connection.starting;
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(Tools.replay.authoritativeSeq, 100);
  assert.equal(Tools.dom.drawingArea.innerHTML, "fresh");
  pending = new Promise((resolve) => {
    finish = () => resolve(undefined);
  });
  Tools.toolRegistry.bootTool = async () => {
    await pending;
    for (const message of Tools.toolRegistry.pendingMessages.rectangle || [])
      Tools.dom.drawingArea.innerHTML += message.id;
  };
  Tools.messages = new MessageModule(Tools.toolRegistry, Tools.identity, {
    ensureBoardExtentForBounds: () => false,
  });
  Tools.replay.authoritativeSeq = 2;
  const applying = Tools.replay.processIncomingBroadcast({
    seq: 3,
    mutation: { tool: 3, type: 1, id: "stale" },
  });
  Tools.replay.beginAuthoritativeResync();
  Tools.replay.applyAuthoritativeBaseline(baseline);
  finish();
  assert.equal(await applying, false);
  assert.equal(Tools.replay.authoritativeSeq, 100);
  assert.equal(Tools.dom.drawingArea.innerHTML, "fresh");
  assert.deepEqual(Tools.toolRegistry.pendingMessages, {});
  Tools.replay.refreshBaselineBeforeConnect = false;
  t.mock.method(Tools.replay, "refreshAuthoritativeBaseline", async () => {});
  Tools.connection.scheduleSocketReconnect();
  Tools.connection.scheduleSocketReconnect();
  browser.advanceTime(250);
  await Tools.connection.starting;
  assert.equal(connect.mock.callCount(), 2);
  const joined = t.mock.method(Tools.presence, "upsertConnectedUser", () => {});
  socketHandlers[0]?.get(SocketEvents.USER_JOINED)?.({ socketId: "stale" });
  const staleRateLimit = socketHandlers[0]?.get(SocketEvents.RATE_LIMITED);
  assert.ok(staleRateLimit);
  staleRateLimit({ retryAfterMs: 1000 });
  assert.equal(joined.mock.callCount(), 0);
  assert.equal(Tools.writes.serverRateLimitedUntil, undefined);
  socketHandlers[1]?.get(SocketEvents.USER_JOINED)?.({ socketId: "current" });
  assert.equal(joined.mock.callCount(), 1);

  Object.defineProperty(document, "hidden", {
    value: true,
    configurable: true,
  });
  Tools.connection.handleVisibilityChange();
  assert.deepEqual(emit.mock.calls.slice(-1)[0]?.arguments, [
    SocketEvents.TAB_HIDDEN,
    true,
  ]);
  Object.defineProperty(document, "hidden", { value: false });
  Tools.connection.handleVisibilityChange();
  assert.deepEqual(emit.mock.calls.slice(-1)[0]?.arguments, [
    SocketEvents.TAB_HIDDEN,
    false,
  ]);
  Object.defineProperty(document, "hidden", { value: true });
  Tools.connection.handleVisibilityChange();
  Tools.messages.unreadCount = 12;
  const onDisconnect = socketHandlers[1]?.get(SocketEvents.DISCONNECT);
  assert.ok(onDisconnect);
  Tools.connection.socket.connected = false;
  onDisconnect("io server disconnect");
  assert.equal(document.title, "(?) test | WBO");
  browser.advanceTime(60_000);
  assert.equal(connect.mock.callCount(), 2);

  Object.defineProperty(document, "hidden", { value: false });
  Tools.connection.handleVisibilityChange();
  Tools.connection.handleVisibilityChange();
  browser.advanceTime(0);
  await Tools.connection.starting;
  assert.equal(connect.mock.callCount(), 3);
  const foregroundHandlers = socketHandlers[2];
  assert.ok(foregroundHandlers);
  foregroundHandlers.get(SocketEvents.CONNECT)?.();
  assert.equal(document.title, "(?) test | WBO");
  const seq = Tools.replay.authoritativeSeq;
  assert.equal(
    await Tools.replay.processIncomingBroadcast({
      fromSeq: seq,
      seq,
      _children: [],
    }),
    true,
  );
  assert.equal(document.title, "test | WBO");

  Tools.i18n = { t: (/** @type {string} */ key) => key };
  Tools.ui = { showModerationDisconnectNotice: () => Promise.resolve() };
  const acknowledge = t.mock.fn();
  const moderationNotice = foregroundHandlers.get(
    SocketEvents.MODERATION_DISCONNECT,
  );
  assert.ok(moderationNotice);
  moderationNotice({ banDurationMs: 0, source: "moderator" }, acknowledge);
  assert.equal(acknowledge.mock.callCount(), 1);
  Tools.replay.beginAuthoritativeResync();
  foregroundHandlers.get(SocketEvents.USER_JOINED)?.({
    socketId: "superseded",
  });
  moderationNotice({ banDurationMs: 0, source: "moderator" }, acknowledge);
  assert.equal(joined.mock.callCount(), 1);
  assert.equal(acknowledge.mock.callCount(), 1);
});

test("drawing does not delay broadcast sequence or acknowledgements", async (t) => {
  const { ReplayModule } = await import(
    "../client-data/js/board_replay_module.js"
  );
  const browser = installBrowserHarness();
  t.after(() => browser.restore());
  const applied = /** @type {string[]} */ ([]);
  const acknowledged = /** @type {string[]} */ ([]);
  let drawing = true;
  const noop = () => {};
  const Tools = /** @type {any} */ ({
    dom: { status: "attached", drawingArea: { childElementCount: 32768 } },
    connection: { generation: 0, socket: { id: "local" } },
    interaction: { isOwnCursorSuppressed: () => drawing },
    optimistic: {
      journal: { promote: noop },
      pruneForAuthoritativeMessage: noop,
    },
    writes: {
      resolveBufferedWrite: /** @param {string} id */ (id) =>
        acknowledged.push(id),
      pruneBufferedWritesForInvalidatingMessage: noop,
    },
    messages: {
      messageForTool: /** @param {{id: string}} message */ async (message) =>
        applied.push(message.id),
    },
    presence: { updateConnectedUsersFromActivity: noop },
    status: { syncWriteStatusIndicator: noop },
  });
  const replay = new ReplayModule(() => Tools, noop);
  replay.awaitingSnapshot = false;
  /** @param {string} id */
  const rectangle = (id) => ({
    tool: /** @type {3} */ (3),
    type: /** @type {1} */ (1),
    id,
    color: "#000000",
    size: 2,
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
  });
  replay.enqueueIncomingBroadcast({
    seq: 1,
    acceptedAtMs: 0,
    mutation: rectangle("remote"),
  });
  replay.enqueueIncomingBroadcast({
    seq: 2,
    acceptedAtMs: 0,
    mutation: {
      ...rectangle("own"),
      socket: "local",
      clientMutationId: "ack",
    },
  });
  await new Promise(setImmediate);
  assert.deepEqual(applied, ["remote"]);
  assert.deepEqual(acknowledged, ["ack"]);
  assert.equal(replay.authoritativeSeq, 2);
  replay.enqueueIncomingBroadcast({
    seq: 3,
    acceptedAtMs: 0,
    mutation: rectangle("pending"),
  });
  drawing = false;
  replay.enqueueIncomingBroadcast({
    seq: 4,
    acceptedAtMs: 0,
    mutation: rectangle("after-release"),
  });
  await new Promise(setImmediate);
  assert.deepEqual(applied, ["remote", "pending", "after-release"]);
  drawing = true;
  Tools.dom.drawingArea.childElementCount = 100;
  replay.enqueueIncomingBroadcast({
    seq: 5,
    acceptedAtMs: 0,
    mutation: rectangle("sparse"),
  });
  await new Promise(setImmediate);
  assert.equal(applied[applied.length - 1], "sparse");
  assert.equal(replay.authoritativeSeq, 5);
  assert.equal(replay.incomingBroadcastQueue.length, 0);
});
