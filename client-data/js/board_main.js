import {
  attachPanReadyRuntime,
  createBoardRuntimeShellFromPage,
} from "./board_bootstrap.js";
import { errorLogFields, logFrontendEvent } from "./frontend_logging.js";

const documentElement = document.documentElement;

const CRITICAL_BOOT_TOOL_NAMES = ["hand"];

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
  const tools = createBoardRuntimeShellFromPage();
  const stopTemporaryPan = await attachPanReadyRuntime(tools, document);
  setBoardBootPhase("viewport-restored");

  const { hydrateBoardRuntimeFromPage } = await import("./board.js");
  hydrateBoardRuntimeFromPage(tools);
  setBoardBootPhase("connecting");
  tools.connection.start();

  await tools.toolRegistry.bootInitialTools({
    criticalToolNames: CRITICAL_BOOT_TOOL_NAMES,
    pendingToolName: documentElement.dataset.pendingTool || "",
  });
  stopTemporaryPan();
  setBoardBootPhase("ready");

  tools.toolRegistry.scheduleLazyBootRenderedTools(
    new Set(CRITICAL_BOOT_TOOL_NAMES),
  );
}

void bootBoardPage().catch((error) => {
  setBoardBootPhase("error");
  logFrontendEvent("error", "boot.page_failed", errorLogFields(error));
});
