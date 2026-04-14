(() => {
  const assetVersion = document.documentElement.dataset.version;
  const versionSuffix = assetVersion
    ? `?v=${encodeURIComponent(assetVersion)}`
    : "";

  /**
   * @param {string} path
   * @returns {Promise<unknown>}
   */
  function importWithVersion(path) {
    return import(`${path}${versionSuffix}`);
  }

  /**
   * @param {string[]} paths
   * @returns {Promise<void>}
   */
  async function importInParallel(paths) {
    await Promise.all(paths.map(importWithVersion));
  }

  async function bootBoardPage() {
    await importInParallel([
      "./path-data-polyfill.js",
      "./board.js",
    ]);

    const toolModules = [
      "../tools/pencil/pencil.js",
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
    ];
    await importInParallel(toolModules);

    const optionalToolModules = [];
    if (document.documentElement.hasAttribute("data-moderator")) {
      optionalToolModules.push("../tools/clear/clear.js");
    }
    optionalToolModules.push("./canvascolor.js");

    await importInParallel(optionalToolModules);
  }

  bootBoardPage().catch((error) => {
    console.error("Failed to boot board page:", error);
  });
})();
