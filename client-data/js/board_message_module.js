import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { getContentMessageBounds } from "./board_extent.js";
import { messages as BoardMessages } from "./board_transport.js";
import { getMutationType, MutationType } from "./message_tool_metadata.js";

/** @import { BoardMessage, MessageHook, ViewportController } from "../../types/app-runtime" */
/** @typedef {import("./board_runtime_core.js").IdentityModule} IdentityModule */
/** @typedef {import("./board_tool_registry_module.js").ToolRegistryModule} ToolRegistryModule */

const messageModuleState = new WeakMap();

export class MessageModule {
  /**
   * @param {ToolRegistryModule} toolRegistry
   * @param {IdentityModule} identity
   */
  constructor(toolRegistry, identity) {
    this.hooks = /** @type {MessageHook[]} */ ([]);
    this.unreadCount = 0;
    messageModuleState.set(this, { toolRegistry, identity });
  }

  /**
   * @template T
   * @param {((value: T) => void)[]} hooks
   * @param {T} object
   */
  applyHooks(hooks, object) {
    hooks.forEach((hook) => {
      hook(object);
    });
  }

  /** @param {BoardMessage} message */
  messageForTool(message) {
    const state =
      /** @type {{toolRegistry: ToolRegistryModule, identity: IdentityModule}} */ (
        messageModuleState.get(this)
      );
    const name = TOOL_ID_BY_CODE[message.tool];
    const tool = state.toolRegistry.mounted[name];

    this.applyHooks(this.hooks, message);
    if (tool) {
      tool.draw(message, false);
    } else {
      BoardMessages.queuePendingMessage(
        state.toolRegistry.pendingMessages,
        name,
        message,
      );
    }
  }

  newUnreadMessage() {
    const state =
      /** @type {{toolRegistry: ToolRegistryModule, identity: IdentityModule}} */ (
        messageModuleState.get(this)
      );
    this.unreadCount++;
    updateDocumentTitle(this, state.identity);
  }
}

/**
 * @param {MessageModule} messages
 * @param {IdentityModule} identity
 */
export function updateDocumentTitle(messages, identity) {
  document.title =
    (messages.unreadCount ? `(${messages.unreadCount}) ` : "") +
    `${identity.boardName} | WBO`;
}

/**
 * @param {ViewportController} viewport
 * @returns {MessageHook}
 */
export function createResizeCanvasHook(viewport) {
  return function resizeCanvas(m) {
    viewport.ensureBoardExtentForBounds(getContentMessageBounds(m));
  };
}

/**
 * @param {MessageModule} messages
 * @returns {MessageHook}
 */
export function createUnreadCountHook(messages) {
  return function updateUnreadCount(m) {
    const mutationType = getMutationType(m);
    if (
      document.hidden &&
      mutationType !== MutationType.APPEND &&
      mutationType !== MutationType.UPDATE
    ) {
      messages.newUnreadMessage();
    }
  };
}

/**
 * @param {ToolRegistryModule} toolRegistry
 * @returns {MessageHook}
 */
export function createToolNotificationHook(toolRegistry) {
  return function notifyToolsOfMessage(m) {
    Object.values(toolRegistry.mounted || {}).forEach((tool) => {
      tool?.onMessage?.(m);
    });
  };
}
