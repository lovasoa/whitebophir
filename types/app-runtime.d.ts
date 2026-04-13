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
  transform?: Transform | unknown;
  _children?: BoardMessage[];
  x?: number;
  y?: number;
  [key: string]: unknown;
};

export type PendingWrite = {
  data: BoardMessage;
  toolName: string;
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
  iconHTML?: string;
  listeners?: ToolPointerListeners;
  compiledListeners?: CompiledToolListeners;
  onstart?: (oldTool: AppTool | null) => void;
  onquit?: (newTool: AppTool) => void;
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
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_VALIDATION_WINDOW_MS?: number | string;
  BLOCKED_TOOLS?: string[];
  BLOCKED_SELECTION_BUTTONS?: number[] | string[];
  MAX_BOARD_SIZE?: number;
  MAX_EMIT_COUNT?: number;
  MAX_EMIT_COUNT_PERIOD?: number;
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
  rateLimitAlertShown: boolean;
  socketIOExtraHeaders: { [name: string]: string } | null;
  boardName: string;
  token: string | null;
  HTML: ToolPalette;
  list: ToolRegistry;
  pendingMessages: PendingMessages;
  unreadMessagesCount: number;
  messageHooks: MessageHook[];
  toolHooks: ToolHook[];
  colorPresets: ColorPreset[];
  color_chooser: HTMLInputElement;
  sizeChangeHandlers: ((size: number) => void)[];
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
