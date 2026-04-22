export type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type ToolCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type MutationCode = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type BoardMessage = {
  tool?: string | ToolCode;
  id?: string;
  type?: string | MutationCode;
  parent?: string;
  newid?: string;
  seq?: number;
  socket?: string;
  userId?: string;
  color?: string;
  size?: number;
  txt?: string;
  clientMutationId?: string;
  mutation?: BoardMessage;
  transform?: Transform | unknown;
  _children?: BoardMessage[];
  x?: number;
  y?: number;
  [key: string]: unknown;
};

export type ToolNamedBoardMessage = BoardMessage & {
  tool: string | ToolCode;
};

export type IdentifiedBoardMessage = BoardMessage & {
  id: string;
};

export type CopiedBoardMessage = BoardMessage & {
  newid: string;
};

export type BatchBoardMessage = ToolNamedBoardMessage & {
  _children: BoardMessage[];
};

export type ToolOwnedBatchMessage = BatchBoardMessage & {
  tool: string | ToolCode;
};

export type PendingWrite = {
  data?: BoardMessage;
  toolName?: string;
  costs?: { general: number; constructive: number; destructive: number };
};

export type BufferedWrite = {
  message: BoardMessage;
  costs: { general: number; constructive: number; destructive: number };
};

export type RateLimitWindowState = {
  windowStart: number;
  count: number;
  lastSeen: number;
};

export type RateLimitKind = "general" | "constructive" | "destructive";

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
  stylesheet?: string;
  oneTouch?: boolean;
  alwaysOn?: boolean;
  mouseCursor?: string;
  helpText?: string;
  secondary?: ToolSecondaryMode | null;
  onSizeChange?: (size: number) => void;
  showMarker?: boolean;
  requiresWritableBoard?: boolean;
};

export type MountedToolRegistry = {
  [toolName: string]: MountedAppTool;
};

export type AppSocket = {
  id?: string;
  connected?: boolean;
  on: (eventName: string, handler: (...args: any[]) => void) => void;
  emit: (eventName: string, ...args: any[]) => void;
  connect?: () => void;
  disconnect?: () => void;
  destroy?: () => void;
  once?: (eventName: string, handler: (...args: any[]) => void) => void;
  io?: { engine?: { close: () => void } };
};

export type MessageHook = (message: BoardMessage) => void;

export type ColorPreset = {
  color: string;
  key?: string;
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
  pulseTimeoutId?: ReturnType<typeof setTimeout> | null;
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
  id: string;
  outerHTML: string | null;
  nextSiblingId: string | null;
};

export type OptimisticRollback =
  | {
      kind: "drawing-area";
      markup: string;
    }
  | {
      kind: "items";
      snapshots: OptimisticItemSnapshot[];
    };

export type OptimisticJournalEntry = {
  clientMutationId: string;
  affectedIds: string[];
  dependsOn: string[];
  dependencyItemIds: string[];
  rollback: OptimisticRollback;
  message: BoardMessage;
};

export type OptimisticJournalEntryInput = Omit<
  OptimisticJournalEntry,
  "dependencyItemIds"
> & {
  dependencyItemIds?: string[];
};

export type OptimisticJournalState = {
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
  onSizeChange?: (state: T, size: number) => void;
};

export type AppBoardState = {
  readonly: boolean;
  canWrite: boolean;
};

