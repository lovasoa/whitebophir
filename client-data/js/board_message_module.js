import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { getContentMessageBounds } from "./board_extent.js";
import { getMutationType, MutationType } from "./message_tool_metadata.js";

/** @import { AppIdentityModule, BoardMessage, ViewportController } from "../../types/app-runtime" */
/** @typedef {import("./board_tool_registry_module.js").ToolRegistryModule} ToolRegistryModule */

export class MessageModule {
  #toolRegistry;
  #identity;
  #viewport;

  /**
   * @param {ToolRegistryModule} toolRegistry
   * @param {AppIdentityModule} identity
   * @param {Pick<ViewportController, "ensureBoardExtentForBounds">} viewport
   */
  constructor(toolRegistry, identity, viewport) {
    this.unreadCount = 0;
    this.#toolRegistry = toolRegistry;
    this.#identity = identity;
    this.#viewport = viewport;
  }

  /** @param {BoardMessage} message */
  observeMessage(message) {
    this.#viewport.ensureBoardExtentForBounds(getContentMessageBounds(message));
    const mutationType = getMutationType(message);
    if (
      document.hidden &&
      mutationType !== MutationType.APPEND &&
      mutationType !== MutationType.UPDATE
    ) {
      this.unreadCount++;
      updateDocumentTitle(this, this.#identity);
    }
    for (const tool of Object.values(this.#toolRegistry.mounted)) {
      tool?.onMessage?.(message);
    }
  }

  /**
   * @param {BoardMessage} message
   * @returns {Promise<void>}
   */
  async messageForTool(message) {
    const name = TOOL_ID_BY_CODE[message.tool];
    if (!name) return;
    const tool = this.#toolRegistry.mounted[name];

    this.observeMessage(message);
    if (tool) {
      tool.draw(message, false);
    } else {
      this.#toolRegistry.pendingMessages[name] ??= [];
      this.#toolRegistry.pendingMessages[name].push(message);
      await this.#toolRegistry.bootTool(name);
    }
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
