export type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type ToolCodeMap =
  typeof import("../client-data/tools/tool-order.js").ToolCodes;
type MutationTypeMap =
  typeof import("../client-data/js/mutation_type.js").MutationType;

export type ToolCode =
  typeof import("../client-data/tools/tool-order.js").ToolCodes[keyof ToolCodeMap];
export type MessageType = MutationTypeMap[keyof MutationTypeMap];
export type SocketEventName =
  typeof import("../client-data/js/socket_events.js").SocketEvents[keyof typeof import("../client-data/js/socket_events.js").SocketEvents];

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

export type PencilCreateMessage = WithMessageMetadata<
  import("../client-data/tools/pencil/index.js").PencilCreateMessage
>;

export type PencilAppendMessage = WithMessageMetadata<
  import("../client-data/tools/pencil/index.js").PencilAppendMessage
>;

export type StraightLineCreateMessage = WithMessageMetadata<
  import("../client-data/tools/straight-line/index.js").StraightLineCreateMessage
>;

export type StraightLineUpdateMessage = WithMessageMetadata<
  import("../client-data/tools/straight-line/index.js").StraightLineUpdateMessage
>;

export type RectangleCreateMessage = WithMessageMetadata<
  import("../client-data/tools/rectangle/index.js").RectangleCreateMessage
>;

export type RectangleUpdateMessage = WithMessageMetadata<
  import("../client-data/tools/rectangle/index.js").RectangleUpdateMessage
>;

export type EllipseCreateMessage = WithMessageMetadata<
  import("../client-data/tools/ellipse/index.js").EllipseCreateMessage
>;

export type EllipseUpdateMessage = WithMessageMetadata<
  import("../client-data/tools/ellipse/index.js").EllipseUpdateMessage
>;

export type TextCreateMessage = WithMessageMetadata<
  import("../client-data/tools/text/index.js").TextCreateMessage
>;

export type TextUpdateMessage = WithMessageMetadata<
  import("../client-data/tools/text/index.js").TextUpdateMessage
>;

export type EraserDeleteMessage = WithMessageMetadata<
  import("../client-data/tools/eraser/index.js").EraserDeleteMessage
>;

export type HandUpdateChildMessage =
  import("../client-data/tools/hand/index.js").HandUpdateChildMessage;

export type HandDeleteChildMessage =
  import("../client-data/tools/hand/index.js").HandDeleteChildMessage;

export type HandCopyChildMessage =
  import("../client-data/tools/hand/index.js").HandCopyChildMessage;

export type HandChildMessage =
  import("../client-data/tools/hand/index.js").HandChildMessage;

export type ToolOwnedChildMessage = HandChildMessage;

export type HandUpdateMessage = WithMessageMetadata<
  import("../client-data/tools/hand/index.js").HandUpdateMessage
>;

export type HandDeleteMessage = WithMessageMetadata<
  import("../client-data/tools/hand/index.js").HandDeleteMessage
>;

export type HandCopyMessage = WithMessageMetadata<
  import("../client-data/tools/hand/index.js").HandCopyMessage
>;

export type HandBatchMessage = WithMessageMetadata<
  import("../client-data/tools/hand/index.js").HandBatchMessage
>;

export type HandDrawMessage =
  import("../client-data/tools/hand/index.js").HandDrawMessage;

export type HandRenderableMessage =
  import("../client-data/tools/hand/index.js").HandRenderableMessage;

export type ClearMessage = WithMessageMetadata<
  import("../client-data/tools/clear/index.js").ClearMessage
>;

export type CursorMessage = WithMessageMetadata<
  import("../client-data/tools/cursor/index.js").CursorMessage
>;

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
  type: typeof import("../client-data/js/mutation_type.js").MutationType.BATCH;
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

export type RateLimitCosts = {
  [key in RateLimitKind]: number;
};

export type BoardConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected";

export type ConfiguredRateLimitDefinition = {
  limit?: number;
  periodMs?: number;
  anonymousLimit?: number;
  overrides?: { [boardName: string]: { limit?: number; periodMs?: number } };
};

export type RateLimitDefinition = {
  limit: number;
  periodMs: number;
  anonymousLimit?: number;
  overrides?: { [boardName: string]: { limit?: number; periodMs?: number } };
};