export type AppToolsState = {
  i18n: { t: (s: string) => string };
  server_config: ServerConfig;
  readOnlyToolNames: Set<string>;
  turnstileValidatedUntil: number;
  turnstileWidgetId: unknown | null;
  turnstileRefreshTimeout: ReturnType<typeof setTimeout> | null;
  turnstilePending: boolean;
  turnstilePendingWrites: PendingWrite[];
  showTurnstileOverlayTimeout: ReturnType<typeof setTimeout> | null;
  scale: number;
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
  awaitingSyncReplay: boolean;
  preSnapshotMessages: BoardMessage[];
  incomingBroadcastQueue: BoardMessage[];
  processingIncomingBroadcast: boolean;
  showMarker: boolean;
  showOtherCursors: boolean;
  showMyCursor: boolean;
  isIE: boolean;
  socket: AppSocket | null;
  hasConnectedOnce: boolean;
  useSeqSyncProtocol: boolean;
  bufferedWrites: BufferedWrite[];
  bufferedWriteTimer: ReturnType<typeof setTimeout> | null;
  writeReadyWaiters: Array<() => void>;
  rateLimitedUntil: number;
  rateLimitNoticeTimer: ReturnType<typeof setTimeout> | null;
  boardStatusTimer: ReturnType<typeof setTimeout> | null;
  explicitBoardStatus: ExplicitBoardStatus;
  awaitingBoardSnapshot: boolean;
  connectionState: BoardConnectionState;
  localRateLimitStates: {
    [key in RateLimitKind]: RateLimitWindowState;
  };
  socketIOExtraHeaders: { [name: string]: string } | null;
  boardName: string;
  token: string | null;
  pendingReplaySync: false | "refresh" | "ready";
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
  cloneMessage: (message: BoardMessage) => BoardMessage;
  getRateLimitDefinition: (
    kind: RateLimitKind,
  ) => ConfiguredRateLimitDefinition;
  getBufferedWriteCosts: (message: BoardMessage) => {
    general: number;
    constructive: number;
    destructive: number;
  };
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
  captureOptimisticRollback: (message: BoardMessage) => OptimisticRollback;
  collectOptimisticDependencyMutationIds: (message: BoardMessage) => string[];
  trackOptimisticMutation: (
    message: BoardMessage,
    rollback: OptimisticRollback,
  ) => void;
  restoreOptimisticRollback: (rollback: OptimisticRollback) => void;
  applyRejectedOptimisticEntries: (rejected: OptimisticJournalEntry[]) => void;
  promoteOptimisticMutation: (clientMutationId: string) => void;
  rejectOptimisticMutation: (clientMutationId: string) => void;
  pruneOptimisticMutationsForAuthoritativeMessage: (
    message: BoardMessage,
  ) => void;
  applyAuthoritativeBaseline: (baseline: AuthoritativeBaseline) => void;
  refreshAuthoritativeBaseline: () => Promise<void>;
  tryStartReplaySync: () => void;
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
  enqueueBufferedWrite: (message: BoardMessage) => void;
  sendBufferedWrite: (message: BoardMessage) => boolean;
  discardBufferedWrites: () => void;
  beginAuthoritativeResync: () => void;
  queueProtectedWrite: (data: BoardMessage, tool: MountedAppTool) => void;
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
  drawAndSend: (
    message: BoardMessage,
    tool?: MountedAppTool | string,
  ) => boolean | undefined;
  send: (message: BoardMessage, toolName?: string) => boolean | undefined;
  getColor: () => string;
  setColor: (color: string) => void;
  getSize: () => number;
  setSize: (size?: number | string | null | undefined) => number;
  getOpacity: () => number;
  getScale: () => number;
  setScale: (scale: number) => number;
  applyViewportFromHash: () => void;
  installViewportHashObservers: () => void;
  createSVGElement: (
    name: string,
    attrs?: { [key: string]: string | number | undefined },
  ) => SVGElement;
  generateUID: (prefix?: string, suffix?: string) => string;
  getEffectiveRateLimit: (kind: RateLimitKind) => RateLimitDefinition;
  isTurnstileValidated: () => boolean;
  clearTurnstileRefreshTimeout: () => void;
  scheduleTurnstileRefresh: (validationWindowMs: number) => void;
  setTurnstileValidation: (result: unknown) => void;
  normalizeTurnstileAck: (result: unknown) => TurnstileAck;
  ensureTurnstileElements: () => { overlay: HTMLElement };
  showTurnstileOverlay: (delay: number) => void;
  hideTurnstileOverlay: () => void;
  refreshTurnstile: () => void;
  showTurnstileWidget: () => void;
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
  callback?: (token: string) => void;
  "before-interactive-callback"?: () => void;
  [key: string]: unknown;
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

export type TurnstileSuccessAck = {
  success: true;
  validationWindowMs?: unknown;
  validatedUntil?: unknown;
};

export type TurnstileFailureAck = {
  success: false;
};

export type TurnstileAck = TurnstileSuccessAck | TurnstileFailureAck;
