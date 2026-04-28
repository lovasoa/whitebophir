/** @import { AppBoardState, AppToolsState } from "../../types/app-runtime" */

export class AccessModule {
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
    this.boardState = {
      readonly: false,
      canWrite: true,
    };
    this.readOnly = false;
    this.canWrite = true;
  }

  /** @param {AppBoardState} boardState */
  applyBoardState(boardState) {
    const Tools = this.getTools();
    this.boardState = boardState;
    this.readOnly = boardState.readonly;
    this.canWrite = boardState.canWrite;

    const hideEditingTools = this.readOnly && !this.canWrite;
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
