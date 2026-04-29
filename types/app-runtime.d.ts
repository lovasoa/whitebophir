import { MutationType } from "../client-data/js/mutation_type.js";
import { SocketEvents } from "../client-data/js/socket_events.js";
import type * as ClearTool from "../client-data/tools/clear/index.js";
import type * as CursorTool from "../client-data/tools/cursor/index.js";
import type * as EllipseTool from "../client-data/tools/ellipse/index.js";
import type * as EraserTool from "../client-data/tools/eraser/index.js";
import type * as HandTool from "../client-data/tools/hand/index.js";
import type * as PencilTool from "../client-data/tools/pencil/index.js";
import type * as RectangleTool from "../client-data/tools/rectangle/index.js";
import type * as StraightLineTool from "../client-data/tools/straight-line/index.js";
import type * as TextTool from "../client-data/tools/text/index.js";
import { TOOL_CODE_BY_ID } from "../client-data/tools/tool-order.js";

export type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type ToolCodeMap = typeof TOOL_CODE_BY_ID;
type MutationTypeMap = typeof MutationType;
type SocketEventMap = typeof SocketEvents;

export type ToolCode = ToolCodeMap[keyof ToolCodeMap];
export type MessageType = MutationTypeMap[keyof MutationTypeMap];
export type SocketEventName = SocketEventMap[keyof SocketEventMap];

export type MessageMetadata = {
  seq?: number;
  socket?: string;
  userId?: string;
  clientMutationId?: string;
};

export type RequiredPointMessageFields = {
  x: number;
  y: number;
};

export type ToolMessageFields = {
  tool: ToolCode;
};

export type IdentifiedMessageFields = {
  id: string;
};

export type CopiedMessageFields = IdentifiedMessageFields & {
  newid: string;
};

export type MessageChildren<TChild = unknown> = {
  _children: TChild[];
};

type WithMessageMetadata<T> = MessageMetadata & T;

export type PencilCreateMessage =
  WithMessageMetadata<PencilTool.PencilCreateMessage>;

export type PencilAppendMessage =
  WithMessageMetadata<PencilTool.PencilAppendMessage>;

export type StraightLineCreateMessage =
  WithMessageMetadata<StraightLineTool.StraightLineCreateMessage>;

export type StraightLineUpdateMessage =
  WithMessageMetadata<StraightLineTool.StraightLineUpdateMessage>;

export type RectangleCreateMessage =
  WithMessageMetadata<RectangleTool.RectangleCreateMessage>;

export type RectangleUpdateMessage =
  WithMessageMetadata<RectangleTool.RectangleUpdateMessage>;

export type EllipseCreateMessage =
  WithMessageMetadata<EllipseTool.EllipseCreateMessage>;

export type EllipseUpdateMessage =
  WithMessageMetadata<EllipseTool.EllipseUpdateMessage>;

export type TextCreateMessage = WithMessageMetadata<TextTool.TextCreateMessage>;

export type TextUpdateMessage = WithMessageMetadata<TextTool.TextUpdateMessage>;

export type EraserDeleteMessage =
  WithMessageMetadata<EraserTool.EraserDeleteMessage>;

export type HandUpdateChildMessage = HandTool.HandUpdateChildMessage;

export type HandDeleteChildMessage = HandTool.HandDeleteChildMessage;

export type HandCopyChildMessage = HandTool.HandCopyChildMessage;

export type HandChildMessage = HandTool.HandChildMessage;

export type ToolOwnedChildMessage = HandChildMessage;

export type HandUpdateMessage = WithMessageMetadata<HandTool.HandUpdateMessage>;

export type HandDeleteMessage = WithMessageMetadata<HandTool.HandDeleteMessage>;

export type HandCopyMessage = WithMessageMetadata<HandTool.HandCopyMessage>;

export type HandBatchMessage = WithMessageMetadata<HandTool.HandBatchMessage>;

export type HandDrawMessage = HandTool.HandDrawMessage;

export type HandRenderableMessage = HandTool.HandRenderableMessage;

export type ClearMessage = WithMessageMetadata<ClearTool.ClearMessage>;

export type CursorMessage = WithMessageMetadata<CursorTool.CursorMessage>;

