import { SocketManager } from "./SocketManager.mjs";
import { ToolRegistry } from "./ToolRegistry.mjs";
import { UIManager } from "./UIManager.mjs";
import { ViewportManager } from "./ViewportManager.mjs";

/**
 * The central orchestrator for the whiteboard.
 */
export class BoardRuntime {
  constructor(deps) {
    this.boardName = deps.boardName;
    this.baseUrl = deps.baseUrl;
    this.token = deps.token;
    this.i18n = deps.i18n;
    this.serverConfig = deps.serverConfig;
    this.readOnly = deps.readOnly || false;

    this.boardElement = document.getElementById("board");
    this.svgElement = document.getElementById("canvas");
    this.drawingArea = document.getElementById("drawingArea");

    this.tools = new ToolRegistry(this);
    this.sockets = new SocketManager(this);
    this.ui = new UIManager(this);
    this.viewport = new ViewportManager(this);

    this.eventListeners = new Map();
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  emit(event, ...args) {
    const callbacks = this.eventListeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => {
        cb(...args);
      });
    }
  }

  async boot() {
    // 1. Register tools
    // 2. Connect sockets
    await this.sockets.connect(this.baseUrl, this.boardName, this.token, {});

    // 3. Initialize UI
    this.ui.setStatus("connecting");
  }

  onSocketConnect() {
    this.ui.setStatus("connected");
    console.log("Connected to board:", this.boardName);
  }

  onSocketDisconnect(reason) {
    this.ui.setStatus("disconnected", true);
    console.warn("Disconnected:", reason);
  }

  onSocketMessage(message) {
    const tool = this.tools.get(message.tool);
    if (tool && tool.draw) {
      tool.draw(message, false);
    }
  }

  onBoardSnapshot(snapshot) {
    // Replay snapshot
  }

  drawAndSend(data) {
    const tool = this.tools.getCurrentTool();
    if (tool && tool.draw) {
      tool.draw(data, true);
    }
    this.sockets.send(data);
  }

  // Utility methods used by tools
  generateUID(prefix) {
    return prefix + Math.random().toString(36).substr(2, 9);
  }

  getColor() {
    return document.getElementById("chooseColor").value;
  }

  getSize() {
    return parseInt(document.getElementById("chooseSize").value, 10);
  }

  getOpacity() {
    return parseFloat(document.getElementById("chooseOpacity").value);
  }

  createSVGElement(tagName) {
    return document.createElementNS("http://www.w3.org/2000/svg", tagName);
  }
}

export function createBoardRuntime(deps) {
  return new BoardRuntime(deps);
}
