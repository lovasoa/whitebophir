import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { getContentMessageBounds } from "./board_extent.js";
import { queuePendingMessage } from "./board_transport.js";
import { getMutationType, MutationType } from "./message_tool_metadata.js";

/** @import { AppIdentityModule, BoardMessage, MessageHook, ViewportController } from "../../types/app-runtime" */
/** @typedef {import("./board_tool_registry_module.js").ToolRegistryModule} ToolRegistryModule */

export class MessageModule {
  #toolRegistry;
  #identity;

  /**
   * @param {ToolRegistryModule} toolRegistry
   * @param {AppIdentityModule} identity
   */
  constructor(toolRegistry, identity) {
    this.hooks = /** @type {MessageHook[]} */ ([]);
    this.unreadCount = 0;
    this.#toolRegistry = toolRegistry;
    this.#identity = identity;
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

  /**
   * @param {BoardMessage} message
   * @returns {Promise<void>}
   */
  async messageForTool(message) {
    const name = TOOL_ID_BY_CODE[message.tool];
    if (!name) return;
    const tool = this.#toolRegistry.mounted[name];

    this.applyHooks(this.hooks, message);
    if (tool) {
      tool.draw(message, false);
    } else {
      queuePendingMessage(this.#toolRegistry.pendingMessages, name, message);
      await this.#toolRegistry.bootTool(name);
    }
  }

  newUnreadMessage() {
    this.unreadCount++;
    updateDocumentTitle(this, this.#identity);
  }
}

/**
 * @param {MessageModule} messages
 * @param {AppIdentityModule} identity
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