export type BoardMessage =
  | PencilCreateMessage
  | PencilAppendMessage
  | StraightLineCreateMessage
  | StraightLineUpdateMessage
  | RectangleCreateMessage
  | RectangleUpdateMessage
  | EllipseCreateMessage
  | EllipseUpdateMessage
  | TextCreateMessage
  | TextUpdateMessage
  | EraserDeleteMessage
  | HandUpdateMessage
  | HandDeleteMessage
  | HandCopyMessage
  | HandBatchMessage
  | ClearMessage
  | CursorMessage;

export type LiveBoardMessage = BoardMessage;

export type ClientTrackedMessage = LiveBoardMessage &
  Required<Pick<MessageMetadata, "clientMutationId">>;

export type ToolOwnedBatchMessage = HandBatchMessage;

export type MessageWithColor = Extract<BoardMessage, { color: string }>;

export type MessageWithSize = Extract<BoardMessage, { size: number }>;

export type MessageWithPoint = Extract<
  BoardMessage,
  RequiredPointMessageFields
>;

export type PencilReplayParent = Pick<PencilCreateMessage, "id" | "tool">;

export type PencilChildPoint = RequiredPointMessageFields;

// Live single-mutation frame. Connection replay batches intentionally strip this
// frame and send only ordered child mutations between fromSeq and seq.
export type SequencedMutationBroadcast = {
  seq: number;
  acceptedAtMs: number;
  mutation: LiveBoardMessage;
};

export type AuthoritativeReplayBatch = {
  type: MutationTypeMap["BATCH"];
  fromSeq: number;
  seq: number;
  _children: BoardMessage[];
};

export type ReplayMessage = BoardMessage | AuthoritativeReplayBatch;

export type IncomingBroadcast =
  | BoardMessage
  | SequencedMutationBroadcast
  | AuthoritativeReplayBatch;

export type PendingWrite = {
  data: ClientTrackedMessage;
};

export type BufferedWrite = {
  message: LiveBoardMessage;
  costs: RateLimitCosts;
};

export type RateLimitWindowState = {
  windowStart: number;
  count: number;
  lastSeen: number;
};

export type RateLimitKind = "general" | "constructive" | "destructive" | "text";

export type RateLimitKindMap<T> = {
  [key in RateLimitKind]: T;
};

export type RateLimitCosts = RateLimitKindMap<number>;

export type RateLimitOverride = {
  limit?: number;
  periodMs?: number;
};

export type RateLimitOverrides = {
  [boardName: string]: RateLimitOverride;
};

export type RateLimitDefinitionOptions = {
  anonymousLimit?: number;
  overrides?: RateLimitOverrides;
};

export type BoardConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected";

export type ConfiguredRateLimitDefinition = RateLimitOverride &
  RateLimitDefinitionOptions;

export type RateLimitDefinition = Required<RateLimitOverride> &
  RateLimitDefinitionOptions;

export type RateLimitConfig = Partial<
  RateLimitKindMap<ConfiguredRateLimitDefinition>
>;

export type RateLimitStates = RateLimitKindMap<RateLimitWindowState>;

export type ToolNameMap<T> = {
  [toolName: string]: T;
};

export type PendingMessages = ToolNameMap<BoardMessage[]>;

export type PointerListenerMap<TListener> = {
  press?: TListener;
  move?: TListener;
  release?: TListener;
};

export type ToolPointerListener = (
  x: number,
  y: number,
  evt: MouseEvent | TouchEvent,
  isTouchEvent: boolean,
) => unknown;

export type ToolPointerListeners = PointerListenerMap<ToolPointerListener>;

export type CompiledToolListener = ((evt: Event) => unknown) & {
  target?: EventTarget | null;
};

export type ToolListenerOptions = AddEventListenerOptions;

export type CompiledToolListeners = {
  [eventName: string]: CompiledToolListener;
};

export type ToolSecondaryMode = {
  name: string;
  icon: string;
  active: boolean;
  switch?: () => void;
};

export type ToolTouchPolicy = "app-gesture" | "native-pan";

export type MaybeMountedAppTool = MountedAppTool | null;