export type PendingMessages = {
  [toolName: string]: BoardMessage[];
};

export type ToolPointerListener = (
  x: number,
  y: number,
  evt: MouseEvent | TouchEvent,
  isTouchEvent: boolean,
) => unknown;

export type ToolPointerListeners = {
  press?: ToolPointerListener;
  move?: ToolPointerListener;
  release?: ToolPointerListener;
};

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

export type MountedAppTool = {
  name: string;
  shortcut?: string;
  icon: string;
  draw: (message: BoardMessage, isLocal: boolean) => void;
  normalizeServerRenderedElement?: (element: SVGElement) => void;
  serverRenderedElementSelector?: string;
  press?: ToolPointerListener;
  move?: ToolPointerListener;
  release?: ToolPointerListener;
  onMessage?: (message: BoardMessage) => void;
  listeners: ToolPointerListeners;
  compiledListeners: CompiledToolListeners;
  onstart: (oldTool: MountedAppTool | null) => void;
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
  showMarker?: boolean;
  requiresWritableBoard?: boolean;
  touchListenerOptions?: ToolListenerOptions;
};

export type MountedToolRegistry = {
  [toolName: string]: MountedAppTool;
};

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

export type UserLeftPayload = {
  socketId: string;
};

export type ClientSocketIncomingEventMap = {
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .BOARDSTATE]: AppBoardState;
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .BROADCAST]: IncomingBroadcast;
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .CONNECT]: undefined;
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .CONNECT_ERROR]: {
    message?: string;
    data?: {
      reason?: string;
      latestSeq?: number;
      minReplayableSeq?: number;
    };
  };
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .DISCONNECT]: string;
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .ERROR]: unknown;
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .MUTATION_REJECTED]: MutationRejectedPayload;
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .RATE_LIMITED]: {
    retryAfterMs?: number;
    reason?: string;
  };
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .USER_JOINED]: ConnectedUser;
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .USER_LEFT]: UserLeftPayload;
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
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .BROADCAST]: [message: LiveBoardMessage];
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .REPORT_USER]: [payload: ReportUserPayload];
  [typeof import("../client-data/js/socket_events.js").SocketEvents
    .TURNSTILE_TOKEN]: [token: string, ack?: (result: unknown) => void];
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
  RATE_LIMITS?: {
    general?: {
      limit?: number;
      anonymousLimit?: number;
      periodMs?: number;
      overrides?: {
        [boardName: string]: { limit?: number; periodMs?: number };
      };
    };
    constructive?: {
      limit?: number;
      anonymousLimit?: number;
      periodMs?: number;
      overrides?: {
        [boardName: string]: { limit?: number; periodMs?: number };
      };
    };
    destructive?: {
      limit?: number;
      anonymousLimit?: number;
      periodMs?: number;
      overrides?: {
        [boardName: string]: { limit?: number; periodMs?: number };
      };
    };
    text?: {
      limit?: number;
      anonymousLimit?: number;
      periodMs?: number;
      overrides?: {
        [boardName: string]: { limit?: number; periodMs?: number };
      };
    };
  };
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_VALIDATION_WINDOW_MS?: number | string;
  BLOCKED_TOOLS?: string[];
  BLOCKED_SELECTION_BUTTONS?: number[] | string[];
  MAX_CHILDREN?: number;
  MAX_BOARD_SIZE?: number;
  AUTO_FINGER_WHITEOUT?: boolean;
};

export type ToolBootContext = {
  Tools: MountedAppToolsState;
  assetUrl: (assetFile: string) => string;
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
  boot: (ctx: ToolBootContext) => Promise<T> | T;
  draw?: (state: T, message: BoardMessage, isLocal: boolean) => void;
  normalizeServerRenderedElement?: (state: T, element: SVGElement) => void;
  press?: (
    state: T,
    x: number,
    y: number,
    evt: MouseEvent | TouchEvent,
    isTouchEvent: boolean,
  ) => unknown;
  move?: (
    state: T,
    x: number,
    y: number,
    evt: MouseEvent | TouchEvent,
    isTouchEvent: boolean,
  ) => unknown;
  release?: (
    state: T,
    x: number,
    y: number,
    evt: MouseEvent | TouchEvent,
    isTouchEvent: boolean,
  ) => unknown;
  onMessage?: (state: T, message: BoardMessage) => void;
  onstart?: (state: T, oldTool: MountedAppTool | null) => void;
  onquit?: (state: T, newTool: MountedAppTool) => void;
  onSocketDisconnect?: (state: T) => void;
  onMutationRejected?: (
    state: T,
    message: BoardMessage,
    reason?: string,
  ) => void;
  onSizeChange?: (state: T, size: number) => void;
};

