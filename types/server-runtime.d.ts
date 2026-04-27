import type {
  BoardMessage,
  ConnectedUser,
  SequencedMutationBroadcast,
} from "./app-runtime";

export type ServerConfig = typeof import("../server/configuration.mjs");

export type HttpRequest = import("http").IncomingMessage;
export type HttpResponse = import("http").ServerResponse;

export type StaticFileServer = (
  request: HttpRequest,
  response: HttpResponse,
  next: (error?: unknown) => void,
) => void;

export type ServerRuntime = {
  config: ServerConfig;
  fileserver: StaticFileServer;
  errorPage: string;
  boardTemplate: import("../server/templating.mjs").BoardTemplate;
  indexTemplate: import("../server/templating.mjs").Template;
};

export type ObservedHttpRequest = {
  requestId?: string;
  run: (fn: () => void | Promise<void>) => void;
  setRoute: (route: string) => void;
  noteError: (error: unknown) => void;
  annotate: (fields: { [key: string]: unknown }) => void;
  setTraceAttributes: (fields: { [key: string]: unknown }) => void;
};

export type HttpRouteContext<
  Params extends Record<string, string> = Record<string, string>,
> = {
  request: HttpRequest;
  response: HttpResponse;
  runtime: ServerRuntime;
  observed: ObservedHttpRequest;
  url: URL;
  params: Params;
};

export type HttpRouteHandler<
  Params extends Record<string, string> = Record<string, string>,
> = (context: HttpRouteContext<Params>) => void | Promise<void>;

export type HttpRequestHandler = (context: {
  request: HttpRequest;
  response: HttpResponse;
  runtime: ServerRuntime;
}) => void;

export type SocketServerModule = {
  start: (app: import("http").Server, config: ServerConfig) => Promise<unknown>;
  shutdown?: () => Promise<void>;
};

export type ServerApp = import("http").Server & {
  shutdown?: () => Promise<void>;
};

export type MessageData = Partial<
  Record<
    | "tool"
    | "type"
    | "id"
    | "parent"
    | "newid"
    | "color"
    | "size"
    | "txt"
    | "clientMutationId"
    | "transform"
    | "_children",
    unknown
  >
>;

export type NormalizedMessageData = BoardMessage;

export type SocketRequest = {
  headers: { [key: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string };
};

export type AppSocket = import("socket.io").Socket & {
  boardName?: string;
  replayBootstrap?: unknown;
  turnstileValidatedUntil?: number;
  client: { request: SocketRequest };
  handshake: {
    query?: {
      board?: string;
      token?: string;
      tool?: string;
      color?: string;
      size?: string;
      baselineSeq?: string;
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

// Retained per-board replay-log state. BoardData owns the board scope, and
// sockets own source identity, so this type deliberately stores neither.
export type MutationLogEntry = {
  seq: number;
  acceptedAtMs: number;
  mutation: NormalizedMessageData;
};

export type SequencedMutationBroadcastData = SequencedMutationBroadcast & {
  mutation: NormalizedMessageData;
};
