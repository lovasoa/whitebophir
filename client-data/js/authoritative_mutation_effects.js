import {
  getMutationType,
  getMutationTypeCode,
  MutationType,
} from "./message_tool_metadata.js";

/**
 * @param {unknown} message
 * @returns {{reset: boolean, invalidatedIds: string[]}}
 */
export function optimisticPrunePlanForAuthoritativeMessage(message) {
  if (!message || typeof message !== "object") {
    return { reset: false, invalidatedIds: [] };
  }
  const normalizedMessage =
    /** @type {{type?: unknown, id?: unknown, _children?: unknown}} */ (
      message
    );
  const mutationType = getMutationType(normalizedMessage);
  if (mutationType === MutationType.CLEAR) {
    return { reset: true, invalidatedIds: [] };
  }
  if (mutationType === MutationType.BATCH) {
    /** @type {string[]} */
    const invalidatedIds = [];
    let reset = false;
    for (const child of /** @type {{type?: unknown, id?: unknown}[]} */ (
      normalizedMessage._children
    )) {
      const childType = getMutationTypeCode(child?.type);
      if (childType === MutationType.CLEAR) reset = true;
      else if (
        childType === MutationType.DELETE &&
        typeof child.id === "string"
      )
        invalidatedIds.push(child.id);
    }
    return { reset, invalidatedIds };
  }
  if (
    mutationType === MutationType.DELETE &&
    typeof normalizedMessage.id === "string"
  ) {
    return { reset: false, invalidatedIds: [normalizedMessage.id] };
  }
  return { reset: false, invalidatedIds: [] };
}
