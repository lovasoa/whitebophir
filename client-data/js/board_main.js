import { DRAW_TOOL_IDS } from "../tools/tool-order.js";
const documentElement = document.documentElement;
/** @type {string} */
const PATH_DATA_POLYFILL_MODULE = "./path-data-polyfill.js";

const CRITICAL_BOOT_TOOL_NAMES = ["hand", DRAW_TOOL_IDS[0] || ""];
const REPLAY_SAFE_TOOL_NAMES = new Set([
  ...DRAW_TOOL_IDS,
  "cursor",
  "eraser",
  "hand",
]);

/**
 * @typedef {"viewport-restored" | "connecting" | "ready" | "error"} BoardBootPhase
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

/**
 * @returns {string[]}
 */
function getRenderedToolNames() {
  return Array.from(document.querySelectorAll("#tools > .tool[data-tool-id]"))
    .map((element) => element.getAttribute("data-tool-id") || "")
    .filter(Boolean);
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
      void tools.bootTool(toolName);
    });
  });
}

async function bootBoardPage() {
  const boardModule = await import("./board.js");
  await import(PATH_DATA_POLYFILL_MODULE);
  const tools = window.Tools;
  if (!tools) {
    throw new Error("Board runtime did not initialize the board app.");
  }

  setBoardBootPhase("connecting");
  tools.startConnection();

  await boardModule.attachBoardDom(document);
  tools.installViewportHashObservers();
  tools.applyViewportFromHash();
  setBoardBootPhase("viewport-restored");

  const renderedToolNames = getRenderedToolNames();
  const visibleToolNames = new Set(renderedToolNames);

  for (const toolName of CRITICAL_BOOT_TOOL_NAMES) {
    if (!visibleToolNames.has(toolName)) continue;
    await tools.bootTool(toolName);
  }
  for (const toolName of REPLAY_SAFE_TOOL_NAMES) {
    if (CRITICAL_BOOT_TOOL_NAMES.includes(toolName)) continue;
    await tools.bootTool(toolName);
  }
  const pendingToolName = documentElement.dataset.pendingTool || "";
  if (pendingToolName) {
    await tools.activateTool(pendingToolName);
  }
  if (!tools.curTool && tools.list.hand && tools.canUseTool("hand")) {
    tools.change("hand");
  }
  setBoardBootPhase("ready");

  const canvasColorModule = /** @type {{registerCanvasColor?: () => void}} */ (
    await import("./canvascolor.js")
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
