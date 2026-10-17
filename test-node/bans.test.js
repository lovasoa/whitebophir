const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BANS_PATH = path.join(ROOT, "server", "socket", "bans.mjs");

test("board edit bans independently match secret or ip until ttl expires", () => {
  const {
    banBoardUser,
    getEditBanExpiresAt,
    isEditBanned,
    resetBans,
  } = require(BANS_PATH);
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
  assert.equal(getEditBanExpiresAt("board-a", secretA, ipA, now), now + ttl);
  assert.equal(isEditBanned("board-a", secretA, otherIp, now + ttl + 1), false);

  resetBans();
  assert.equal(isEditBanned("board-a", secretA, ipA, now), false);
});

test("an identity stays banned until its later matching secret or ip expiry", () => {
  const { banBoardUser, getEditBanExpiresAt, resetBans } = require(BANS_PATH);
  resetBans();
  const now = 10_000;
  const secret = "11111111111111111111111111111111";
  const ip = "203.0.113.41";

  banBoardUser("overlap-board", secret, "203.0.113.40", now, 1_000);
  banBoardUser(
    "overlap-board",
    "22222222222222222222222222222222",
    ip,
    now,
    2_000,
  );

  assert.equal(
    getEditBanExpiresAt("overlap-board", secret, ip, now),
    now + 2_000,
  );
  assert.equal(
    getEditBanExpiresAt("overlap-board", secret, ip, now + 1_000),
    now + 2_000,
  );
  assert.equal(
    getEditBanExpiresAt("overlap-board", secret, ip, now + 2_000),
    null,
  );
  resetBans();
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

test("active bans expose public details once and disappear on expiry", () => {
  const { banBoardUser, listActiveBans, resetBans } = require(BANS_PATH);
  resetBans();
  banBoardUser("Public", "secret", "203.0.113.1", 1000, 500, {
    name: "User One",
    moderationRule: "drawings",
  });
  const [ban] = listActiveBans("public", 1000);
  assert.ok(ban);
  assert.equal(listActiveBans("public", 1000).length, 1);
  assert.match(ban.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(ban, {
    id: ban.id,
    name: "User One",
    bannedAt: 1000,
    expiresAt: 1500,
    moderationRule: "drawings",
  });
  assert.deepEqual(listActiveBans("another-board", 1000), []);
  assert.deepEqual(listActiveBans("public", 1500), []);
  resetBans();
});

test("unbanning removes both keys but preserves newer overlapping bans", () => {
  const {
    banBoardUser,
    listActiveBans,
    unbanBoardUser,
    isEditBanned,
    resetBans,
  } = require(BANS_PATH);
  resetBans();
  banBoardUser("overlap", "first", "shared-ip", 1000, 5000, { name: "First" });
  const [first] = listActiveBans("overlap", 1000);
  banBoardUser("overlap", "second", "shared-ip", 2000, 5000, {
    name: "Second",
  });
  const [second] = listActiveBans("overlap", 2000);
  assert.ok(first);
  assert.ok(second);
  assert.equal(unbanBoardUser("different", first.id, 2000), null);
  assert.equal(unbanBoardUser("overlap", "unknown", 2000), null);
  assert.ok(unbanBoardUser("overlap", first.id, 2000));
  assert.equal(isEditBanned("overlap", "first", "other-ip", 2000), false);
  assert.equal(isEditBanned("overlap", "first", "shared-ip", 2000), true);
  assert.deepEqual(listActiveBans("overlap", 2000), [second]);
  assert.ok(unbanBoardUser("overlap", second.id, 2000));
  assert.equal(isEditBanned("overlap", "second", "shared-ip", 2000), false);
  assert.deepEqual(listActiveBans("overlap", 2000), []);
  assert.equal(unbanBoardUser("overlap", second.id, 2000), null);
  resetBans();
});
