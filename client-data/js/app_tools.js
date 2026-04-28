import { initializeCoreRuntime } from "./app_tools_core.js";
import {
  AssetModule,
  IdModule,
  InteractionModule,
  normalizeBoardAssetPath,
  RateLimitModule,
} from "./board_full_runtime_modules.js";
import { AccessModule } from "./board_access_module.js";
import { ConnectionModule } from "./board_connection_module.js";
import {
  createResizeCanvasHook,
  createToolNotificationHook,
  createUnreadCountHook,
  MessageModule,
} from "./board_message_module.js";
import { OptimisticModule } from "./board_optimistic_module.js";
import { PresenceModule } from "./board_presence_module.js";
import { ReplayModule } from "./board_replay_module.js";
import { BoardShellModule } from "./board_shell_module.js";
import { StatusModule } from "./board_status_module.js";
import { ToolRegistryModule } from "./board_tool_registry_module.js";
import { TurnstileModule } from "./board_turnstile.js";
import { WriteModule } from "./board_write_module.js";

/** @import { AppInitialPreferences, ColorPreset, ServerConfig, SocketHeaders } from "../../types/app-runtime" */
/** @typedef {{translations: {[key: string]: string}, serverConfig: ServerConfig, boardName: string, token: string | null, socketIOExtraHeaders: SocketHeaders | null, colorPresets: ColorPreset[], initialPreferences: AppInitialPreferences, logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void}} AppToolsOptions */

export class AppTools {
  /** @param {AppToolsOptions} options */
  constructor(options) {
    initializeCoreRuntime(this, options);
    attachFullRuntimeModules(
      /** @type {import("../../types/app-runtime").AppToolsState} */ (
        /** @type {unknown} */ (this)
      ),
      options,
    );
  }
}

/**
 * @param {import("../../types/app-runtime").AppToolsState} tools
 * @param {Pick<AppToolsOptions, "logBoardEvent" | "socketIOExtraHeaders">} options
 * @returns {import("../../types/app-runtime").AppToolsState}
 */
export function attachFullRuntimeModules(tools, options) {
  tools.assets = new AssetModule(normalizeBoardAssetPath);
  tools.interaction = new InteractionModule();
  tools.ids = new IdModule();
  tools.rateLimits = new RateLimitModule(tools.config, tools.identity);
  tools.toolRegistry = new ToolRegistryModule(
    () => tools,
    options.logBoardEvent,
  );
  tools.turnstile = new TurnstileModule(tools, {
    logBoardEvent: options.logBoardEvent,
  });
  tools.writes = new WriteModule(() => tools);
  tools.status = new StatusModule(() => tools, options.logBoardEvent);
  tools.replay = new ReplayModule(() => tools, options.logBoardEvent);
  tools.replay.authoritativeSeq = Number(tools.initialAuthoritativeSeq) || 0;
  tools.optimistic = new OptimisticModule(() => tools);
  tools.connection = new ConnectionModule(() => tools, options.logBoardEvent);
  tools.connection.socketIOExtraHeaders = options.socketIOExtraHeaders;
  tools.access = new AccessModule(() => tools);
  tools.presence = new PresenceModule(() => tools);
  tools.messages = new MessageModule(tools.toolRegistry, tools.identity);
  tools.messages.hooks = [
    createResizeCanvasHook(tools.viewportState.controller),
    createUnreadCountHook(tools.messages),
    createToolNotificationHook(tools.toolRegistry),
  ];
  tools.shell = new BoardShellModule(() => tools, options.logBoardEvent);
  return tools;
}
