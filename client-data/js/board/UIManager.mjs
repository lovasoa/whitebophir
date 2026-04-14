/**
 * Manages palette, menu, and connected users UI.
 */
export class UIManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.boardStatusIndicator = document.getElementById("boardStatusIndicator");
    this.boardStatusNotice = document.getElementById("boardStatusNotice");
  }

  updateToolUI(oldToolName, newToolName) {
    if (oldToolName) {
      const oldButton = document.getElementById(`toolID-${oldToolName}`);
      if (oldButton) oldButton.classList.remove("curTool");
    }
    const newButton = document.getElementById(`toolID-${newToolName}`);
    if (newButton) newButton.classList.add("curTool");
  }

  setStatus(status, isError = false) {
    if (this.boardStatusIndicator) {
      this.boardStatusIndicator.className = `board-status-indicator ${status} ${isError ? "error" : ""}`;
    }
  }

  // Connected users UI logic from board.js would be moved here
}
