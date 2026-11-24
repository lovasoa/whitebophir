const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getMinPinnedReplayBaselineSeq,
  discardPinnedReplayBaselinesBefore,
  pinReplayBaseline,
  resetBoardRegistry,
} = require("../server/board/registry.mjs");

test("each replay pin is removed at its expiry without another board request", (t) => {
  const now = 1_000_000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  resetBoardRegistry();
  t.after(resetBoardRegistry);

  pinReplayBaseline("crawler", 7, now + 500);
  pinReplayBaseline("active", 3, now + 300);
  pinReplayBaseline("active", 5, now + 400);
  t.mock.timers.tick(100);
  pinReplayBaseline("active", 3, now + 800);

  // Read as of the original time so the getter cannot prune the pins itself.
  t.mock.timers.tick(399);
  assert.equal(getMinPinnedReplayBaselineSeq("crawler", now), 7);
  t.mock.timers.tick(1);
  assert.equal(getMinPinnedReplayBaselineSeq("crawler", now), null);
  assert.equal(getMinPinnedReplayBaselineSeq("active", now), 3);
  t.mock.timers.tick(300);
  assert.equal(getMinPinnedReplayBaselineSeq("active", now), null);
});

test("discarded and reset pins cannot remove newer pins for the same baseline", (t) => {
  const now = 1_000_000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  resetBoardRegistry();
  t.after(resetBoardRegistry);

  pinReplayBaseline("reset", 3, now + 100);
  resetBoardRegistry();
  pinReplayBaseline("reset", 3, now + 200);
  pinReplayBaseline("discard", 3, now + 100);
  pinReplayBaseline("discard", 4, now + 200);
  discardPinnedReplayBaselinesBefore("discard", 4);
  pinReplayBaseline("discard", 3, now + 200);

  t.mock.timers.tick(100);
  assert.equal(getMinPinnedReplayBaselineSeq("reset", now), 3);
  assert.equal(getMinPinnedReplayBaselineSeq("discard", now), 3);
  t.mock.timers.tick(100);
  assert.equal(getMinPinnedReplayBaselineSeq("reset", now), null);
  assert.equal(getMinPinnedReplayBaselineSeq("discard", now), null);
});