export type MountedAppTool = PointerListenerMap<ToolPointerListener> & {
  name: string;
  shortcut?: string;
  icon: string;
  draw: (message: BoardMessage, isLocal: boolean) => void;
  normalizeServerRenderedElement?: (element: SVGElement) => void;
  serverRenderedElementSelector?: string;
  onMessage?: (message: BoardMessage) => void;
  cancelTouchGesture?: (evt: TouchEvent) => void;
  listeners: ToolPointerListeners;
  compiledListeners: CompiledToolListeners;
  onstart: (oldTool: MaybeMountedAppTool) => void;
  onquit: (newTool: MountedAppTool) => void;
  onSocketDisconnect: () => void;
  onMutationRejected?: (message: BoardMessage, reason?: string) => void;
  stylesheet?: string;
  oneTouch?: boolean;
  alwaysOn?: boolean;
  mouseCursor?: string;
  helpText?: string;
  secondary?: ToolSecondaryMode | null;
  onSizeChange?: (size: number) => void;
  getTouchPolicy?: () => ToolTouchPolicy;
  showMarker?: boolean;
  requiresWritableBoard?: boolean;
  touchListenerOptions?: ToolListenerOptions;
};

export type MountedAppToolPromise = Promise<MaybeMountedAppTool>;

export type MountedToolRegistry = ToolNameMap<MountedAppTool>;

export type AppBoardState = {
  readonly: boolean;
  canWrite: boolean;
};

export type MutationRejectedPayload = {
  clientMutationId?: string;
  reason: string;
};

export type ConnectedUser = {
  socketId: string;
  userId: string;
  name: string;
  color: string;
  size: number;
  lastTool: string;
  lastFocusX?: number;
  lastFocusY?: number;
  lastActivityAt?: number;
  pulseMs?: number;
  pulseUntil?: number;
  reported?: boolean;
  pulseTimeoutId?: number | null;
};

export type ConnectedUserMap = {
  [socketId: string]: ConnectedUser;
};

export type UserLeftPayload = {
  socketId: string;
};

export type ClientSocketIncomingEventMap = {
  [SocketEvents.BOARDSTATE]: AppBoardState;
  [SocketEvents.BROADCAST]: IncomingBroadcast;
  [SocketEvents.CONNECT]: undefined;
  [SocketEvents.CONNECT_ERROR]: {
    message?: string;
    data?: {
      reason?: string;
      latestSeq?: number;
      minReplayableSeq?: number;
    };
  };
  [SocketEvents.DISCONNECT]: string;
  [SocketEvents.ERROR]: unknown;
  [SocketEvents.MUTATION_REJECTED]: MutationRejectedPayload;
  [SocketEvents.RATE_LIMITED]: {
    event: string;
    kind: RateLimitKind;
    limit: number;
    periodMs: number;
    retryAfterMs: number;
  };
  [SocketEvents.USER_JOINED]: ConnectedUser;
  [SocketEvents.USER_LEFT]: UserLeftPayload;
};

export type ReportUserPayload = {
  socketId?: string;
};

export type TurnstileSuccessAck = {
  success: true;
  validationWindowMs?: unknown;
  validatedUntil?: unknown;
};

export type TurnstileFailureAck = {
  success: false;
};

export type TurnstileAck = TurnstileSuccessAck | TurnstileFailureAck;

export type ClientSocketOutgoingEventArgs = {
  [SocketEvents.BROADCAST]: [message: LiveBoardMessage];
  [SocketEvents.REPORT_USER]: [payload: ReportUserPayload];
  [SocketEvents.TURNSTILE_TOKEN]: [
    token: string,
    ack?: (result: unknown) => void,
  ];
};

export type AppSocket = {
  id?: string;
  connected?: boolean;
  on: {
    <K extends keyof ClientSocketIncomingEventMap>(
      eventName: K,
      handler: ClientSocketIncomingEventMap[K] extends undefined
        ? () => void
        : (payload: ClientSocketIncomingEventMap[K]) => void,
    ): void;
    (eventName: string, handler: (...args: unknown[]) => void): void;
  };
  emit: {
    <K extends keyof ClientSocketOutgoingEventArgs>(
      eventName: K,
      ...args: ClientSocketOutgoingEventArgs[K]
    ): void;
    (eventName: string, ...args: unknown[]): void;
  };
  connect: () => void;
  disconnect?: () => void;
  destroy?: () => void;
  once?: (eventName: string, handler: (...args: unknown[]) => void) => void;
  io?: { engine?: { close: () => void }; opts?: { query?: string } };
};

