import type { BoardMessage, ConnectedUser } from "./app-runtime";

export type MessageData = BoardMessage & {
  [key: string]: any;
};

export type NormalizedMessageData = BoardMessage & {
  tool: number;
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

export type TurnstileRejectedAck = {
  success: false;
};

export type TurnstileEventAck = TurnstileAck | TurnstileRejectedAck | true;

export type TurnstileAckCallback = (ack: TurnstileEventAck) => void;

export type TurnstileSiteverifyResult = {
  success?: boolean;
  hostname?: unknown;
  "error-codes"?: unknown;
  [key: string]: unknown;
};

export type ReportUserPayload = {
  socketId?: string;
};

export type ValidationStatus = { ok: true } | { ok: false; reason: string };

export type RejectedBroadcast = {
  ok: false;
  reason: string;
};

export type BroadcastResult =
  | {
      ok: true;
      value: NormalizedMessageData;
    }
  | RejectedBroadcast;

export type ConnectedUserPayload = ConnectedUser;

export type UserLeftPayload = {
  socketId: string;
};

export type BoardLike = {
  name: string;
  isReadOnly: () => boolean;
};
