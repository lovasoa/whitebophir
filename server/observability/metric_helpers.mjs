/**
 * @param {unknown} errorType
 * @returns {string | undefined}
 */
function normalizeMetricErrorType(errorType) {
  if (errorType === undefined || errorType === null || errorType === "") {
    return undefined;
  }
  if (typeof errorType === "string") return errorType;
  if (errorType instanceof Error) {
    const errorCode = /** @type {{code?: unknown}} */ (errorType).code;
    if (typeof errorCode === "string" && errorCode !== "") {
      return errorCode;
    }
    if (errorType.name) return errorType.name;
    return "Error";
  }
  return typeof errorType;
}

/**
 * @param {string | undefined} boardName
 * @returns {boolean | undefined}
 */
function metricBoardAnonymous(boardName) {
  if (typeof boardName !== "string" || boardName === "") return undefined;
  return boardName === "anonymous";
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function normalizeMetricSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
}

/**
 * @param {number} limit
 * @param {number} periodMs
 * @returns {string}
 */
function formatRateLimitProfile(limit, periodMs) {
  return `${limit}/${periodMs}ms`;
}

export {
  formatRateLimitProfile,
  metricBoardAnonymous,
  normalizeMetricErrorType,
  normalizeMetricSeq,
};
