import { getToolModuleImportPath, withVersion } from "./tool_assets.js";

const assetVersion = document.documentElement.dataset.version || "";
document.documentElement.dataset.boardReady = "booting";

const CRITICAL_BOOT_TOOL_NAMES = ["Hand", "Pencil"];
const REPLAY_SAFE_TOOL_NAMES = new Set([
  "Pencil",
  "Cursor",
  "Straight line",
  "Rectangle",
  "Ellipse",
  "Text",
  "Eraser",
  "Hand",
]);

/**
 * @param {string} path
 * @returns {string}
 */
function withAssetVersion(path) {
  return withVersion(path, assetVersion);
}

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
function importWithVersion(path) {
  return import(withAssetVersion(path));
}

/**
 * @returns {string[]}
 */
function getRenderedToolNames() {
  return Array.from(document.querySelectorAll("#tools > .tool[data-tool-name]"))
    .map((element) => element.getAttribute("data-tool-name") || "")
    .filter(Boolean);
}

/**
 * @param {string} toolName
 * @returns {Promise<unknown>}
 */
async function loadAndRegisterToolClass(toolName) {
  const namespace = /** @type {{default?: unknown}} */ (
    await importWithVersion(getToolModuleImportPath(toolName))
  );
  const tools = window.Tools;
  if (!tools) {
    throw new Error("Board runtime did not initialize window.Tools.");
  }
  const ToolClass = namespace.default;
  if (typeof ToolClass !== "function") {
    throw new Error(`Missing default tool class export for ${toolName}.`);
  }
  tools.registerToolClass(/** @type {any} */ (ToolClass));
  return ToolClass;
}

/**
 * @param {string[]} toolNames
 * @returns {Promise<void>}
 */
async function loadToolClasses(toolNames) {
  const uniqueToolNames = Array.from(new Set(toolNames));
  await Promise.all(uniqueToolNames.map(loadAndRegisterToolClass));
}

/**
 * @returns {Promise<void>}
 */
async function bootCriticalTools() {
  const tools = window.Tools;
  if (!tools) return;
  const visibleTools = new Set(getRenderedToolNames());
  for (const toolName of CRITICAL_BOOT_TOOL_NAMES) {
    if (!visibleTools.has(toolName)) continue;
    await tools.bootTool(toolName);
  }
}

/**
 * @param {string[]} toolNames
 * @returns {Promise<void>}
 */
async function bootToolNames(toolNames) {
  const tools = window.Tools;
  if (!tools) return;
  for (const toolName of toolNames) {
    await tools.bootTool(toolName);
  }
}

/**
 * @returns {Promise<void>}
 */
async function lazyBootRenderedTools() {
  const tools = window.Tools;
  if (!tools) return;
  const schedule =
    window.requestIdleCallback ||
    /**
     * @param {(deadline?: IdleDeadline) => void} callback
     */
    ((callback) => {
      return window.setTimeout(() => callback(), 50);
    });
  const renderedToolNames = getRenderedToolNames().filter(
    (toolName) => !CRITICAL_BOOT_TOOL_NAMES.includes(toolName),
  );
  renderedToolNames.forEach((toolName) => {
    schedule(() => {
      void tools.ensureToolBooted(toolName);
    });
  });
}

async function bootBoardPage() {
  await Promise.all([
    importWithVersion("./path-data-polyfill.js"),
    importWithVersion("./board.js"),
  ]);

  const tools = window.Tools;
  if (!tools) {
    throw new Error("Board runtime did not initialize window.Tools.");
  }

  tools.loadToolClassByName = async function loadToolClassByName(toolName) {
    await loadAndRegisterToolClass(toolName);
  };

  await loadToolClasses(Array.from(REPLAY_SAFE_TOOL_NAMES));

  await bootCriticalTools();
  await bootToolNames(
    Array.from(REPLAY_SAFE_TOOL_NAMES).filter(
      (toolName) => !CRITICAL_BOOT_TOOL_NAMES.includes(toolName),
    ),
  );
  if (!tools.curTool && tools.list.Hand && tools.canUseTool("Hand")) {
    tools.change("Hand");
  }
  tools.startConnection();
  document.documentElement.dataset.boardReady = "true";

  const deferredToolNames = getRenderedToolNames().filter(
    (toolName) => !REPLAY_SAFE_TOOL_NAMES.has(toolName),
  );
  await loadToolClasses(deferredToolNames);

  const canvasColorModule = /** @type {{registerCanvasColor?: () => void}} */ (
    await importWithVersion("./canvascolor.js")
  );
  if (typeof canvasColorModule.registerCanvasColor === "function") {
    canvasColorModule.registerCanvasColor();
  }

  await lazyBootRenderedTools();
}

void bootBoardPage().catch((error) => {
  document.documentElement.dataset.boardReady = "error";
  console.error("Failed to boot board page:", error);
});
