(() => {
  const assetVersion = document.documentElement.dataset.version;
  const versionSuffix = assetVersion
    ? `?v=${encodeURIComponent(assetVersion)}`
    : "";
  /** @typedef {{ path: string, register?: string }} ModuleDescriptor */

  /**
   * @param {string} path
   * @returns {Promise<unknown>}
   */
  function importWithVersion(path) {
    return import(`${path}${versionSuffix}`);
  }

  /**
   * @param {ModuleDescriptor[]} modules
   * @returns {Promise<unknown[]>}
   */
  async function importModulesInParallel(modules) {
    return Promise.all(
      modules.map(function importModule(moduleDescriptor) {
        return importWithVersion(moduleDescriptor.path);
      }),
    );
  }

  /**
   * @param {ModuleDescriptor[]} modules
   * @param {unknown[]} namespaces
   * @returns {void}
   */
  function registerModules(modules, namespaces) {
    const tools = window.Tools;
    if (!tools) {
      throw new Error("Board runtime did not initialize window.Tools.");
    }
    for (let index = 0; index < modules.length; index += 1) {
      const moduleDescriptor = modules[index];
      const namespace = /** @type {Record<string, unknown> | undefined} */ (
        namespaces[index]
      );
      if (!moduleDescriptor || !moduleDescriptor.register) continue;
      const register = namespace && namespace[moduleDescriptor.register];
      if (typeof register !== "function") {
        throw new Error(
          `Missing registrar ${moduleDescriptor.register} for ${moduleDescriptor.path}.`,
        );
      }
      register(tools);
    }
  }

  async function bootBoardPage() {
    await importModulesInParallel([
      { path: "./path-data-polyfill.js" },
      { path: "./board.js" },
    ]);

    const toolModules = /** @type {ModuleDescriptor[]} */ ([
      { path: "../tools/pencil/pencil.js", register: "registerPencilTool" },
      { path: "../tools/cursor/cursor.js", register: "registerCursorTool" },
      { path: "../tools/line/line.js", register: "registerLineTool" },
      { path: "../tools/rect/rect.js", register: "registerRectTool" },
      {
        path: "../tools/ellipse/ellipse.js",
        register: "registerEllipseTool",
      },
      { path: "../tools/text/text.js", register: "registerTextTool" },
      { path: "../tools/eraser/eraser.js", register: "registerEraserTool" },
      { path: "../tools/hand/hand.js", register: "registerHandTool" },
      { path: "../tools/grid/grid.js", register: "registerGridTool" },
      {
        path: "../tools/download/download.js",
        register: "registerDownloadTool",
      },
      { path: "../tools/zoom/zoom.js", register: "registerZoomTool" },
    ]);
    registerModules(toolModules, await importModulesInParallel(toolModules));

    const optionalToolModules = /** @type {ModuleDescriptor[]} */ ([
      { path: "./canvascolor.js", register: "registerCanvasColor" },
    ]);
    if (document.documentElement.hasAttribute("data-moderator")) {
      optionalToolModules.unshift({
        path: "../tools/clear/clear.js",
        register: "registerClearTool",
      });
    }
    registerModules(
      optionalToolModules,
      await importModulesInParallel(optionalToolModules),
    );
  }

  bootBoardPage().catch((error) => {
    console.error("Failed to boot board page:", error);
  });
})();
