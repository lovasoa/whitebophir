const assert = require("node:assert/strict");
const test = require("node:test");
const { createSocketScenario } = require("./test_helpers.js");
const { listActiveBans } = require("../server/socket/bans.mjs");
const { MODERATION_RULES } = require("../client-data/js/moderation_rules.js");

const boardName = "strict-moderation-reports";
const moderatorSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";
const scenario = {
  boardName,
  config: {
    BOARD_MODERATORS: new Map([[boardName, new Set([moderatorSecret])]]),
  },
};

test("moderation rejects payloads the dialog cannot send without side effects", async () => {
  await createSocketScenario(
    scenario,
    async ({ connect, invoke, test: socketTest }) => {
      const moderator = await connect({
        id: "strict-mod",
        headers: { cookie: `wbo-user-secret-v1=${moderatorSecret}` },
        remoteAddress: "203.0.113.1",
      });
      const peer = await connect({
        id: "strict-peer",
        remoteAddress: "203.0.113.2",
      });
      const target = await connect({
        id: "strict-target",
        remoteAddress: "203.0.113.3",
      });
      const socketId = target.socket.id;
      const valid = {
        socketId,
        banDurationMs: 900_000,
        moderationRule: "harassment",
      };
      const invalid = [
        undefined,
        null,
        true,
        42,
        "report",
        [],
        [valid],
        { ...valid, socketId: null },
        { ...valid, socketId: "" },
        { socketId },
        { socketId, moderationRule: "harassment" },
        { socketId, banDurationMs: 900_000 },
        ...[
          undefined,
          null,
          false,
          123,
          {},
          [],
          "",
          "unknown",
          " Harassment ",
        ].map((moderationRule) => ({ ...valid, moderationRule })),
        ...[
          undefined,
          null,
          false,
          "0",
          "900000",
          [],
          {},
          NaN,
          Infinity,
          -1,
          1,
          1000,
          900_000.5,
          2 * 60 * 60 * 1000,
          604_800_001,
        ].map((banDurationMs) => ({ ...valid, banDurationMs })),
        { socketId, banDurationMs: 0 },
        { ...valid, clientMutationId: "extra" },
        Object.assign(Object.create({ moderationRule: "harassment" }), {
          socketId,
          banDurationMs: 900_000,
          extra: true,
        }),
      ];
      const eventCounts = [moderator, peer, target].map(
        (created) => created.emitted.length,
      );
      for (const payload of invalid)
        await invoke(moderator, "report_user", payload);
      for (const payload of [
        valid,
        { socketId, banDurationMs: 0 },
        { socketId, moderationRule: "harassment" },
        { socketId, extra: true },
      ]) {
        await invoke(peer, "report_user", payload);
      }
      assert.deepEqual(
        [moderator, peer, target].map((created) => created.emitted.length),
        eventCounts,
      );
      for (const created of [moderator, peer, target]) {
        assert.equal(created.socket.client.conn.closeCalls.length, 0);
        assert.equal(created.socket.disconnectCalls.length, 0);
      }
      assert.deepEqual(listActiveBans(boardName, Date.now()), []);
      assert.equal(socketTest.getLastUserReportLog(), null);
    },
  );
});

test("moderation accepts every dialog rule and duration with the reason intact", async () => {
  await createSocketScenario(scenario, async ({ connect, invoke }) => {
    const moderator = await connect({
      id: "valid-mod",
      headers: { cookie: `wbo-user-secret-v1=${moderatorSecret}` },
      remoteAddress: "203.0.113.10",
    });
    const durations = [0, 900_000, 86_400_000, 604_800_000];
    for (const [index, rule] of MODERATION_RULES.entries()) {
      const target = await connect({
        id: `valid-target-${index}`,
        remoteAddress: `203.0.113.${20 + index}`,
      });
      const banDurationMs = durations[index % durations.length];
      assert.notEqual(banDurationMs, undefined);
      await invoke(moderator, "report_user", {
        socketId: target.socket.id,
        banDurationMs,
        moderationRule: rule.id,
      });
      assert.equal(target.socket.client.conn.closeCalls.length, 1);
      assert.deepEqual(
        target.emitted
          .filter((event) => event.event === "moderation_disconnect")
          .map((event) => event.payload),
        [{ banDurationMs, moderationRule: rule.id, source: "moderator" }],
      );
      const ban = listActiveBans(boardName, Date.now()).find(
        (entry) => entry.moderationRule === rule.id,
      );
      if (banDurationMs === 0) assert.equal(ban, undefined);
      else {
        assert.ok(ban);
        assert.equal(ban.expiresAt - ban.bannedAt, banDurationMs);
      }
    }
    assert.equal(moderator.socket.client.conn.closeCalls.length, 0);
  });
});
