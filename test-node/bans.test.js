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

  assert.equal(isEditBanned("board-a", secretA, otherIp, now), true);
  assert.equal(isEditBanned("board-a", otherSecret, ipA, now), true);
  assert.equal(isEditBanned("board-a", otherSecret, otherIp, now), false);
  assert.equal(isEditBanned("board-a", secretA, otherIp, now + ttl + 1), false);

  resetBans();
  assert.equal(isEditBanned("board-a", secretA, ipA, now), false);
});

test("ban ttl defaults to 15 minutes and clamps to one week", () => {
  const {
    DEFAULT_BAN_TTL_MS,
    MAX_BAN_TTL_MS,
    banBoardUser,
    isEditBanned,
    normalizeBanTtlMs,
    resetBans,
  } = require(BANS_PATH);
  resetBans();
  const now = 3000;
  const secret = "dddddddddddddddddddddddddddddddd";
  const ip = "203.0.113.30";

  assert.equal(DEFAULT_BAN_TTL_MS, 15 * 60 * 1000);
  assert.equal(MAX_BAN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(normalizeBanTtlMs(undefined), DEFAULT_BAN_TTL_MS);
  assert.equal(normalizeBanTtlMs(Number.POSITIVE_INFINITY), DEFAULT_BAN_TTL_MS);
  assert.equal(normalizeBanTtlMs(MAX_BAN_TTL_MS * 2), MAX_BAN_TTL_MS);

  banBoardUser("board-default-ttl", secret, ip, now);

  assert.equal(
    isEditBanned("board-default-ttl", secret, ip, now + DEFAULT_BAN_TTL_MS - 1),
    true,
  );
  assert.equal(
    isEditBanned("board-default-ttl", secret, ip, now + DEFAULT_BAN_TTL_MS),
    false,
  );

  banBoardUser("board-max-ttl", secret, ip, now, MAX_BAN_TTL_MS * 2);

  assert.equal(
    isEditBanned("board-max-ttl", secret, ip, now + MAX_BAN_TTL_MS - 1),
    true,
  );
  assert.equal(
    isEditBanned("board-max-ttl", secret, ip, now + MAX_BAN_TTL_MS),
    false,
  );

  resetBans();
});

test("empty secrets are never banned but their ip is banned", () => {
  const { banBoardUser, isEditBanned, resetBans } = require(BANS_PATH);
  resetBans();
  const now = 2000;
  const ttl = 30 * 60 * 1000;

  banBoardUser("board-b", "", "198.51.100.9", now, ttl);

  assert.equal(isEditBanned("board-b", "", "198.51.100.10", now), false);
  assert.equal(
    isEditBanned(
      "board-b",
      "cccccccccccccccccccccccccccccccc",
      "198.51.100.9",
      now,
    ),
    true,
  );
});
