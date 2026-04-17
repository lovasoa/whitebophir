import type {
  AppToolsState,
  BoardMessage,
  DownloadCapture,
  SocketHeaders,
  TurnstileGlobal,
  TurnstileRenderOptions,
} from "../types/app-runtime";

declare global {
  interface Window {
    Tools: AppToolsState;
    socketio_extra_headers?: SocketHeaders;
    __downloadCapture?: DownloadCapture | null;
    __downloadAnchorClicks?: number;
    __downloadBlob?: Blob;
    __receivedBroadcasts?: BoardMessage[];
    __turnstileOptions?: TurnstileRenderOptions | null;
    turnstile?: TurnstileGlobal;
  }
}
