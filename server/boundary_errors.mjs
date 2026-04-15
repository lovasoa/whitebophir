/**
 * Error type for untrusted input rejected at a transport boundary.
 */
export class BoundaryError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} reason
   * @param {string} [message]
   */
  constructor(statusCode, reason, message) {
    super(message || reason);
    this.name = "BoundaryError";
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

/**
 * @param {string} reason
 * @param {string} [message]
 * @returns {BoundaryError}
 */
export function badRequest(reason, message) {
  return new BoundaryError(400, reason, message);
}

/**
 * @param {string} reason
 * @param {string} [message]
 * @returns {BoundaryError}
 */
export function forbidden(reason, message) {
  return new BoundaryError(403, reason, message);
}

/**
 * @param {unknown} error
 * @returns {number | undefined}
 */
export function boundaryStatusCode(error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    Number.isInteger(error.statusCode)
  ) {
    return /** @type {{statusCode: number}} */ (error).statusCode;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Number.isInteger(error.status)
  ) {
    return /** @type {{status: number}} */ (error).status;
  }
  return undefined;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
export function boundaryReason(error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    typeof error.reason === "string"
  ) {
    return error.reason;
  }
  return undefined;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isBoundaryError(error) {
  const statusCode = boundaryStatusCode(error);
  return statusCode !== undefined && statusCode >= 400 && statusCode < 500;
}
