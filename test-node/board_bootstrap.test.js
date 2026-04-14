const test = require("node:test");
const assert = require("node:assert/strict");
const { installTestConsole, withConsole } = require("./test_console.js");

installTestConsole();

global.document = /** @type {any} */ ({
  /** @param {string} id */
  getElementById: (id) => {
    if (id === "good") return { text: '{"ok":true}' };
    if (id === "bad") return { text: "{" };
    return null;
  },
});

const BoardBootstrap =
  require("../client-data/js/board_page_state.js").bootstrap;

test("parseEmbeddedJson returns fallback for missing or invalid content", () => {
  assert.deepEqual(BoardBootstrap.parseEmbeddedJson("good", { ok: false }), {
    ok: true,
  });
  assert.deepEqual(BoardBootstrap.parseEmbeddedJson("bad", { ok: false }), {
    ok: false,
  });
  assert.deepEqual(BoardBootstrap.parseEmbeddedJson("missing", { ok: false }), {
    ok: false,
  });
});

test("parseEmbeddedJson reports invalid JSON when silent mode is off", () => {
  const previousSilent = process.env.WBO_SILENT;
  let warned = false;

  delete process.env.WBO_SILENT;
  try {
    withConsole(
      {
        warn: () => {
          warned = true;
        },
      },
      () => {
        assert.deepEqual(
          BoardBootstrap.parseEmbeddedJson("bad", { ok: false }),
          {
            ok: false,
          },
        );
      },
    );
    assert.equal(warned, true);
  } finally {
    if (previousSilent === undefined) delete process.env.WBO_SILENT;
    else process.env.WBO_SILENT = previousSilent;
  }
});

test("getRequiredElement throws for missing DOM nodes", () => {
  assert.deepEqual(BoardBootstrap.getRequiredElement("good"), {
    text: '{"ok":true}',
  });
  assert.throws(() => {
    BoardBootstrap.getRequiredElement("missing");
  }, /Missing required element/);
});
