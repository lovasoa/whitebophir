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
