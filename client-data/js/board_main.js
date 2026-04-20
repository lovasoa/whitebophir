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
function waitForBoardCanvas() {
  if (document.getElementById("canvas")) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.getElementById("canvas")) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
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
    (toolName) => !REPLAY_SAFE_TOOL_NAMES.has(toolName),
  );
  renderedToolNames.forEach((toolName) => {
    schedule(() => {
      void tools.ensureToolBooted(toolName);
    });
  });
}

async function bootBoardPage() {
  await waitForBoardCanvas();
  await Promise.all([
    import(withVersion("./path-data-polyfill.js", assetVersion)),
    import(withVersion("./board.js", assetVersion)),
  ]);

  const tools = window.Tools;
  if (!tools) {
    throw new Error("Board runtime did not initialize window.Tools.");
  }

  setBoardBootPhase("runtime-initialized");
  tools.installViewportHashObservers();
  tools.applyViewportFromHash();
  setBoardBootPhase("viewport-restored");

  const renderedToolNames = getRenderedToolNames();
  const visibleToolNames = new Set(renderedToolNames);
  const renderedToolClassLoad = Promise.all(
    renderedToolNames
      .filter((toolName) => !CRITICAL_BOOT_TOOL_NAMES.includes(toolName))
      .map((toolName) => tools.ensureToolClassLoaded(toolName)),
  );

  for (const toolName of CRITICAL_BOOT_TOOL_NAMES) {
    if (!visibleToolNames.has(toolName)) continue;
    await tools.bootTool(toolName);
  }

  setBoardBootPhase("connecting");
  tools.startConnection();
  for (const toolName of REPLAY_SAFE_TOOL_NAMES) {
    if (CRITICAL_BOOT_TOOL_NAMES.includes(toolName)) continue;
    await tools.bootTool(toolName);
  }
  const pendingToolName = documentElement.dataset.pendingTool || "";
  if (pendingToolName) {
    await tools.activateTool(pendingToolName);
  }
  if (!tools.curTool && tools.list.Hand && tools.canUseTool("Hand")) {
    tools.change("Hand");
  }
  setBoardBootPhase("ready");

  await renderedToolClassLoad;

  const canvasColorModule = /** @type {{registerCanvasColor?: () => void}} */ (
    await import(withVersion("./canvascolor.js", assetVersion))
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
