const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BANS_PATH = path.join(ROOT, "server", "socket", "bans.mjs");

test("board edit bans independently match secret or ip until ttl expires", () => {
  const { banBoardUser, isEditBanned, resetBans } = require(BANS_PATH);
  resetBans();
  const now = 1000;
  const ttl = 30 * 60 * 1000;
  const secretA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const otherSecret = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const ipA = "203.0.113.20";
  const otherIp = "203.0.113.21";

  banBoardUser("board-a", secretA, ipA, now, ttl);

  assert.equal(isEditBanned("board-a", secretA, otherIp, now, ttl), true);
  assert.equal(isEditBanned("board-a", otherSecret, ipA, now, ttl), true);
  assert.equal(isEditBanned("board-a", otherSecret, otherIp, now, ttl), false);
  assert.equal(
    isEditBanned("board-a", secretA, otherIp, now + ttl + 1, ttl),
    false,
  );

  resetBans();
  assert.equal(isEditBanned("board-a", secretA, ipA, now, ttl), false);
});

test("empty secrets are never banned but their ip is banned", () => {
  const { banBoardUser, isEditBanned, resetBans } = require(BANS_PATH);
  resetBans();
  const now = 2000;
  const ttl = 30 * 60 * 1000;

  banBoardUser("board-b", "", "198.51.100.9", now, ttl);

  assert.equal(isEditBanned("board-b", "", "198.51.100.10", now, ttl), false);
  assert.equal(
    isEditBanned(
      "board-b",
      "cccccccccccccccccccccccccccccccc",
      "198.51.100.9",
      now,
      ttl,
    ),
    true,
  );
});
