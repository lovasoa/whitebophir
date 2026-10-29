import { AccessModule } from "./board_access_module.js";
import { normalizeBoardAssetPath } from "./board_asset_path.js";
import { ConnectionModule } from "./board_connection_module.js";
import {
  AssetModule,
  IdModule,
  InteractionModule,
  RateLimitModule,
} from "./board_full_runtime_modules.js";
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
import { UiModule } from "./board_ui_module.js";
import { WriteModule } from "./board_write_module.js";

/** @import { AppToolsState, SocketHeaders } from "../../types/app-runtime" */
/** @typedef {{socketIOExtraHeaders: SocketHeaders | null, logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void}} FullRuntimeOptions */

/**
 * @param {AppToolsState} tools
 * @param {FullRuntimeOptions} options
 * @returns {AppToolsState}
 */
export function attachFullRuntimeModules(tools, options) {
  // Older cached AssetModule constructors require this argument. Import the
  // resolver directly so their provider need not export it.
  tools.assets = new AssetModule(normalizeBoardAssetPath);
  tools.ui = new UiModule();
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
