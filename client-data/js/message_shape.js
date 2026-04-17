/** @typedef {import("../../types/app-runtime").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime").CopiedBoardMessage} CopiedBoardMessage */
/** @typedef {import("../../types/app-runtime").IdentifiedBoardMessage} IdentifiedBoardMessage */
/** @typedef {import("../../types/app-runtime").TextUpdateBoardMessage} TextUpdateBoardMessage */
/** @typedef {import("../../types/app-runtime").ToolNamedBoardMessage} ToolNamedBoardMessage */

/**
 * @param {{_children?: unknown} | null | undefined} message
 * @returns {message is BoardMessage & {_children: BoardMessage[]}}
 */
export function hasMessageChildren(message) {
  return !!(message && Array.isArray(message._children));
}

/**
 * @param {{tool?: unknown} | null | undefined} message
 * @returns {message is ToolNamedBoardMessage}
 */
export function hasMessageTool(message) {
  return typeof message?.tool === "string" && message.tool !== "";
}

/**
 * @param {{id?: unknown} | null | undefined} message
 * @returns {message is IdentifiedBoardMessage}
 */
export function hasMessageId(message) {
  return typeof message?.id === "string" && message.id !== "";
}

/**
 * @param {{newid?: unknown} | null | undefined} message
 * @returns {message is CopiedBoardMessage}
 */
export function hasMessageNewId(message) {
  return typeof message?.newid === "string" && message.newid !== "";
}

/**
 * @param {BoardMessage | null | undefined} message
 * @returns {message is TextUpdateBoardMessage}
 */
export function isTextUpdateMessage(message) {
  return (
    !!message &&
    message.tool === "Text" &&
    message.type === "update" &&
    hasMessageId(message)
  );
}

const messageShape = {
  hasMessageChildren,
  hasMessageId,
  hasMessageNewId,
  hasMessageTool,
  isTextUpdateMessage,
};

export default messageShape;
