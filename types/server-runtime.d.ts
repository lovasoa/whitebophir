import type { BoardMessage } from "./app-runtime";

export type MessageData = BoardMessage & {
  [key: string]: any;
};

export type SocketRequest = {
  headers: { [key: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string };
};

export type AppSocket = import("socket.io").Socket & {
  boardName?: string;
  turnstileValidatedUntil?: number;
  client: { request: SocketRequest };
  handshake: {
    query?: {
      board?: string;
      token?: string;
      userSecret?: string;
      tool?: string;
      color?: string;
      size?: string;
    };
  };
};

export type RateLimitState = {
  windowStart: number;
  count: number;
  lastSeen: number;
};

export type TurnstileAck = {
  success: true;
  validationWindowMs: number;
  validatedUntil: number | undefined;
};

export type ValidationStatus = { ok: true } | { ok: false; reason: string };

export type RejectedBroadcast = {
  ok: false;
  reason: string;
};

export type BroadcastResult =
  | {
      ok: true;
      value: MessageData;
    }
  | RejectedBroadcast;

export type BoardLike = {
  name: string;
  isReadOnly: () => boolean;
};
