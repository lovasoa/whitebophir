/**
 * @param {unknown} value
 * @returns {string[]}
 */
function uniqueIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item))];
}

/**
 * @param {any} message
 * @returns {string[]}
 */
export function collectOptimisticAffectedIds(message) {
  if (!message || typeof message !== "object") return [];
  if (Array.isArray(message._children)) {
    return uniqueIds(
      message._children.flatMap((/** @type {any} */ child) =>
        collectOptimisticAffectedIds({
          ...child,
          tool: message.tool,
        }),
      ),
    );
  }
  switch (message.type) {
    case "copy":
      return uniqueIds([message.newid]);
    case "child":
      return uniqueIds([message.parent]);
    case "clear":
      return [];
    default:
      return uniqueIds([message.id]);
  }
}

/**
 * @param {any} message
 * @returns {string[]}
 */
export function collectOptimisticDependencyIds(message) {
  if (!message || typeof message !== "object") return [];
  if (Array.isArray(message._children)) {
    return uniqueIds(
      message._children.flatMap((/** @type {any} */ child) =>
        collectOptimisticDependencyIds({
          ...child,
          tool: message.tool,
        }),
      ),
    );
  }
  switch (message.type) {
    case "copy":
    case "delete":
    case "update":
      return uniqueIds([message.id]);
    case "child":
      return uniqueIds([message.parent]);
    default:
      return [];
  }
}
