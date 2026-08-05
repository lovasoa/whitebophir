const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STORE_PATH = path.join(
  ROOT,
  "server",
  "socket",
  "temporary_moderators.mjs",
);

test("temporary moderator grants are board-scoped and expire", () => {
  const {
    getTemporaryModeratorExpiresAt,
    grantTemporaryModerator,
    resetTemporaryModerators,
  } = require(STORE_PATH);
  resetTemporaryModerators();
  const now = 1_000;
  const secret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  assert.equal(
    grantTemporaryModerator("Board-A", secret, now, 60_000),
    now + 60_000,
  );
  assert.equal(
    getTemporaryModeratorExpiresAt("board-a", secret, now),
    now + 60_000,
  );
  assert.equal(getTemporaryModeratorExpiresAt("board-b", secret, now), null);
  assert.equal(
    getTemporaryModeratorExpiresAt("board-a", secret, now + 60_000),
    null,
  );
});

test("temporary moderator grants can be replaced and revoked", () => {
  const {
    getTemporaryModeratorExpiresAt,
    grantTemporaryModerator,
    listTemporaryModeratorGrants,
    resetTemporaryModerators,
    revokeTemporaryModerator,
    revokeTemporaryModeratorById,
  } = require(STORE_PATH);
  resetTemporaryModerators();
  const now = 2_000;
  const secret = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const user = {
    socketId: "socket-a",
    userId: "visible-id",
    name: "Visible name",
    color: "#001f3f",
    size: 4,
    lastTool: "hand",
    joinedAt: now,
    position: { x: 0, y: 0 },
  };
  grantTemporaryModerator("board-a", secret, now, 10_000, user);
  grantTemporaryModerator("board-a", secret, now, 20_000, user);
  assert.equal(
    getTemporaryModeratorExpiresAt("board-a", secret, now),
    now + 20_000,
  );
  assert.equal(revokeTemporaryModerator("board-a", secret), true);
  assert.equal(getTemporaryModeratorExpiresAt("board-a", secret, now), null);
  assert.equal(revokeTemporaryModerator("board-a", secret), false);

  grantTemporaryModerator("board-a", secret, now, 20_000, user);
  const grants = listTemporaryModeratorGrants("board-a", now);
  assert.equal(grants.length, 1);
  assert.equal(grants[0].user.name, "Visible name");
  assert.equal("userSecret" in grants[0], false);
  assert.equal(
    revokeTemporaryModeratorById("board-a", grants[0].id).userSecret,
    secret,
  );
  assert.deepEqual(listTemporaryModeratorGrants("board-a", now), []);
});

test("temporary moderator grants reject empty identities and invalid durations", () => {
  const {
    MAX_TEMPORARY_MODERATOR_TTL_MS,
    grantTemporaryModerator,
    resetTemporaryModerators,
  } = require(STORE_PATH);
  resetTemporaryModerators();

  assert.equal(grantTemporaryModerator("board-a", "", 1_000, 10_000), null);
  assert.equal(grantTemporaryModerator("board-a", "secret", 1_000, 0), null);
  assert.equal(
    grantTemporaryModerator(
      "board-a",
      "secret",
      1_000,
      MAX_TEMPORARY_MODERATOR_TTL_MS + 1,
    ),
    null,
  );
});
