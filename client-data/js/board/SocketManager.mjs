/**
 * Handles connection, buffered writes, and message dispatch.
 */
export class SocketManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.socket = null;
    this.bufferedWrites = [];
    this.bufferedWriteTimer = null;
    this.hasConnectedOnce = false;
  }

  async connect(baseUrl, boardName, token, extraHeaders) {
    const { connection } = await import("../board_transport.js");
    const socketParams = connection.buildSocketParams(
      baseUrl,
      connection.normalizeSocketIOExtraHeaders(extraHeaders),
      token,
    );

    this.socket = globalThis.io(baseUrl, socketParams);

    this.socket.on("connect", () => {
      this.hasConnectedOnce = true;
      this.runtime.onSocketConnect();
    });

    this.socket.on("disconnect", (reason) => {
      this.runtime.onSocketDisconnect(reason);
    });

    this.socket.on("message", (message) => {
      this.runtime.onSocketMessage(message);
    });

    this.socket.on("board_snapshot", (snapshot) => {
      this.runtime.onBoardSnapshot(snapshot);
    });

    // Other socket events...
  }

  send(data, costs = { general: 1, constructive: 0, destructive: 0 }) {
    if (this.runtime.readOnly) return;

    this.bufferedWrites.push({
      message: { board: this.runtime.boardName, data },
      costs,
    });

    if (!this.bufferedWriteTimer) {
      this.bufferedWriteTimer = setTimeout(() => this.flush(), 10);
    }
  }

  flush() {
    this.bufferedWriteTimer = null;
    if (this.bufferedWrites.length === 0) return;

    const writes = this.bufferedWrites;
    this.bufferedWrites = [];

    if (this.socket && this.socket.connected) {
      this.socket.emit("multiple_messages", writes);
    }
  }

  emit(event, ...args) {
    if (this.socket) {
      this.socket.emit(event, ...args);
    }
  }
}
