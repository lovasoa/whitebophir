const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BOARD_MODERATORS_PATH = path.join(
  ROOT,
  "server",
  "auth",
  "board_moderators.mjs",
);
const CONFIG_HELPERS_PATH = path.join(
  ROOT,
  "server",
  "configuration",
  "helpers.mjs",
);

test("configured board moderators match listed secrets case-insensitively by board", () => {
  const { isConfiguredModerator } = require(BOARD_MODERATORS_PATH);
  const secret = "abcdefabcdefabcdefabcdefabcdefab";
  const config = {
    BOARD_MODERATORS: {
      myboard: new Set([secret]),
    },
  };

  assert.equal(isConfiguredModerator(config, "MyBoard", secret), true);
  assert.equal(isConfiguredModerator(config, "myboard", ""), false);
  assert.equal(isConfiguredModerator(config, "otherboard", secret), false);
  assert.equal(
    isConfiguredModerator(
      config,
      "myboard",
      "11111111111111111111111111111111",
    ),
    false,
  );
});

test("parseBoardModeratorsEnv parses board secret groups and rejects malformed entries", () => {
  const { parseBoardModeratorsEnv } = require(CONFIG_HELPERS_PATH);
  const parsed = parseBoardModeratorsEnv("WBO_BOARD_MODERATORS", {
    WBO_BOARD_MODERATORS:
      "MyBoard:abcdefabcdefabcdefabcdefabcdefab,11111111111111111111111111111111 other:22222222222222222222222222222222",
  });

  assert.deepEqual(
    [...parsed.myboard],
    ["abcdefabcdefabcdefabcdefabcdefab", "11111111111111111111111111111111"],
  );
  assert.deepEqual([...parsed.other], ["22222222222222222222222222222222"]);
  assert.throws(
    () =>
      parseBoardModeratorsEnv("WBO_BOARD_MODERATORS", {
        WBO_BOARD_MODERATORS: "board:not-a-secret",
      }),
    /Invalid WBO_BOARD_MODERATORS/,
  );
});
