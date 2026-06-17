import { boardStateGrantsCapability } from "../tools/manifest.js";
import { DEFAULT_BOARD_STATE } from "./board_page_state.js";

/** @import { AppBoardState, AppToolsState } from "../../types/app-runtime" */

export class AccessModule {
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
    this.boardState = DEFAULT_BOARD_STATE;
  }

  get readOnly() {
    return this.boardState.readonly;
  }

  get canEdit() {
    return this.boardState.canEdit;
  }

  get canClear() {
    return this.boardState.canClear;
  }

  get canWrite() {
    return this.boardState.canEdit;
  }

  /** @param {AppBoardState} boardState */
  applyBoardState(boardState) {
    const Tools = this.getTools();
    this.boardState = boardState;
    const registry = Tools.toolRegistry;

    // Tools and the style palette follow the live edit capability, so a
    // read-only user (including one banned on an otherwise writable board) never
    // keeps tools they cannot use. Mirrors the server-rendered toolbar, which
    // filters the same way via boardStateGrantsCapability.
    const settings = document.getElementById("settings");
    if (settings) settings.style.display = this.canEdit ? "" : "none";

    Object.keys(registry.mounted || {}).forEach((toolName) => {
      const toolElem = document.getElementById(`toolID-${toolName}`);
      if (!toolElem) return;
      const granted = boardStateGrantsCapability(
        boardState,
        registry.mounted[toolName]?.requiredCapability,
      );
      toolElem.style.display =
        granted && registry.shouldDisplayTool(toolName) ? "" : "none";
    });

    registry.syncDrawToolAvailability(true);

    const current = registry.current;
    if (
      current &&
      registry.mounted.hand &&
      !boardStateGrantsCapability(boardState, current.requiredCapability)
    ) {
      registry.change("hand");
    }
  }
}
