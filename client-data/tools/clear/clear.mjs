export function createTool(runtime) {
  function clearBoard() {
    const msg = {
      type: "clear",
      id: "",
      token: runtime.token,
    };
    const clearTool = runtime.tools ? runtime.tools.list.Clear : undefined;
    if (!clearTool && runtime.tools) {
      throw new Error("Clear: tool is not registered.");
    }
    // If using the runtime API for sending:
    runtime.drawAndSend(msg, clearTool);
  }

  function draw(_data) {
    if (!runtime.drawingArea) {
      throw new Error("Clear: Missing drawing area.");
    }
    runtime.drawingArea.innerHTML = "";
  }

  return {
    name: "Clear",
    shortcut: "c",
    listeners: {},
    icon: "tools/clear/clear.svg",
    oneTouch: true,
    onstart: clearBoard,
    draw: draw,
    mouseCursor: "crosshair",
  };
}
