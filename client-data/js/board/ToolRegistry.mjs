/**
 * Manages tool registration and switching.
 */
export class ToolRegistry {
  constructor(runtime) {
    this.runtime = runtime;
    this.tools = new Map();
    this.currentTool = null;
    this.readOnlyToolNames = new Set([
      "Hand",
      "Zoom",
      "Download",
      "Grid",
      "Clear",
    ]);
  }

  register(toolFactory) {
    const tool = toolFactory(this.runtime);
    this.tools.set(tool.name, tool);
    return tool;
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * @param {string} name
   */
  setCurrentTool(name) {
    const newTool = this.tools.get(name);
    if (!newTool) {
      console.error(`Tool ${name} not found`);
      return;
    }

    const oldTool = this.currentTool;
    if (oldTool && oldTool.onquit) {
      oldTool.onquit(newTool);
    }

    this.currentTool = newTool;

    if (newTool.onstart) {
      newTool.onstart(oldTool);
    }

    this.runtime.ui.updateToolUI(oldTool ? oldTool.name : null, newTool.name);

    // Update cursor
    if (newTool.mouseCursor) {
      this.runtime.viewport.setCursor(newTool.mouseCursor);
    } else {
      this.runtime.viewport.setCursor("default");
    }

    this.runtime.emit("toolChange", newTool);
  }

  getCurrentTool() {
    return this.currentTool;
  }

  isReadOnlyTool(name) {
    return this.readOnlyToolNames.has(name);
  }
}
