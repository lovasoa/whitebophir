import { withVersion } from "./tool_assets.js";

const assetVersion = document.documentElement.dataset.version || "";
const documentElement = document.documentElement;

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
 * @typedef {"booting" | "runtime-initialized" | "viewport-restored" | "connecting" | "ready" | "error"} BoardBootPhase
 */

/**
 * @param {BoardBootPhase} phase
 * @returns {void}
 */
function setBoardBootPhase(phase) {
  if (documentElement.dataset.boardPhase === phase) return;
  documentElement.dataset.boardPhase = phase;
  document.dispatchEvent(
    new CustomEvent("wbo:board-phase", {
      detail: { phase: phase },
    }),
  );
}

setBoardBootPhase("booting");

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
      return window.setTimeout(
        () =>
          callback({
            didTimeout: false,
            timeRemaining: () => 0,
          }),
        50,
      );
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

  setBoardBootPhase("runtime-initialized");
  tools.installViewportHashObservers();
  tools.applyViewportFromHash();
  setBoardBootPhase("viewport-restored");

  await Promise.all(
    Array.from(REPLAY_SAFE_TOOL_NAMES).map((toolName) =>
      tools.ensureToolClassLoaded(toolName),
    ),
  );

  setBoardBootPhase("connecting");
  tools.startConnection();

  await bootCriticalTools();
  await bootToolNames(
    Array.from(REPLAY_SAFE_TOOL_NAMES).filter(
      (toolName) => !CRITICAL_BOOT_TOOL_NAMES.includes(toolName),
    ),
  );
  const pendingToolName = documentElement.dataset.pendingTool || "";
  if (pendingToolName) {
    await tools.activateTool(pendingToolName);
  }
  if (!tools.curTool && tools.list.Hand && tools.canUseTool("Hand")) {
    tools.change("Hand");
  }
  setBoardBootPhase("ready");

  const deferredToolNames = getRenderedToolNames().filter(
    (toolName) => !REPLAY_SAFE_TOOL_NAMES.has(toolName),
  );
  await Promise.all(
    deferredToolNames.map((toolName) => tools.ensureToolClassLoaded(toolName)),
  );

  const canvasColorModule = /** @type {{registerCanvasColor?: () => void}} */ (
    await importWithVersion("./canvascolor.js")
  );
  if (typeof canvasColorModule.registerCanvasColor === "function") {
    canvasColorModule.registerCanvasColor();
  }

  await lazyBootRenderedTools();
}

void bootBoardPage().catch((error) => {
  setBoardBootPhase("error");
  console.error("Failed to boot board page:", error);
});
