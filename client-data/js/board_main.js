(() => {
  const assetVersion = document.documentElement.dataset.version;
  const versionSuffix = assetVersion
    ? `?v=${encodeURIComponent(assetVersion)}`
    : "";

  /**
   * @param {string[]} paths
   * @returns {Promise<void>}
   */
  async function importSequentially(paths) {
    for (const path of paths) {
      await import(`${path}${versionSuffix}`);
    }
  }

  /**
   * @param {string[]} paths
   * @returns {Promise<void>}
   */
  async function importInParallel(paths) {
    await Promise.all(paths.map((path) => import(`${path}${versionSuffix}`)));
  }

  async function bootBoardPage() {
    await importSequentially([
      "./path-data-polyfill.js",
      "./shared_module_resolver.js",
      "./message_tool_metadata.js",
      "./message_common.js",
      "./rate_limit_common.js",
      "./board_page_state.js",
      "./board_transport.js",
      "./board_message_replay.js",
      "./minitpl.js",
      "./intersect.js",
      "./board.js",
      "../tools/pencil/wbo_pencil_point.js",
    ]);

    await importInParallel([
      "../tools/cursor/cursor.js",
      "../tools/line/line.js",
      "../tools/rect/rect.js",
      "../tools/ellipse/ellipse.js",
      "../tools/text/text.js",
      "../tools/eraser/eraser.js",
      "../tools/hand/hand.js",
      "../tools/grid/grid.js",
      "../tools/download/download.js",
      "../tools/zoom/zoom.js",
    ]);

    await importSequentially(["../tools/pencil/pencil.js"]);

    if (document.documentElement.hasAttribute("data-moderator")) {
      await import(`../tools/clear/clear.js${versionSuffix}`);
    }

    await import(`./canvascolor.js${versionSuffix}`);
  }

  bootBoardPage().catch((error) => {
    console.error("Failed to boot board page:", error);
  });
})();
