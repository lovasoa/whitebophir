const test = require("node:test");
const assert = require("node:assert/strict");

const RateLimitCommon = require("../client-data/js/rate_limit_common.js");
const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { Pencil, Text } = require("../client-data/tools/index.js");

test("fixed-window exports remain usable by cached write modules", () => {
  const initial = RateLimitCommon.createRateLimitState(1_000);
  const consumed = RateLimitCommon.consumeFixedWindowRateLimit(
    initial,
    2,
    5_000,
    2_000,
  );

  assert.deepEqual(initial, {
    windowStart: 1_000,
    count: 0,
    lastSeen: 1_000,
  });
  assert.deepEqual(consumed, {
    windowStart: 1_000,
    count: 2,
    lastSeen: 2_000,
  });
  assert.equal(
    RateLimitCommon.canConsumeFixedWindowRateLimit(
      consumed,
      1,
      3,
      5_000,
      2_500,
    ),
    true,
  );
  assert.equal(
    RateLimitCommon.canConsumeFixedWindowRateLimit(
      consumed,
      2,
      3,
      5_000,
      2_500,
    ),
    false,
  );
  assert.equal(
    RateLimitCommon.getRateLimitRemainingMs(consumed, 5_000, 2_500),
    3_500,
  );
  assert.deepEqual(
    RateLimitCommon.normalizeRateLimitState(consumed, 5_000, 6_500),
    {
      windowStart: 6_500,
      count: 0,
      lastSeen: 6_500,
    },
  );
});

test("emission history expires enough cost for an atomic batch", () => {
  let history = RateLimitCommon.recordRateLimitUsage(null, 3, 0);
  history = RateLimitCommon.recordRateLimitUsage(history, 2, 500);
  history = RateLimitCommon.recordRateLimitUsage(history, 4, 900);
  assert.equal(
    RateLimitCommon.getRateLimitHistoryWaitMs(history, 2, 10, 1_000, 999),
    1,
  );
  assert.equal(
    RateLimitCommon.getRateLimitHistoryWaitMs(history, 2, 10, 1_000, 1_000),
    0,
  );
  assert.equal(
    RateLimitCommon.getRateLimitHistoryWaitMs(history, 5, 10, 1_000, 1_000),
    500,
  );
  assert.equal(
    RateLimitCommon.getRateLimitHistoryWaitMs(history, 1, 10, 1_000, 2_000),
    0,
  );
  assert.equal(history.total, 0);
  assert.equal(
    RateLimitCommon.getRateLimitHistoryWaitMs(history, 11, 10, 1_000, 2_000),
    0,
  );
});

test("emission history stays bounded across many windows", () => {
  let history = null;
  for (let now = 0; now < 10_000; now++) {
    assert.equal(
      RateLimitCommon.getRateLimitHistoryWaitMs(history, 1, 1_000, 1_000, now),
      0,
    );
    history = RateLimitCommon.recordRateLimitUsage(history, 1, now);
    assert.ok(history.entries.length <= 4_004);
  }
  assert.ok(history);
  assert.equal(history.total, 1_000);
});

test("effective rate-limit definitions honor board overrides", () => {
  const definition = {
    limit: 240,
    periodMs: 60_000,
    overrides: {
      anonymous: {
        limit: 120,
        periodMs: 45_000,
      },
    },
  };

  assert.deepEqual(
    RateLimitCommon.getEffectiveRateLimitDefinition(definition, "team-board"),
    {
      limit: 240,
      periodMs: 60_000,
    },
  );
  assert.deepEqual(
    RateLimitCommon.getEffectiveRateLimitDefinition(definition, "anonymous"),
    {
      limit: 120,
      periodMs: 45_000,
    },
  );
});

test("anonymous fixed-window limits reopen exactly after the remaining wait", () => {
  const definition = {
    limit: 10,
    anonymousLimit: 1,
    periodMs: 1_000,
  };
  const effective = RateLimitCommon.getEffectiveRateLimitDefinition(
    definition,
    "anonymous",
  );
  const consumed = RateLimitCommon.consumeFixedWindowRateLimit(
    RateLimitCommon.createRateLimitState(1_000),
    1,
    effective.periodMs,
    1_000,
  );

  assert.deepEqual(effective, {
    limit: 1,
    periodMs: 1_000,
  });
  assert.equal(
    RateLimitCommon.getRateLimitRemainingMs(
      consumed,
      effective.periodMs,
      1_500,
    ),
    500,
  );
  assert.equal(
    RateLimitCommon.normalizeRateLimitState(consumed, effective.periodMs, 2_000)
      .count,
    0,
  );
});

test("action counters classify constructive and destructive batch costs", () => {
  const batch = {
    _children: [
      { type: MutationType.DELETE, id: "shape-1" },
      { type: MutationType.COPY, id: "shape-2", newid: "shape-3" },
      { type: MutationType.APPEND, parent: "line-1", x: 10, y: 20 },
      { type: MutationType.CLEAR, id: "" },
    ],
  };

  assert.equal(RateLimitCommon.countDestructiveActions(batch), 2);
  assert.equal(RateLimitCommon.countConstructiveActions(batch), 1);
  assert.equal(
    RateLimitCommon.isConstructiveAction({
      type: MutationType.CREATE,
      id: "rect-1",
    }),
    true,
  );
  assert.equal(
    RateLimitCommon.isConstructiveAction({
      type: MutationType.UPDATE,
      id: "rect-1",
    }),
    false,
  );
});

test("text creation counters charge creates and url-like text updates", () => {
  const batch = {
    _children: [
      { tool: Text.id, type: MutationType.CREATE, id: "text-1" },
      {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-1",
        txt: "hello",
      },
      {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-1",
        txt: "https://example.com/demo",
      },
      {
        tool: Text.id,
        type: MutationType.UPDATE,
        id: "text-2",
        txt: "www.example.com/demo",
      },
      { tool: Pencil.id, type: MutationType.CREATE, id: "line-1" },
    ],
  };

  assert.equal(RateLimitCommon.countTextCreationActions(batch), 3);
  assert.equal(
    RateLimitCommon.countTextCreationActions({
      tool: Text.id,
      type: MutationType.CREATE,
      id: "text-3",
    }),
    1,
  );
  assert.equal(
    RateLimitCommon.countTextCreationActions({
      tool: Text.id,
      type: MutationType.UPDATE,
      id: "text-3",
      txt: "plain text",
    }),
    0,
  );
  assert.equal(
    RateLimitCommon.countTextCreationActions({
      tool: Text.id,
      type: MutationType.UPDATE,
      id: "text-3",
      txt: "http://example.com",
    }),
    1,
  );
});
