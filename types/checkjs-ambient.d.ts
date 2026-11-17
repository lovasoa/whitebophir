export {};

declare global {
  const io: {
    connect(
      path: string,
      params: import("../types/app-runtime").SocketParams,
    ): import("../types/app-runtime").AppSocket;
  };
  const turnstile: import("../types/app-runtime").TurnstileGlobal;
  interface Window {
    WBOApp: import("../types/app-runtime").AppToolsState;
    socketio_extra_headers?: import("../types/app-runtime").SocketHeaders;
    __lastAlert?: string | null;
    __receivedBroadcasts?: import("../types/app-runtime").BoardMessage[];
    __turnstileOptions?:
      | import("../types/app-runtime").TurnstileRenderOptions
      | null;
    turnstile?: import("../types/app-runtime").TurnstileGlobal;
  }

  interface HTMLElement {
    text?: string;
  }
}
