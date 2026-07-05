import type RateLimitCommonType from "../client-data/js/rate_limit_common.js";
import type {
  AppToolsState,
  BoardMessage,
  DownloadCapture,
  ReportUserPayload,
  SocketHeaders,
  TurnstileGlobal,
  TurnstileRenderOptions,
} from "../types/app-runtime";

declare global {
  interface Window {
    WBOApp: AppToolsState;
    socketio_extra_headers?: SocketHeaders;
    __downloadCapture?: DownloadCapture | null;
    __downloadAnchorClicks?: number;
    __downloadBlob?: Blob;
    __receivedBroadcasts?: BoardMessage[];
    __reportedUsers?: ReportUserPayload[];
    __turnstileMock?: {
      callbacks: TurnstileRenderOptions | null;
      complete(token: string): void;
      fail(errorCode: string): void;
      show(): void;
    };
    __turnstileOptions?: TurnstileRenderOptions | null;
    turnstile?: TurnstileGlobal;
    RateLimitCommon?: typeof RateLimitCommonType;
  }
}
