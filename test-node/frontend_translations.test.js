const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const TRANSLATIONS_PATH = path.join(
  __dirname,
  "..",
  "server",
  "http",
  "translations.json",
);

/** @param {string} raw */
function i18nKey(raw) {
  return raw.toLowerCase().replace(/[ -]/g, "_");
}

test("frontend translation catalog covers rendered and runtime UI keys", () => {
  const translations = JSON.parse(fs.readFileSync(TRANSLATIONS_PATH, "utf8"));
  const requiredKeys = [
    "board_name_placeholder",
    "ban",
    "clear",
    "click_to_zoom",
    "collaborative_whiteboard",
    "color",
    "create_private_board",
    "cursor",
    "download",
    "ellipse",
    "eraser",
    "grid",
    "hand",
    "index_title",
    "introduction_paragraph",
    "keyboard shortcut",
    "loading",
    "mousewheel",
    "named_private_board_description",
    "opacity",
    "open_board",
    "open_public_board",
    "pencil",
    "please_zoom_in_to_draw",
    "private_board_description",
    "public_board_description",
    "rate_limit_disconnect_message",
    "recent_boards",
    "rectangle",
    "report",
    "selector",
    "share_instructions",
    "size",
    "slow_down_briefly",
    "straight-line",
    "tagline",
    "text",
    "turnstile_status_prefix",
    "unknown_error_reload_page",
    "users",
    "view_source",
    "white-out",
    "zoom",
  ].map(i18nKey);

  for (const [language, catalog] of Object.entries(translations)) {
    const missing = requiredKeys.filter((key) => !(key in catalog));
    assert.deepEqual(missing, [], `${language} is missing UI translations`);
  }
});
