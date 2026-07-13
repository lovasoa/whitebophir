const assert = require("node:assert/strict");
const test = require("node:test");

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

test("access expiry schedules one replaceable authoritative reconnect", async () => {
  const { ConnectionModule, normalizeAccessRefreshDelayMs } = await import(
    "../client-data/js/board_connection_module.js"
  );
  const originalWindow = global.window;
  let nextTimerId = 1;
  /** @type {Map<number, {callback: () => void, delayMs: number}>} */
  const timers = new Map();
  /** @type {number[]} */
  const cleared = [];
  global.window = /** @type {any} */ ({
    setTimeout(
      /** @type {() => void} */ callback,
      /** @type {number} */ delayMs,
    ) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, delayMs });
      return timerId;
    },
    clearTimeout(/** @type {number} */ timerId) {
      cleared.push(timerId);
      timers.delete(timerId);
    },
  });

  try {
    let reconnects = 0;
    const connection = new ConnectionModule(
      () => /** @type {any} */ ({}),
      () => {},
    );
    connection.start = () => {
      reconnects += 1;
    };

    assert.equal(normalizeAccessRefreshDelayMs(undefined), null);
    assert.equal(normalizeAccessRefreshDelayMs(-1), null);
    assert.equal(normalizeAccessRefreshDelayMs(Number.POSITIVE_INFINITY), null);
    assert.equal(normalizeAccessRefreshDelayMs(1_234.9), 1_234);

    connection.scheduleAccessRefresh(1_000);
    assert.equal(timers.get(1)?.delayMs, 1_050);

    connection.scheduleAccessRefresh(2_000);
    assert.deepEqual(cleared, [1]);
    assert.equal(timers.has(1), false);
    assert.equal(timers.get(2)?.delayMs, 2_050);

    timers.get(2)?.callback();
    assert.equal(reconnects, 1);
    assert.equal(connection.accessRefreshTimerId, null);

    connection.scheduleAccessRefresh(3_000);
    connection.scheduleAccessRefresh(undefined);
    assert.equal(timers.size, 1); // Fired timer 2 remains only in this fake map.
    assert.deepEqual(cleared, [1, 3]);
  } finally {
    global.window = originalWindow;
  }
});
