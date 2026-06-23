const assert = require("node:assert/strict");
const test = require("node:test");

test("I18nModule resolves hyphenated tool ids through underscore translation keys", async () => {
  const { I18nModule } = await import(
    "../client-data/js/board_runtime_core.js"
  );
  const i18n = new I18nModule({
    keyboard_shortcut: "raccourci clavier",
    straight_line: "Ligne droite",
    white_out: "Correcteur",
  });

  assert.equal(i18n.t("straight-line"), "Ligne droite");
  assert.equal(i18n.t("Straight line"), "Ligne droite");
  assert.equal(i18n.t("keyboard shortcut"), "raccourci clavier");
  assert.equal(i18n.t("White-out"), "Correcteur");
});

test("Board DOM cursor cleanup removes SVG and HTML cursor overlays", async () => {
  const { AttachedBoardDomRuntimeModule } = await import(
    "../client-data/js/board_runtime_core.js"
  );
  const svgCursors = { innerHTML: "<g></g>" };
  const htmlCursor = {
    removed: false,
    remove() {
      this.removed = true;
    },
  };
  const dom = new AttachedBoardDomRuntimeModule(
    /** @type {any} */ ({
      /** @param {string} selector */
      querySelectorAll(selector) {
        assert.equal(selector, ".opcursor-html");
        return [htmlCursor];
      },
    }),
    /** @type {any} */ ({
      /** @param {string} id */
      getElementById(id) {
        assert.equal(id, "cursors");
        return svgCursors;
      },
    }),
    /** @type {any} */ ({}),
  );

  dom.clearBoardCursors();

  assert.equal(svgCursors.innerHTML, "");
  assert.equal(htmlCursor.removed, true);
});
