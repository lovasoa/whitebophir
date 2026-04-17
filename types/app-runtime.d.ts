export type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type BoardMessage = {
  tool?: string;
  id?: string;
  type?: string;
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
  tool: string;
};

export type IdentifiedBoardMessage = BoardMessage & {
  id: string;
};

export type CopiedBoardMessage = BoardMessage & {
  newid: string;
};

export type HandChildUpdateMessage = BoardMessage & {
  type: "update";
  id: string;
};

export type HandChildCopyMessage = BoardMessage & {
  type: "copy";
  newid: string;
};

export type HandChildMessage = HandChildUpdateMessage | HandChildCopyMessage;

export type BatchBoardMessage = ToolNamedBoardMessage & {
  _children: BoardMessage[];
};

export type ToolOwnedBatchMessage = BatchBoardMessage & {
  tool: "Hand";
};

export type TextUpdateBoardMessage = ToolNamedBoardMessage & {
  tool: "Text";
  type: "update";
  id: string;
  txt?: string;
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

export type AppTool = {
  name: string;
  shortcut?: string;
  icon: string;
  draw: (message: BoardMessage, isLocal: boolean) => void;
  press?: ToolPointerListener;
  move?: ToolPointerListener;
  release?: ToolPointerListener;
  onMessage?: (message: BoardMessage) => void;
  iconHTML?: string;
  listeners?: ToolPointerListeners;
  compiledListeners?: CompiledToolListeners;
  onstart?: (oldTool: AppTool | null) => void;
  onquit?: (newTool: AppTool) => void;
  onSocketDisconnect?: () => void;
  stylesheet?: string;
  oneTouch?: boolean;
  alwaysOn?: boolean;
  mouseCursor?: string;
  helpText?: string;
  secondary?: ToolSecondaryMode | null;
  onSizeChange?: (size: number) => void;
  showMarker?: boolean;
};

export type ToolRegistry = {
  [toolName: string]: AppTool;
};

export type MountedAppTool = AppTool & {
  listeners: ToolPointerListeners;
  compiledListeners: CompiledToolListeners;
  onstart: (oldTool: AppTool | null) => void;
  onquit: (newTool: AppTool) => void;
  onMessage: (message: BoardMessage) => void;
  onSocketDisconnect: () => void;
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

export type OptimisticJournalState = {
  append: (entry: OptimisticJournalEntry) => OptimisticJournalEntry;
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

export type ToolPalette = {
  template: any;
  addShortcut: (key: string, callback: () => void) => void;
  addTool: (
    toolName: string,
    toolIcon: string,
    toolIconHTML: string | undefined,
    toolShortcut: string,
    oneTouch: boolean | undefined,
  ) => unknown;
  changeTool: (oldToolName: string, newToolName: string) => void;
  toggle: (toolName: string, name: string, icon: string) => void;
  addStylesheet: (href: string) => void;
  colorPresetTemplate: any;
  addColorButton: (button: ColorPreset) => unknown;
};

export type ToolRuntime = {
  Tools: AppToolsState;
  activateTool: (toolName: string) => void;
  getButton: (toolName: string) => HTMLElement | null;
  registerShortcut: (toolName: string, key: string) => void;
};

export type ToolBootContext = {
  toolName: string;
  runtime: ToolRuntime;
  button: HTMLElement | null;
  version: string;
  assetUrl: (assetFile: string) => string;
};

export type ToolClass<T extends AppTool = AppTool> = {
  toolName: string;
  replaySafe?: boolean;
  boot: (ctx: ToolBootContext) => Promise<T> | T;
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
  board: HTMLElement;
  svg: SVGSVGElement;
  drawingArea: Element | null;
  curTool: MountedAppTool | null;
  drawingEvent: boolean;
  hasAuthoritativeBoardSnapshot: boolean;
  snapshotRevision: number;
  authoritativeSeq: number;
  authoritativeDrawingMarkup: string;
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
  rateLimitedUntil: number;
  rateLimitNoticeTimer: ReturnType<typeof setTimeout> | null;
  rateLimitNoticeMessage: string;
  awaitingBoardSnapshot: boolean;
  connectionState: BoardConnectionState;
  localRateLimitStates: {
    [key in RateLimitKind]: RateLimitWindowState;
  };
  socketIOExtraHeaders: { [name: string]: string } | null;
  boardName: string;
  token: string | null;
  HTML: ToolPalette;
  list: MountedToolRegistry;
  toolClasses: { [toolName: string]: ToolClass };
  bootedToolPromises: { [toolName: string]: Promise<AppTool | null> };
  bootedToolNames: Set<string>;
  pendingMessages: PendingMessages;
  connectedUsers: { [socketId: string]: ConnectedUser };
  connectedUsersPanelOpen: boolean;
  unreadMessagesCount: number;
  messageHooks: MessageHook[];
  colorPresets: ColorPreset[];
  color_chooser: HTMLInputElement;
  sizeChangeHandlers: ((size: number) => void)[];
  getInitialSocketQuery: () => { [name: string]: string };
  cloneMessage: (message: BoardMessage) => BoardMessage;
  showLoadingMessage: () => void;
  hideLoadingMessage: () => void;
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
  isWritePaused: (now?: number) => boolean;
  canBufferWrites: () => boolean;
  showRateLimitNotice: (message: string, retryAfterMs: number) => void;
  hideRateLimitNotice: () => void;
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
  queueProtectedWrite: (data: BoardMessage, tool: AppTool) => void;
  flushTurnstilePendingWrites: () => void;
  getToolAssetUrl: (toolName: string, assetFile: string) => string;
  registerToolClass: (toolClass: ToolClass) => void;
  ensureToolClassLoaded: (toolName: string) => Promise<ToolClass>;
  mountTool: (tool: AppTool) => MountedAppTool;
  bootTool: (toolName: string) => Promise<AppTool | null>;
  ensureToolBooted: (toolName: string) => Promise<AppTool | null>;
  activateTool: (toolName: string) => Promise<boolean>;
  add: (tool: AppTool) => void;
  register: (tool: AppTool) => void;
  addToolListeners: (tool: AppTool) => void;
  removeToolListeners: (tool: AppTool) => void;
  drawAndSend: (message: BoardMessage, tool?: AppTool) => boolean | undefined;
  send: (message: BoardMessage, toolName?: string) => boolean | undefined;
  getColor: () => string;
  setColor: (color: string) => void;
  getSize: () => number;
  setSize: (size?: number | string | null | undefined) => number;
  getOpacity: () => number;
  getScale: () => number;
  setScale: (scale: number) => number;
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
  resolveBoardName: () => string;
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
  isBlocked: (tool: AppTool) => boolean;
  applyHooks: <T>(hooks: ((value: T) => void)[], object: T) => void;
  positionElement: (elem: HTMLElement, x: number, y: number) => void;
  change: (toolName: string) => boolean | undefined;
  messageForTool: (message: BoardMessage) => void;
  newUnreadMessage: () => void;
  startConnection: () => void;
  versionAssetPath: (assetPath: string) => string;
  assetVersion: string;
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
