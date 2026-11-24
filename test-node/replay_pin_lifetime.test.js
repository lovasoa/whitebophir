const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getMinPinnedReplayBaselineSeq,
  getNextReplayPinExpiry,
  pinReplayBaseline,
  resetBoardRegistry,
} = require("../server/board/registry.mjs");

const minute = 60 * 1000;

test("expired replay pins are swept even without further board requests", (t) => {
  const now = 1_000_000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  resetBoardRegistry();
  t.after(resetBoardRegistry);

  pinReplayBaseline("crawler-1", 7, now + minute);
  t.mock.timers.tick(minute / 2);
  pinReplayBaseline("crawler-2", 7, now + minute);
  pinReplayBaseline("active", 3, now + 2 * minute);

  t.mock.timers.tick(minute / 2);

  // Read as of the original time so the getter cannot prune these pins itself.
  assert.equal(getMinPinnedReplayBaselineSeq("crawler-1", now), null);
  assert.equal(getMinPinnedReplayBaselineSeq("crawler-2", now), null);
  assert.equal(getNextReplayPinExpiry("active"), now + 2 * minute);

  t.mock.timers.tick(minute);
  assert.equal(getMinPinnedReplayBaselineSeq("active", now), null);
});
