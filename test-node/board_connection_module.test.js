const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserHarness } = require("./helpers/browser_harness.js");

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
    presence: { clearConnectedUsers: noop },
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
      isWritePaused: () => false,
      discardBufferedWrites: noop,
      pruneBufferedWritesForInvalidatingMessage: noop,
    },
    turnstile: { pendingWrites: [], hideOverlay: noop },
    interaction: { releaseAll: noop },
    toolRegistry: {
      mounted: {},
      pendingMessages: {},
      normalizeServerRenderedElements: noop,
      syncActiveToolInputPolicy: noop,
    },
  });
  Tools.connection = new ConnectionModule(() => Tools, noop);
  Tools.replay = new ReplayModule(() => Tools, noop);
  const connect = t.mock.fn(() => ({
    id: "socket",
    on: noop,
    connect: noop,
  }));
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
  Tools.messages = new MessageModule(Tools.toolRegistry, Tools.identity);
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
});
