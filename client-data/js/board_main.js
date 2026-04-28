import { DRAW_TOOL_IDS } from "../tools/tool-order.js";
import { errorLogFields, logFrontendEvent } from "./frontend_logging.js";

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
 * @returns {Promise<void>}
 */
async function bootBoardPage() {
  const { createBoardRuntimeFromPage } = await import("./board.js");
  await import(PATH_DATA_POLYFILL_MODULE);
  const tools = createBoardRuntimeFromPage();

  await tools.shell.attachBoardDom(document);
  tools.viewportState.install();
  setBoardBootPhase("connecting");
  tools.connection.start();

  tools.viewportState.restoreFromHash();
  setBoardBootPhase("viewport-restored");

  await tools.toolRegistry.bootInitialTools({
    criticalToolNames: CRITICAL_BOOT_TOOL_NAMES,
    replaySafeToolNames: REPLAY_SAFE_TOOL_NAMES,
    pendingToolName: documentElement.dataset.pendingTool || "",
  });
  setBoardBootPhase("ready");

  tools.toolRegistry.scheduleLazyBootRenderedTools(REPLAY_SAFE_TOOL_NAMES);
}

void bootBoardPage().catch((error) => {
  setBoardBootPhase("error");
  logFrontendEvent("error", "boot.page_failed", errorLogFields(error));
});
