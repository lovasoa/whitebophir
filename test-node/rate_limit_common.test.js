const test = require("node:test");
const assert = require("node:assert/strict");

const RateLimitCommon = require("../client-data/js/rate_limit_common.js");

test("fixed-window helpers are stateless and reset after the period", function () {
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

test("effective rate-limit definitions honor board overrides", function () {
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

test("action counters classify constructive and destructive batch costs", function () {
  const batch = {
    _children: [
      { type: "delete", id: "shape-1" },
      { type: "copy", id: "shape-2", newid: "shape-3" },
      { type: "child", parent: "line-1", x: 10, y: 20 },
      { type: "clear", id: "" },
    ],
  };

  assert.equal(RateLimitCommon.countDestructiveActions(batch), 2);
  assert.equal(RateLimitCommon.countConstructiveActions(batch), 1);
  assert.equal(
    RateLimitCommon.isConstructiveAction({
      type: "rect",
      id: "rect-1",
    }),
    true,
  );
  assert.equal(
    RateLimitCommon.isConstructiveAction({
      type: "update",
      id: "rect-1",
    }),
    false,
  );
});
