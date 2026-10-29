/**
 * @param {unknown} message
 * @returns {any}
 */
function unwrapBroadcastMessage(message) {
  if (
    message &&
    typeof message === "object" &&
    "mutation" in message &&
    message.mutation &&
    typeof message.mutation === "object"
  ) {
    return message.mutation;
  }
  return message;
}

/**
 * @param {unknown} message
 * @returns {string}
 */
function broadcastMessageColor(message) {
  const unwrapped = unwrapBroadcastMessage(message);
  return unwrapped && typeof unwrapped === "object" && "color" in unwrapped
    ? String(unwrapped.color || "")
    : "";
}

module.exports = {
  broadcastMessageColor,
  unwrapBroadcastMessage,
};
