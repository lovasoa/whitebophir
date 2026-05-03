import assert from "node:assert/strict";
import test from "node:test";

import { I18nModule } from "../client-data/js/board_runtime_core.js";

test("I18nModule resolves hyphenated tool ids through underscore translation keys", () => {
  const i18n = new I18nModule({ straight_line: "Ligne droite" });

  assert.equal(i18n.t("straight-line"), "Ligne droite");
  assert.equal(i18n.t("Straight line"), "Ligne droite");
});
