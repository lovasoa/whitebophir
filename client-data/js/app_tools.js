import {
  AssetModule,
  ConfigModule,
  CoordinateModule,
  DetachedBoardDomRuntimeModule,
  I18nModule,
  IdentityModule,
  IdModule,
  InteractionModule,
  normalizeBoardAssetPath,
  PreferenceModule,
  RateLimitModule,
  ViewportStateModule,
} from "./board_runtime_core.js";
import { TurnstileModule } from "./board_turnstile.js";
import { createViewportController } from "./board_viewport.js";

/** @import { AppInitialPreferences, ColorPreset, MessageHook, ServerConfig, SocketHeaders } from "../../types/app-runtime" */
/** @typedef {{translations: {[key: string]: string}, serverConfig: ServerConfig, boardName: string, token: string | null, socketIOExtraHeaders: SocketHeaders | null, colorPresets: ColorPreset[], initialPreferences: AppInitialPreferences, logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void, queueProtectedWrite: (data: import("../../types/app-runtime").ClientTrackedMessage) => void, flushPendingWrites: () => void, createToolRegistry: () => import("./board.js").ToolRegistryModule, createWriteModule: () => import("./board.js").WriteModule, createStatusModule: () => import("./board.js").StatusModule, createReplayModule: () => import("./board.js").ReplayModule, createOptimisticModule: () => import("./board.js").OptimisticModule, createConnectionModule: () => import("./board.js").ConnectionModule, createAccessModule: () => import("./board.js").AccessModule, createPresenceModule: () => import("./board.js").PresenceModule, createMessageModule: (toolRegistry: import("./board.js").ToolRegistryModule, identity: IdentityModule) => import("./board.js").MessageModule, createMessageHooks: (tools: AppTools) => MessageHook[]}} AppToolsOptions */

export class AppTools {
  /** @param {AppToolsOptions} options */
  constructor(options) {
    this.i18n = new I18nModule(options.translations);
    this.config = new ConfigModule(options.serverConfig);
    this.identity = new IdentityModule(options.boardName, options.token);
    this.assets = new AssetModule(normalizeBoardAssetPath);
    this.toolRegistry = options.createToolRegistry();
    this.turnstile = new TurnstileModule(this, {
      logBoardEvent: options.logBoardEvent,
      queueProtectedWrite: options.queueProtectedWrite,
      flushPendingWrites: options.flushPendingWrites,
    });
    this.writes = options.createWriteModule();
    this.status = options.createStatusModule();
    this.replay = options.createReplayModule();
    this.optimistic = options.createOptimisticModule();
    this.connection = options.createConnectionModule();
    this.connection.socketIOExtraHeaders = options.socketIOExtraHeaders;
    this.rateLimits = new RateLimitModule(this.config, this.identity);
    const viewportController = createViewportController(
      /** @type {import("../../types/app-runtime").AppToolsState} */ (
        /** @type {unknown} */ (this)
      ),
    );
    this.viewportState = new ViewportStateModule(viewportController);
    this.coordinates = new CoordinateModule(this.config, this.viewportState);
    this.access = options.createAccessModule();
    this.dom = /** @type {import("../../types/app-runtime").BoardDomModule} */ (
      new DetachedBoardDomRuntimeModule()
    );
    this.interaction = new InteractionModule();
    this.presence = options.createPresenceModule();
    this.messages = options.createMessageModule(
      this.toolRegistry,
      this.identity,
    );
    this.messages.hooks = options.createMessageHooks(this);
    this.ids = new IdModule();
    this.preferences = new PreferenceModule(
      options.colorPresets,
      options.initialPreferences,
    );
  }
}
