const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserHarness } = require("./helpers/browser_harness.js");

test("cached AppTools initialization keeps viewport state on its target", async () => {
  const browser = installBrowserHarness({ innerWidth: 100, innerHeight: 100 });
  try {
    const { initializeCoreRuntime } = await import(
      "../client-data/js/app_tools_core.js"
    );
    const target = { retained: true };
    const runtime = initializeCoreRuntime(target, {
      translations: {},
      serverConfig: {},
      boardName: "generated-runtime",
      token: null,
      colorPresets: [],
      initialPreferences: {
        tool: "pencil",
        color: "#000000",
        size: 10,
        opacity: 1,
      },
    });
    assert.ok(Object.is(runtime, target));
    assert.equal(runtime.retained, true);
    const board = { style: { width: "" }, dataset: {}, dispatchEvent() {} };
    const svg = {
      style: { transform: "" },
      width: { baseVal: { value: 1000 } },
      height: { baseVal: { value: 800 } },
    };
    runtime.attachDom(board, svg, {});
    assert.equal(runtime.viewportState.controller.setScale(0.5), 0.5);
    assert.equal(svg.style.transform, "scale(0.5)");
    assert.equal(board.style.width, "500px");
    assert.equal(runtime.coordinates.pageCoordinateToBoard(100), 200);
  } finally {
    browser.restore();
  }
});

test("AssetModule supports released injected and default path resolvers", async () => {
  const { AssetModule, normalizeBoardAssetPath } = await import(
    "../client-data/js/board_full_runtime_modules.js"
  );
  const { normalizeBoardAssetPath: directResolver } = await import(
    "../client-data/js/board_asset_path.js"
  );
  assert.equal(normalizeBoardAssetPath, directResolver);
  for (const path of ["./x", "../x", "/x", "data:x", "http://x", "https://x"]) {
    assert.equal(normalizeBoardAssetPath(path), path);
  }
  assert.equal(
    normalizeBoardAssetPath("tools/hand/hand.css"),
    "../tools/hand/hand.css",
  );
  assert.equal(
    new AssetModule().getToolAssetUrl("hand", "hand.css"),
    "../tools/hand/hand.css",
  );
  const injected = new AssetModule((path) => `/generated/${path}`);
  assert.equal(
    injected.getToolAssetUrl("hand", "hand.css"),
    "/generated/tools/hand/hand.css",
  );
});

test("IDs remain distinct across tools within one millisecond", (t) => {
  const mod = require("../client-data/js/board_full_runtime_modules.js");
  const uid = new mod.IdModule().generateUID;
  t.mock.method(Date, "now", () => 1);
  assert.equal(new Set(Array.from({ length: 100 }, () => uid())).size, 100);
});

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

test("I18nModule formats translated placeholder messages", async () => {
  const { I18nModule } = await import(
    "../client-data/js/board_runtime_core.js"
  );
  const i18n = new I18nModule({
    ban_user_confirmation: "Ban {name}?",
    count_message: "{count} users joined {missing}",
  });

  assert.equal(
    i18n.format("ban_user_confirmation", { name: "Alice" }),
    "Ban Alice?",
  );
  assert.equal(
    i18n.format("count_message", { count: 3 }),
    "3 users joined {missing}",
  );
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
