/** @import { CopiedMessageFields, IdentifiedMessageFields, MessageChildren, MessageWithColor, MessageWithPoint, MessageWithSize, ToolMessageFields } from "../../types/app-runtime" */

/**
 * @param {unknown} message
 * @returns {{[field: string]: unknown} | null}
 */
function messageRecord(message) {
  return message && typeof message === "object"
    ? /** @type {{[field: string]: unknown}} */ (message)
    : null;
}

/**
 * @param {unknown} message
 * @returns {message is MessageChildren}
 */
export function hasMessageChildren(message) {
  const record = messageRecord(message);
  return !!record && Array.isArray(record._children);
}

/**
 * @param {unknown} message
 * @returns {message is ToolMessageFields}
 */
export function hasMessageTool(message) {
  const tool = messageRecord(message)?.tool;
  return typeof tool === "number" && Number.isSafeInteger(tool) && tool > 0;
}

/**
 * @param {unknown} message
 * @returns {message is IdentifiedMessageFields}
 */
export function hasMessageId(message) {
  const id = messageRecord(message)?.id;
  return typeof id === "string" && id !== "";
}

/**
 * @param {unknown} message
 * @returns {message is CopiedMessageFields}
 */
export function hasMessageNewId(message) {
  const newid = messageRecord(message)?.newid;
  return typeof newid === "string" && newid !== "";
}

/**
 * @param {unknown} message
 * @returns {message is MessageWithPoint}
 */
export function hasMessagePoint(message) {
  const point = messageRecord(message);
  return typeof point?.x === "number" && typeof point.y === "number";
}

/**
 * @param {unknown} message
 * @returns {message is MessageWithColor}
 */
export function hasMessageColor(message) {
  return typeof messageRecord(message)?.color === "string";
}

/**
 * @param {unknown} message
 * @returns {message is MessageWithSize}
 */
export function hasMessageSize(message) {
  return typeof messageRecord(message)?.size === "number";
}
