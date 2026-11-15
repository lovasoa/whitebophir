import type {
  ReportUserPayload,
  TurnstileRenderOptions,
} from "../types/app-runtime";

declare global {
  interface Window {
    __reportedUsers?: ReportUserPayload[];
    __turnstileMock?: {
      callbacks: TurnstileRenderOptions | null;
      complete(token: string): void;
      fail(errorCode: string): void;
      show(): void;
    };
  }
}
