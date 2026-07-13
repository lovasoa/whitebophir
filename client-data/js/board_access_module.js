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

  get canReport() {
    return this.boardState.canReport !== false;
  }

  get canWrite() {
    return this.boardState.canEdit;
  }

  /** @param {AppBoardState} boardState */
  applyBoardState(boardState) {
    const Tools = this.getTools();
    this.boardState = boardState;
    Tools.connection.scheduleAccessRefresh(boardState.accessRefreshAfterMs);

    // Hide editing affordances whenever the user cannot edit (a read-only board,
    // or a banned user on a writable one). The drawing tools themselves are
    // gated by shouldDisplayTool, which is capability-aware.
    const hideEditingTools = !this.canEdit;
    const settings = document.getElementById("settings");
    if (settings) settings.style.display = hideEditingTools ? "none" : "";

    Object.keys(Tools.toolRegistry.mounted || {}).forEach((toolName) => {
      const toolElem = document.getElementById(`toolID-${toolName}`);
      if (!toolElem) return;
      toolElem.style.display = Tools.toolRegistry.shouldDisplayTool(toolName)
        ? ""
        : "none";
    });

    Tools.toolRegistry.syncDrawToolAvailability(true);
    Tools.presence.schedulePresenceRender();

    if (
      hideEditingTools &&
      Tools.toolRegistry.current &&
      !Tools.toolRegistry.shouldDisplayTool(Tools.toolRegistry.current.name) &&
      Tools.toolRegistry.mounted.hand
    ) {
      Tools.toolRegistry.change("hand");
    }
  }
}
