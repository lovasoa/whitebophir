/**
 * @param {unknown} message
 * @returns {{reset: boolean, invalidatedIds: string[]}}
 */
export function optimisticPrunePlanForAuthoritativeMessage(message) {
  if (!message || typeof message !== "object") {
    return { reset: false, invalidatedIds: [] };
  }
  const normalizedMessage = /** @type {{type?: unknown, id?: unknown}} */ (
    message
  );
  if (normalizedMessage.type === "clear") {
    return { reset: true, invalidatedIds: [] };
  }
  if (
    normalizedMessage.type === "delete" &&
    typeof normalizedMessage.id === "string"
  ) {
    return { reset: false, invalidatedIds: [normalizedMessage.id] };
  }
  return { reset: false, invalidatedIds: [] };
}

export default {
  optimisticPrunePlanForAuthoritativeMessage,
};
