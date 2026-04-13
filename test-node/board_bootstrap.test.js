const test = require("node:test");
const assert = require("node:assert/strict");

global.document = /** @type {any} */ ({
  /** @param {string} id */
  getElementById: function (id) {
    if (id === "good") return { text: '{"ok":true}' };
    if (id === "bad") return { text: "{" };
    return null;
  },
});

const BoardBootstrap = require("../client-data/js/board_helpers.js").bootstrap;

test("parseEmbeddedJson returns fallback for missing or invalid content", function () {
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

test("getRequiredElement throws for missing DOM nodes", function () {
  assert.deepEqual(BoardBootstrap.getRequiredElement("good"), { text: '{"ok":true}' });
  assert.throws(function () {
    BoardBootstrap.getRequiredElement("missing");
  }, /Missing required element/);
});
