import { AccessModule } from "./board_access_module.js";
import {
  createResizeCanvasHook,
  createToolNotificationHook,
  createUnreadCountHook,
  MessageModule,
} from "./board_message_module.js";
import { OptimisticModule } from "./board_optimistic_module.js";
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
import { StatusModule } from "./board_status_module.js";
import { TurnstileModule } from "./board_turnstile.js";
import { createViewportController } from "./board_viewport.js";
import { WriteModule } from "./board_write_module.js";

/** @import { AppInitialPreferences, ColorPreset, ServerConfig, SocketHeaders } from "../../types/app-runtime" */
/** @typedef {{translations: {[key: string]: string}, serverConfig: ServerConfig, boardName: string, token: string | null, socketIOExtraHeaders: SocketHeaders | null, colorPresets: ColorPreset[], initialPreferences: AppInitialPreferences, logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void, queueProtectedWrite: (data: import("../../types/app-runtime").ClientTrackedMessage) => void, flushPendingWrites: () => void, createToolRegistry: () => import("./board.js").ToolRegistryModule, createReplayModule: () => import("./board.js").ReplayModule, createConnectionModule: () => import("./board.js").ConnectionModule, createPresenceModule: () => import("./board.js").PresenceModule}} AppToolsOptions */

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
    this.writes = new WriteModule(() => this);
    this.status = new StatusModule(() => this, options.logBoardEvent);
    this.replay = options.createReplayModule();
    this.optimistic = new OptimisticModule(() => this);
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
    this.access = new AccessModule(() => this);
    this.dom = /** @type {import("../../types/app-runtime").BoardDomModule} */ (
      new DetachedBoardDomRuntimeModule()
    );
    this.interaction = new InteractionModule();
    this.presence = options.createPresenceModule();
    this.messages = new MessageModule(this.toolRegistry, this.identity);
    this.messages.hooks = [
      createResizeCanvasHook(this.viewportState.controller),
      createUnreadCountHook(this.messages),
      createToolNotificationHook(this.toolRegistry),
    ];
    this.ids = new IdModule();
    this.preferences = new PreferenceModule(
      options.colorPresets,
      options.initialPreferences,
    );
  }
}
