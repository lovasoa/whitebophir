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
import { ToolCodes } from "../client-data/tools/tool-order.js";

export type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type ToolCodeMap = typeof ToolCodes;
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
  data: LiveBoardMessage;
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
    retryAfterMs?: number;
    reason?: string;
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
    (eventName: string, handler: (...args: any[]) => void): void;
  };
  emit: {
    <K extends keyof ClientSocketOutgoingEventArgs>(
      eventName: K,
      ...args: ClientSocketOutgoingEventArgs[K]
    ): void;
    (eventName: string, ...args: any[]): void;
  };
  connect?: () => void;
  disconnect?: () => void;
  destroy?: () => void;
  once?: (eventName: string, handler: (...args: any[]) => void) => void;
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

export type OptimisticJournalEntry = {
  readonly clientMutationId: string;
  readonly affectedIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly dependencyItemIds: readonly string[];
  readonly rollback: OptimisticRollback;
  readonly message: LiveBoardMessage;
};

export type OptimisticJournalEntryInput = Omit<
  OptimisticJournalEntry,
  "dependencyItemIds"
> & {
  readonly dependencyItemIds?: readonly string[];
};

export type OptimisticJournalState = {
  /** Takes ownership of entry.message and entry.rollback. Do not mutate them after append. */
  append: (entry: OptimisticJournalEntryInput) => OptimisticJournalEntry;
  dependencyMutationIdsForItemIds: (itemIds: string[]) => string[];
  promote: (clientMutationId: string) => OptimisticJournalEntry[];
  reject: (clientMutationId: string) => OptimisticJournalEntry[];
  rejectByInvalidatedIds: (
    invalidatedIds: string[],
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

export type ToolModule<T = unknown> = PointerListenerMap<
  ToolModulePointerListener<T>
> & {
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
  boot: (ctx: ToolBootContext) => Promise<T> | T;
  draw?: (state: T, message: BoardMessage, isLocal: boolean) => void;
  normalizeServerRenderedElement?: (state: T, element: SVGElement) => void;
  onMessage?: (state: T, message: BoardMessage) => void;
  onstart?: (state: T, oldTool: MaybeMountedAppTool) => void;
  onquit?: (state: T, newTool: MountedAppTool) => void;
  onSocketDisconnect?: (state: T) => void;
  onMutationRejected?: (
    state: T,
    message: BoardMessage,
    reason?: string,
  ) => void;
  onSizeChange?: (state: T, size: number) => void;
  getTouchPolicy?: (state: T) => ToolTouchPolicy;
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
  installHashObservers: () => void;
  applyFromHash: () => void;
};

/** Board DOM before the streamed SVG baseline has been attached. */
export type DetachedBoardDomModule = {
  readonly status: "detached";
};

/** Board DOM after the app can safely boot drawing tools. */
export type AttachedBoardDomModule = {
  readonly status: "attached";
  readonly board: HTMLElement;
  readonly svg: SVGSVGElement;
  readonly drawingArea: Element;
};

export type BoardDomModule = DetachedBoardDomModule | AttachedBoardDomModule;

/** Stable board identity parsed from the current board URL. */
export type AppIdentityModule = {
  readonly boardName: string;
  readonly token: string | null;
};

/** Boot-time server configuration exposed through a single runtime module. */
export type AppConfigModule = {
  readonly serverConfig: ServerConfig;
};

/** Server-issued board access state and derived permissions. */
export type AppAccessModule = {
  readonly boardState: AppBoardState;
  readonly readOnly: boolean;
  readonly canWrite: boolean;
};

export type AppInitialPreferences = {
  readonly tool: string;
  readonly color: string;
  readonly size: number;
  readonly opacity: number;
};

/** Current drawing preferences and their UI bindings. */
export type AppPreferenceModule = {
  readonly colorPresets: ColorPreset[];
  colorChooser: HTMLInputElement | null;
  colorButtonsInitialized: boolean;
  currentColor: string;
  currentSize: number;
  currentOpacity: number;
  readonly initial: AppInitialPreferences;
  readonly colorChangeHandlers: ((color: string) => void)[];
  readonly sizeChangeHandlers: ((size: number) => void)[];
};

/** Board status UI state and timers. */
export type AppStatusModule = {
  rateLimitNoticeTimer: number | null;
  boardStatusTimer: number | null;
  explicitBoardStatus: ExplicitBoardStatus;
};

/** Turnstile validation state and protected-write queue. */
export type AppTurnstileModule = {
  validatedUntil: number;
  widgetId: unknown | null;
  refreshTimeout: number | null;
  retryTimeout: number | null;
  pending: boolean;
  pendingWrites: PendingWrite[];
  overlayTimeout: number | null;
};

/** Connected-user presence state for the board chrome. */
export type AppPresenceModule = {
  users: ConnectedUserMap;
  panelOpen: boolean;
};

/** Optimistic local mutation journal and rollback bookkeeping. */
export type AppOptimisticModule = {
  journal: OptimisticJournalState;
};

/** Tool-facing board access. Tool code gets attached DOM and board math only. */
export type ToolBoardRuntimeModule = AttachedBoardDomModule & {
  createSVGElement: (name: string, attrs?: SVGElementAttributes) => SVGElement;
  toBoardCoordinate: (value: unknown) => number;
  pageCoordinateToBoard: (value: unknown) => number;
};

/** Tool-facing write channel. Owns message send/queue semantics. */
export type ToolWriteRuntimeModule = {
  /** Takes ownership of message. Callers must not mutate it after sending. */
  drawAndSend: (message: LiveBoardMessage) => boolean | undefined;
  /** Takes ownership of message. Callers must not mutate it after sending. */
  send: (message: LiveBoardMessage) => boolean | undefined;
  canBufferWrites: () => boolean;
  whenBoardWritable: () => Promise<void>;
};

/** Tool-facing board identity. */
export type ToolIdentityRuntimeModule = AppIdentityModule;

/** Tool-facing current drawing preferences. */
export type ToolPreferenceRuntimeModule = {
  getColor: () => string;
  getSize: () => number;
  setSize: (size?: number | string | null | undefined) => number;
  getOpacity: () => number;
};

/** Tool-facing rate-limit lookup. */
export type ToolRateLimitRuntimeModule = {
  getEffectiveRateLimit: (kind: RateLimitKind) => RateLimitDefinition;
};

/** Tool-facing UI state that may change during a session. */
export type ToolUiRuntimeModule = {
  getCurrentTool: () => MaybeMountedAppTool;
  changeTool: (toolName: string) => boolean | undefined;
  shouldShowMarker: () => boolean;
  shouldShowMyCursor: () => boolean;
};

/** Tool-facing server configuration. */
export type ToolConfigRuntimeModule = AppConfigModule;

/** Tool-facing id generation. */
export type ToolIdRuntimeModule = {
  generateUID: (prefix?: string, suffix?: string) => string;
};

/** Tool-facing render side effects owned by the board runtime. */
export type ToolRenderRuntimeModule = {
  markDrawingEvent: () => void;
};

/** Tool-facing message replay helper for tools that synthesize child messages. */
export type ToolMessageRuntimeModule = {
  messageForTool: (message: BoardMessage) => void;
};

/** Tool-facing permission state. */
export type ToolPermissionRuntimeModule = {
  canWrite: () => boolean;
};

/** Restricted runtime modules passed to tool boot. */
export type ToolRuntimeModules = {
  readonly board: ToolBoardRuntimeModule;
  readonly viewport: ViewportController;
  readonly writes: ToolWriteRuntimeModule;
  readonly identity: ToolIdentityRuntimeModule;
  readonly preferences: ToolPreferenceRuntimeModule;
  readonly rateLimits: ToolRateLimitRuntimeModule;
  readonly ui: ToolUiRuntimeModule;
  readonly config: ToolConfigRuntimeModule;
  readonly ids: ToolIdRuntimeModule;
  readonly rendering: ToolRenderRuntimeModule;
  readonly messages: ToolMessageRuntimeModule;
  readonly permissions: ToolPermissionRuntimeModule;
};

/**
 * Transitional root runtime while board.js is being split into modules.
 * New state should land inside a documented module instead of adding another
 * unrelated top-level field.
 */
export type AppToolsState = {
  i18n: { t: (s: string) => string };
  identity: AppIdentityModule;
  config: AppConfigModule;
  access: AppAccessModule;
  preferences: AppPreferenceModule;
  status: AppStatusModule;
  turnstile: AppTurnstileModule;
  presence: AppPresenceModule;
  optimistic: AppOptimisticModule;
  scale: number;
  viewport: ViewportController;
  drawToolsAllowed: boolean | null;
  dom: BoardDomModule;
  board: HTMLElement | null;
  svg: SVGSVGElement | null;
  drawingArea: Element | null;
  curTool: MaybeMountedAppTool;
  drawingEvent: boolean;
  hasAuthoritativeBoardSnapshot: boolean;
  authoritativeSeq: number;
  preSnapshotMessages: IncomingBroadcast[];
  incomingBroadcastQueue: IncomingBroadcast[];
  processingIncomingBroadcast: boolean;
  showMarker: boolean;
  showOtherCursors: boolean;
  showMyCursor: boolean;
  socket: AppSocket | null;
  hasConnectedOnce: boolean;
  bufferedWrites: BufferedWrite[];
  bufferedWriteTimer: number | null;
  writeReadyWaiters: Array<() => void>;
  rateLimitedUntil: number;
  localRateLimitedUntil: number;
  awaitingBoardSnapshot: boolean;
  connectionState: BoardConnectionState;
  localRateLimitStates: RateLimitStates;
  socketIOExtraHeaders: SocketHeaders | null;
  refreshBaselineBeforeConnect: boolean;
  list: MountedToolRegistry;
  bootedToolPromises: ToolNameMap<MountedAppToolPromise>;
  bootedToolNames: Set<string>;
  pendingMessages: PendingMessages;
  unreadMessagesCount: number;
  messageHooks: MessageHook[];
  getRateLimitDefinition: (
    kind: RateLimitKind,
  ) => ConfiguredRateLimitDefinition;
  getBufferedWriteCosts: (message: LiveBoardMessage) => RateLimitCosts;
  clearBufferedWriteTimer: () => void;
  clearRateLimitNoticeTimer: () => void;
  clearBoardStatusTimer: () => void;
  isWritePaused: (now?: number) => boolean;
  canBufferWrites: () => boolean;
  whenBoardWritable: () => Promise<void>;
  showRateLimitNotice: (message: string, retryAfterMs: number) => void;
  hideRateLimitNotice: () => void;
  showBoardStatus: (view: BoardStatusView, durationMs?: number) => void;
  clearBoardStatus: () => void;
  getBoardStatusView: () => BoardStatusView;
  syncWriteStatusIndicator: () => void;
  clearBoardCursors: () => void;
  resetBoardViewport: () => void;
  restoreLocalCursor: () => void;
  captureOptimisticRollback: (message: LiveBoardMessage) => OptimisticRollback;
  collectOptimisticDependencyMutationIds: (
    message: LiveBoardMessage,
  ) => string[];
  trackOptimisticMutation: (
    message: LiveBoardMessage,
    rollback: OptimisticRollback,
  ) => void;
  restoreOptimisticRollback: (rollback: OptimisticRollback) => void;
  applyRejectedOptimisticEntries: (rejected: OptimisticJournalEntry[]) => void;
  promoteOptimisticMutation: (clientMutationId: string) => void;
  rejectOptimisticMutation: (clientMutationId: string, reason?: string) => void;
  pruneOptimisticMutationsForAuthoritativeMessage: (
    message: BoardMessage,
  ) => void;
  applyAuthoritativeBaseline: (baseline: AuthoritativeBaseline) => void;
  refreshAuthoritativeBaseline: () => Promise<void>;
  resetLocalRateLimitState: (kind: RateLimitKind, now?: number) => void;
  resetAllLocalRateLimitStates: (now?: number) => void;
  canEmitBufferedWrite: (bufferedWrite: BufferedWrite, now: number) => boolean;
  consumeBufferedWriteBudget: (
    bufferedWrite: BufferedWrite,
    now: number,
  ) => void;
  getBufferedWriteWaitMs: (bufferedWrite: BufferedWrite, now: number) => number;
  getBufferedWriteFlushSafetyMs: (waitMs: number) => number;
  scheduleBufferedWriteFlush: () => void;
  flushBufferedWrites: () => void;
  /** Takes ownership of message. Callers must not mutate it after queueing. */
  enqueueBufferedWrite: (message: LiveBoardMessage) => void;
  /** Takes ownership of message. Callers must not mutate it after sending. */
  sendBufferedWrite: (message: LiveBoardMessage) => boolean;
  discardBufferedWrites: () => void;
  beginAuthoritativeResync: () => void;
  /** Takes ownership of data. Callers must not mutate it after queueing. */
  queueProtectedWrite: (data: LiveBoardMessage) => void;
  flushTurnstilePendingWrites: () => void;
  getToolAssetUrl: (toolName: string, assetFile: string) => string;
  mountTool: (
    toolModule: ToolModule,
    toolState: unknown,
    toolName: string,
  ) => MaybeMountedAppTool;
  bootTool: (toolName: string) => MountedAppToolPromise;
  activateTool: (toolName: string) => Promise<boolean>;
  addToolListeners: (tool: MountedAppTool) => void;
  removeToolListeners: (tool: MountedAppTool) => void;
  syncActiveToolInputPolicy: () => void;
  /** Takes ownership of message. Callers must not mutate it after sending. */
  drawAndSend: (message: LiveBoardMessage) => boolean | undefined;
  /** Takes ownership of message. Callers must not mutate it after sending. */
  send: (message: LiveBoardMessage) => boolean | undefined;
  getColor: () => string;
  setColor: (color: string) => void;
  getSize: () => number;
  setSize: (size?: number | string | null | undefined) => number;
  getOpacity: () => number;
  getScale: () => number;
  setScale: (scale: number) => number;
  applyViewportFromHash: () => void;
  installViewportHashObservers: () => void;
  installViewportController: () => void;
  resizeCanvas: MessageHook;
  createSVGElement: (name: string, attrs?: SVGElementAttributes) => SVGElement;
  generateUID: (prefix?: string, suffix?: string) => string;
  getEffectiveRateLimit: (kind: RateLimitKind) => RateLimitDefinition;
  isTurnstileValidated: () => boolean;
  clearTurnstileRefreshTimeout: () => void;
  clearTurnstileRetryTimeout: () => void;
  scheduleTurnstileRefresh: (validationWindowMs: number) => void;
  scheduleTurnstileRetry: (reason: string, delayMs?: number) => void;
  setTurnstileValidation: (result: unknown) => void;
  normalizeTurnstileAck: (result: unknown) => TurnstileAck;
  ensureTurnstileElements: () => { overlay: HTMLElement };
  showTurnstileOverlay: (delay: number) => void;
  hideTurnstileOverlay: () => void;
  refreshTurnstile: () => void;
  showTurnstileWidget: () => void;
  showUnknownMutationError: (reason?: string) => void;
  shouldDisableTool: (toolName: string) => boolean;
  shouldDisplayTool: (toolName: string) => boolean;
  canUseTool: (toolName: string) => boolean;
  syncToolDisabledState: (toolName: string) => void;
  syncDrawToolAvailability: (force: boolean) => void;
  setBoardState: (state: unknown) => void;
  toBoardCoordinate: (value: unknown) => number;
  pageCoordinateToBoard: (value: unknown) => number;
  renderConnectedUsers: () => void;
  setConnectedUsersPanelOpen: (open: boolean) => void;
  upsertConnectedUser: (user: ConnectedUser) => void;
  removeConnectedUser: (socketId: string) => void;
  updateConnectedUsersFromActivity: (
    userId: string | undefined,
    message: BoardMessage,
  ) => void;
  updateCurrentConnectedUserFromActivity: (message: BoardMessage) => void;
  initConnectedUsersUI: () => void;
  isBlocked: (tool: MountedAppTool) => boolean;
  applyHooks: <T>(hooks: ((value: T) => void)[], object: T) => void;
  positionElement: (elem: HTMLElement, x: number, y: number) => void;
  change: (toolName: string) => boolean | undefined;
  messageForTool: (message: BoardMessage) => void;
  newUnreadMessage: () => void;
  startConnection: () => void;
  resolveAssetPath: (assetPath: string) => string;
};

export type MountedAppToolsState = AppToolsState & {
  dom: AttachedBoardDomModule;
  board: HTMLElement;
  svg: SVGSVGElement;
  drawingArea: Element;
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
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "compact" | "flexible";
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
