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
  revision?: number;
  transform?: Transform | unknown;
  _children?: BoardMessage[];
  x?: number;
  y?: number;
  [key: string]: unknown;
};

export type PendingWrite = {
  message?: { board: string; data: BoardMessage };
  data?: BoardMessage;
  toolName?: string;
  costs?: { general: number; constructive: number; destructive: number };
};

export type BufferedWrite = {
  message: { board: string; data: BoardMessage };
  costs: { general: number; constructive: number; destructive: number };
};

export type RateLimitWindowState = {
  windowStart: number;
  count: number;
  lastSeen: number;
};

export type RateLimitKind = "general" | "constructive" | "destructive";

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
  mouseCursor?: string;
  helpText?: string;
  secondary?: ToolSecondaryMode | null;
  onSizeChange?: (size: number) => void;
  showMarker?: boolean;
};

export type ToolRegistry = {
  [toolName: string]: AppTool;
};

export type AppSocket = {
  id?: string;
  connected?: boolean;
  on: (eventName: string, handler: (...args: any[]) => void) => void;
  emit: (eventName: string, ...args: any[]) => void;
  disconnect?: () => void;
  destroy?: () => void;
};

export type MessageHook = (message: BoardMessage) => void;
export type ToolHook = (tool: AppTool) => void;

export type ColorPreset = {
  color: string;
  key?: string;
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
  curTool: AppTool | null;
  drawingEvent: boolean;
  showMarker: boolean;
  showOtherCursors: boolean;
  showMyCursor: boolean;
  isIE: boolean;
  socket: AppSocket | null;
  hasConnectedOnce: boolean;
  bufferedWrites: BufferedWrite[];
  bufferedWriteTimer: ReturnType<typeof setTimeout> | null;
  rateLimitedUntil: number;
  rateLimitNoticeTimer: ReturnType<typeof setTimeout> | null;
  rateLimitNoticeMessage: string;
  awaitingBoardSnapshot: boolean;
  connectionState: string;
  localRateLimitStates: {
    [key in RateLimitKind]: RateLimitWindowState;
  };
  socketIOExtraHeaders: { [name: string]: string } | null;
  boardName: string;
  token: string | null;
  HTML: ToolPalette;
  list: ToolRegistry;
  toolClasses: { [toolName: string]: ToolClass };
  bootedToolPromises: { [toolName: string]: Promise<AppTool | null> };
  bootedToolNames: Set<string>;
  loadToolClassByName: ((toolName: string) => Promise<void>) | null;
  pendingMessages: PendingMessages;
  unreadMessagesCount: number;
  messageHooks: MessageHook[];
  toolHooks: ToolHook[];
  colorPresets: ColorPreset[];
  color_chooser: HTMLInputElement;
  sizeChangeHandlers: ((size: number) => void)[];
  getToolAssetUrl: (toolName: string, assetFile: string) => string;
  registerToolClass: (toolClass: ToolClass) => void;
  ensureToolClassLoaded: (toolName: string) => Promise<ToolClass | null>;
  mountTool: (tool: AppTool) => AppTool;
  bootTool: (toolName: string) => Promise<AppTool | null>;
  ensureToolBooted: (toolName: string) => Promise<AppTool | null>;
  activateTool: (toolName: string) => Promise<boolean>;
  startConnection: () => void;
  [name: string]: any;
};

export type SocketHeaders = {
  [name: string]: string;
};

export type SocketParams = {
  path: string;
  reconnection: boolean;
  reconnectionDelay: number;
  timeout: number;
  extraHeaders?: SocketHeaders;
  query?: string;
};

export type TurnstileAck = {
  success: boolean;
  validationWindowMs?: unknown;
  validatedUntil?: unknown;
};
