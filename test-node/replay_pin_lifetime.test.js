const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getMinPinnedReplayBaselineSeq,
  getNextReplayPinExpiry,
  pinReplayBaseline,
  pruneExpiredReplayPins,
  resetBoardRegistry,
} = require("../server/board/registry.mjs");

const minute = 60 * 1000;

test("pruneExpiredReplayPins drops expired pins for boards that are never touched again", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  resetBoardRegistry();
  t.after(resetBoardRegistry);

  pinReplayBaseline("crawler-1", 7, 1_000_000 - 1_000);
  pinReplayBaseline("crawler-2", 7, 1_000_000 - 1_000);
  pinReplayBaseline("active", 3, 1_000_000 + minute);

  assert.equal(pruneExpiredReplayPins(1_000_000), 2);
  assert.equal(getMinPinnedReplayBaselineSeq("active", 1_000_000), 3);
});

test("a later board view sweeps pins left behind by earlier HTTP-only views", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  resetBoardRegistry();
  t.after(resetBoardRegistry);

  // Two bot views that leave without opening a socket, plus a real view.
  pinReplayBaseline("crawler-1", 7, 1_000_000 + 30_000);
  pinReplayBaseline("crawler-2", 7, 1_000_000 + 30_000);
  pinReplayBaseline("active", 3, 1_000_000 + 90_000);

  t.mock.timers.setTime(1_061_000);
  pinReplayBaseline("fresh", 1, 1_061_000 + minute);

  // The sweep, not a per-board read, removed the two crawler boards.
  assert.equal(pruneExpiredReplayPins(1_061_000), 0);
  assert.equal(getNextReplayPinExpiry("active", 1_061_000), 1_090_000);
  assert.equal(getMinPinnedReplayBaselineSeq("fresh", 1_061_000), 1);
});
