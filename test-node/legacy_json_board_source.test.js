const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { withEnv } = require("./test_helpers.js");
const legacyJsonBoardSource = require("../server/legacy_json_board_source.mjs");

test("legacy json board source parses board payload and metadata", () => {
  assert.deepEqual(
    legacyJsonBoardSource.parseLegacyStoredBoard({
      __wbo_meta__: { readonly: true },
      "rect-1": {
        id: "rect-1",
        tool: "Rectangle",
      },
    }),
    {
      board: {
        "rect-1": {
          id: "rect-1",
          tool: "Rectangle",
        },
      },
      metadata: { readonly: true },
    },
  );
});

test("legacy json board source reads board state and metadata from disk", async () => {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-legacy-json-source-"),
  );

  await withEnv({ WBO_HISTORY_DIR: historyDir }, async () => {
    await fs.writeFile(
      legacyJsonBoardSource.boardJsonPath("legacy-source"),
      JSON.stringify({
        __wbo_meta__: { readonly: true },
        "text-1": {
          id: "text-1",
          tool: "Text",
          txt: "hello",
        },
      }),
      "utf8",
    );

    assert.deepEqual(
      await legacyJsonBoardSource.readLegacyBoardState("legacy-source"),
      {
        board: {
          "text-1": {
            id: "text-1",
            tool: "Text",
            txt: "hello",
          },
        },
        metadata: { readonly: true },
        source: "json",
      },
    );
  });
});
