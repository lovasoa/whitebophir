const assert = require("node:assert/strict");
const test = require("node:test");

test("I18nModule resolves hyphenated tool ids through underscore translation keys", async () => {
  const { I18nModule } = await import(
    "../client-data/js/board_runtime_core.js"
  );
  const i18n = new I18nModule({ straight_line: "Ligne droite" });

  assert.equal(i18n.t("straight-line"), "Ligne droite");
  assert.equal(i18n.t("Straight line"), "Ligne droite");
});