export type MessageHook = (message: BoardMessage) => void;

export type ColorPreset = {
  color: string;
  key?: string;
};

export type BoardStatusView = {
  hidden: boolean;
  state: "paused" | "hidden" | "reconnecting" | "buffering";
  title: string;
  detail: string;
};

export type ExplicitBoardStatus = BoardStatusView | null;

export type AuthoritativeBaseline = {
  seq: number;
  readonly: boolean;
  drawingAreaMarkup: string;
};

export type OptimisticItemSnapshot = {
  readonly id: string;
  readonly outerHTML: string | null;
  readonly nextSiblingId: string | null;
};

export type OptimisticRollback =
  | {
      readonly kind: "drawing-area";
      readonly markup: string;
    }
  | {
      readonly kind: "items";
      readonly snapshots: readonly OptimisticItemSnapshot[];
    };

export type OptimisticItemIdSet = ReadonlySet<string>;
export type OptimisticMutationIdSet = ReadonlySet<string>;

export type OptimisticJournalEntry = {
  readonly clientMutationId: string;
  readonly affectedIds: OptimisticItemIdSet;
  readonly dependsOn: OptimisticMutationIdSet;
  readonly dependencyItemIds: OptimisticItemIdSet;
  readonly rollback: OptimisticRollback;
  readonly message: ClientTrackedMessage;
};

export type OptimisticJournalEntryInput = {
  readonly affectedIds: OptimisticItemIdSet;
  readonly dependsOn: OptimisticMutationIdSet;
  readonly dependencyItemIds?: OptimisticItemIdSet;
  readonly rollback: OptimisticRollback;
  readonly message: ClientTrackedMessage;
};

export type OptimisticJournalState = {
  /** Takes ownership of entry.message and entry.rollback. Do not mutate them after append. */
  append: (entry: OptimisticJournalEntryInput) => OptimisticJournalEntry;
  dependencyMutationIdsForItemIds: (
    itemIds: OptimisticItemIdSet,
  ) => OptimisticMutationIdSet;
  promote: (clientMutationId: string) => OptimisticJournalEntry[];
  reject: (clientMutationId: string) => OptimisticJournalEntry[];
  rejectByInvalidatedIds: (
    invalidatedIds: readonly string[],
  ) => OptimisticJournalEntry[];
  reset: () => OptimisticJournalEntry[];
  list: () => OptimisticJournalEntry[];
  size: () => number;
};

export type ServerConfig = {
  RATE_LIMITS?: RateLimitConfig;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_VALIDATION_WINDOW_MS?: number | string;
  BLOCKED_TOOLS?: string[];
  BLOCKED_SELECTION_BUTTONS?: number[] | string[];
  MAX_CHILDREN?: number;
  MAX_BOARD_SIZE?: number;
  AUTO_FINGER_WHITEOUT?: boolean;
};

export type ToolBootContext = {
  runtime: ToolRuntimeModules;
  assetUrl: (assetFile: string) => string;
};

export type ToolModulePointerListener<T> = (
  state: T,
  x: number,
  y: number,
  evt: MouseEvent | TouchEvent,
  isTouchEvent: boolean,
) => unknown;

export type ToolRuntimeState = {
  mouseCursor?: string;
  secondary?: ToolSecondaryMode | null;
};