export type ViewportController = {
  setScale: (scale: number) => number;
  getScale: () => number;
  syncLayoutSize: () => void;
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

export type AppToolsState = {
  i18n: { t: (s: string) => string };
  server_config: ServerConfig;
  readOnlyToolNames: Set<string>;
  turnstileValidatedUntil: number;
  turnstileWidgetId: unknown | null;
  turnstileRefreshTimeout: number | null;
  turnstileRetryTimeout: number | null;
  turnstilePending: boolean;
  turnstilePendingWrites: PendingWrite[];
  showTurnstileOverlayTimeout: number | null;
  scale: number;
  viewport: ViewportController;
  drawToolsAllowed: boolean | null;
  boardState: AppBoardState;
  readOnly: boolean;
  canWrite: boolean;
  board: HTMLElement | null;
  svg: SVGSVGElement | null;
  drawingArea: Element | null;
  curTool: MountedAppTool | null;
  drawingEvent: boolean;
  hasAuthoritativeBoardSnapshot: boolean;
  snapshotRevision: number;
  authoritativeSeq: number;
  optimisticJournal: OptimisticJournalState;
  optimisticMutationIdsByItemId: Map<string, string>;
  preSnapshotMessages: IncomingBroadcast[];
  incomingBroadcastQueue: IncomingBroadcast[];
  processingIncomingBroadcast: boolean;
  showMarker: boolean;
  showOtherCursors: boolean;
  showMyCursor: boolean;
  socket: AppSocket | null;
  hasConnectedOnce: boolean;
  useSeqSyncProtocol: boolean;
  bufferedWrites: BufferedWrite[];
  bufferedWriteTimer: number | null;
  writeReadyWaiters: Array<() => void>;
  rateLimitedUntil: number;
  localRateLimitedUntil: number;
  rateLimitNoticeTimer: number | null;
  boardStatusTimer: number | null;
  explicitBoardStatus: ExplicitBoardStatus;
  awaitingBoardSnapshot: boolean;
  connectionState: BoardConnectionState;
  localRateLimitStates: {
    [key in RateLimitKind]: RateLimitWindowState;
  };
  socketIOExtraHeaders: { [name: string]: string } | null;
  boardName: string;
  token: string | null;
  refreshBaselineBeforeConnect: boolean;
  list: MountedToolRegistry;
  bootedToolPromises: { [toolName: string]: Promise<MountedAppTool | null> };
  bootedToolNames: Set<string>;
  pendingMessages: PendingMessages;
  connectedUsers: { [socketId: string]: ConnectedUser };
  connectedUsersPanelOpen: boolean;
  unreadMessagesCount: number;
  messageHooks: MessageHook[];
  colorPresets: ColorPreset[];
  color_chooser: HTMLInputElement | null;
  colorButtonsInitialized?: boolean;
  currentColor: string;
  currentSize: number;
  currentOpacity: number;
  initialPrefs?: {
    tool: string;
    color: string;
    size: number;
    opacity: number;
  };
  colorChangeHandlers: ((color: string) => void)[];
  sizeChangeHandlers: ((size: number) => void)[];
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
  rebuildOptimisticMutationIndex: () => void;
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
  ) => MountedAppTool | null;
  bootTool: (toolName: string) => Promise<MountedAppTool | null>;
  activateTool: (toolName: string) => Promise<boolean>;
  addToolListeners: (tool: MountedAppTool) => void;
  removeToolListeners: (tool: MountedAppTool) => void;
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
  createSVGElement: (
    name: string,
    attrs?: { [key: string]: string | number | undefined },
  ) => SVGElement;
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
  board: HTMLElement;
  svg: SVGSVGElement;
  drawingArea: Element;
};

export type SocketHeaders = {
  [name: string]: string;
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