export type ToolModule<T = unknown> = {
  toolId: string;
  replaySafe?: boolean;
  shortcut?: string;
  oneTouch?: boolean;
  alwaysOn?: boolean;
  mouseCursor?: string;
  helpText?: string;
  secondary?: ToolSecondaryMode | null;
  showMarker?: boolean;
  requiresWritableBoard?: boolean;
  touchListenerOptions?: ToolListenerOptions;
  serverRenderedElementSelector?: string;
  press?(
    state: T,
    x: number,
    y: number,
    evt: MouseEvent | TouchEvent,
    isTouchEvent: boolean,
  ): unknown;
  move?(
    state: T,
    x: number,
    y: number,
    evt: MouseEvent | TouchEvent,
    isTouchEvent: boolean,
  ): unknown;
  release?(
    state: T,
    x: number,
    y: number,
    evt: MouseEvent | TouchEvent,
    isTouchEvent: boolean,
  ): unknown;
  cancelTouchGesture?(state: T, evt: TouchEvent): unknown;
  boot(ctx: ToolBootContext): Promise<T> | T;
  draw(state: T, message: BoardMessage, isLocal: boolean): void;
  normalizeServerRenderedElement?(state: T, element: SVGElement): void;
  onMessage?(state: T, message: BoardMessage): void;
  onstart?(state: T, oldTool: MaybeMountedAppTool): void;
  onquit?(state: T, newTool: MountedAppTool): void;
  onSocketDisconnect?(state: T): void;
  onMutationRejected?(state: T, message: BoardMessage, reason?: string): void;
  onSizeChange?(state: T, size: number): void;
  getTouchPolicy?(state: T): ToolTouchPolicy;
};

export type ViewportController = {
  setScale: (scale: number) => number;
  getScale: () => number;
  syncLayoutSize: () => void;
  setTouchPolicy: (policy: ToolTouchPolicy) => void;
  ensureBoardExtentAtLeast: (width: number, height: number) => boolean;
  ensureBoardExtentForPoint: (x: number, y: number) => boolean;
  ensureBoardExtentForBounds: (
    bounds: { maxX: number; maxY: number } | null | undefined,
  ) => boolean;
  pageCoordinateToBoard: (value: unknown) => number;
  panBy: (dx: number, dy: number) => void;
  panTo: (left: number, top: number) => void;
  zoomAt: (scale: number, pageX: number, pageY: number) => number;
  zoomBy: (factor: number, pageX: number, pageY: number) => number;
  beginPan: (clientX: number, clientY: number) => void;
  movePan: (clientX: number, clientY: number) => void;
  endPan: () => void;
  install: () => void;
  installTemporaryPan: () => () => void;
  installHashObservers: () => void;
  applyFromHash: () => void;
};

/** Board DOM before the streamed SVG baseline has been attached. */
export type DetachedBoardDomModule =
  import("../client-data/js/board_runtime_core.js").DetachedBoardDomRuntimeModule;

/** Board DOM after the app can safely boot drawing tools. */
export type AttachedBoardDomModule =
  import("../client-data/js/board_runtime_core.js").AttachedBoardDomRuntimeModule;

export type BoardDomActions =
  import("../client-data/js/board_runtime_core.js").BoardDomRuntimeActions;

export type BoardDomModule = DetachedBoardDomModule | AttachedBoardDomModule;

/** Stable board identity parsed from the current board URL. */
export type AppIdentityModule =
  import("../client-data/js/board_runtime_core.js").IdentityModule;

/** Boot-time server configuration exposed through a single runtime module. */
export type AppConfigModule =
  import("../client-data/js/board_runtime_core.js").ConfigModule;

/** Page chrome wiring and boot-time shell controls. */
export type AppShellModule =
  import("../client-data/js/board_shell_module.js").BoardShellModule;

/** Server-issued board access state and derived permissions. */
export type AppAccessModule =
  import("../client-data/js/board_access_module.js").AccessModule;

export type AppInitialPreferences = {
  readonly tool: string;
  readonly color: string;
  readonly size: number;
  readonly opacity: number;
};

/** Current drawing preferences and their UI bindings. */
export type AppPreferenceModule =
  import("../client-data/js/board_runtime_core.js").PreferenceModule;

/** Board status UI state and timers. */
export type AppStatusModule =
  import("../client-data/js/board_status_module.js").StatusModule;

/** Turnstile validation state and protected-write queue. */
export type AppTurnstileModule =
  import("../client-data/js/board_turnstile.js").TurnstileModule;

/** Connected-user presence state for the board chrome. */
export type AppPresenceModule =
  import("../client-data/js/board_presence_module.js").PresenceModule;

/** Optimistic local mutation journal and rollback bookkeeping. */
export type AppOptimisticModule =
  import("../client-data/js/board_optimistic_module.js").OptimisticModule;

/** Local message hooks and unread-message badge state. */
export type AppMessageModule =
  import("../client-data/js/board_message_module.js").MessageModule;

/** Board viewport controller plus zoom-gated drawing-tool availability. */
export type AppViewportModule =
  import("../client-data/js/board_runtime_core.js").ViewportStateModule;

/** Authoritative baseline and incoming broadcast replay coordination. */
export type AppReplayModule =
  import("../client-data/js/board_replay_module.js").ReplayModule;

/** Socket.IO connection handle and lifecycle metadata. */
export type AppConnectionModule =
  import("../client-data/js/board_connection_module.js").ConnectionModule;

/** Buffered write queue and local/server write throttling state. */
export type AppWriteModule =
  import("../client-data/js/board_write_module.js").WriteModule;

/** Mounted tool registry, active tool, and boot/replay queues. */
export type AppToolRegistryModule =
  import("../client-data/js/board_tool_registry_module.js").ToolRegistryModule;

/** Pointer interaction and cursor/marker visibility flags. */
export type AppInteractionModule =
  import("../client-data/js/board_full_runtime_modules.js").InteractionModule;

/** Runtime asset URL resolution for board and tool modules. */
export type AppAssetModule =
  import("../client-data/js/board_full_runtime_modules.js").AssetModule;

/** Runtime id generation. */
export type AppIdModule =
  import("../client-data/js/board_full_runtime_modules.js").IdModule;

/** Config-derived rate-limit lookups and cost accounting. */
export type AppRateLimitModule =
  import("../client-data/js/board_full_runtime_modules.js").RateLimitModule;

/** Board-space coordinate conversion. */
export type AppCoordinateModule =
  import("../client-data/js/board_runtime_core.js").CoordinateModule;

/** Restricted runtime modules passed to tool boot. */
export type ToolRuntimeModules = ReturnType<
  typeof import("../client-data/js/board_tool_registry_module.js").createToolRuntimeModules
>;

/** Runtime root composed only of documented modules. */
export type AppToolsState = {
  i18n: import("../client-data/js/board_runtime_core.js").I18nModule;
  config: AppConfigModule;
  identity: AppIdentityModule;
  assets: AppAssetModule;
  toolRegistry: AppToolRegistryModule;
  turnstile: AppTurnstileModule;
  writes: AppWriteModule;
  status: AppStatusModule;
  replay: AppReplayModule;
  optimistic: AppOptimisticModule;
  connection: AppConnectionModule;
  rateLimits: AppRateLimitModule;
  viewportState: AppViewportModule;
  coordinates: AppCoordinateModule;
  access: AppAccessModule;
  dom: BoardDomModule;
  interaction: AppInteractionModule;
  presence: AppPresenceModule;
  messages: AppMessageModule;
  ids: AppIdModule;
  preferences: AppPreferenceModule;
  shell: AppShellModule;
  initialAuthoritativeSeq: number;
  attachDom: (
    board: HTMLElement,
    svg: SVGSVGElement,
    drawingArea: SVGGElement,
  ) => AttachedBoardDomModule;
};

export type MountedAppToolsState = AppToolsState & {
  dom: AttachedBoardDomModule & BoardDomActions;
};

export type SocketHeaders = {
  [name: string]: string;
};

export type SVGElementAttributes = {
  [key: string]: string | number | undefined;
};

export type DownloadCapture = {
  href: string | null;
  download: string | null;
};

export type TurnstileRenderOptions = {
  sitekey?: string;
  action?: string;
  appearance?: "always" | "execute" | "interaction-only";
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "compact" | "flexible";
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
  "error-callback"?: (error: unknown) => void;
  "timeout-callback"?: () => void;
  "expired-callback"?: () => void;
};

export type TurnstileGlobal = {
  render: (target: unknown, options: TurnstileRenderOptions) => string;
  remove: (widgetId?: unknown) => void;
  reset: (widgetId?: unknown) => void;
};

export type SocketParams = {
  path: string;
  reconnection: boolean;
  reconnectionDelay: number;
  autoConnect?: boolean;
  timeout: number;
  extraHeaders?: SocketHeaders;
  query?: string;
};
