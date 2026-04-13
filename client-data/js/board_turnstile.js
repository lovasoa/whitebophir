(function (global) {
  "use strict";

  /** @typedef {{success: boolean, validationWindowMs?: unknown, validatedUntil?: unknown}} TurnstileAck */

  /**
   * @param {unknown} result
   * @param {number | undefined} defaultValidationWindowMs
   * @returns {TurnstileAck}
   */
  function normalizeTurnstileAck(result, defaultValidationWindowMs) {
    if (result === true) {
      return {
        success: true,
        validationWindowMs: defaultValidationWindowMs,
        validatedUntil: Date.now() + Number(defaultValidationWindowMs || 0),
      };
    }
    if (result && typeof result === "object") {
      return /** @type {TurnstileAck} */ (result);
    }
    return { success: false };
  }

  /**
   * @param {unknown} result
   * @param {number | undefined} defaultValidationWindowMs
   * @returns {{validatedUntil: number, validationWindowMs: number}}
   */
  function computeTurnstileValidation(result, defaultValidationWindowMs) {
    var ack = normalizeTurnstileAck(result, defaultValidationWindowMs);
    if (ack.success !== true) {
      return { validatedUntil: 0, validationWindowMs: 0 };
    }
    var validationWindowMs =
      Number(ack.validationWindowMs) || Number(defaultValidationWindowMs) || 0;
    var safeWindowMs = Math.max(0, validationWindowMs - 5000);
    return {
      validatedUntil: safeWindowMs > 0 ? Date.now() + safeWindowMs : 0,
      validationWindowMs: validationWindowMs,
    };
  }

  /**
   * @param {unknown} api
   * @param {unknown} widgetId
   * @returns {boolean}
   */
  function resetTurnstileWidget(api, widgetId) {
    if (
      api &&
      typeof api === "object" &&
      "reset" in api &&
      typeof api.reset === "function" &&
      widgetId !== null &&
      widgetId !== undefined
    ) {
      api.reset(widgetId);
      return true;
    }
    return false;
  }

  var exports = {
    normalizeTurnstileAck: normalizeTurnstileAck,
    computeTurnstileValidation: computeTurnstileValidation,
    resetTurnstileWidget: resetTurnstileWidget,
  };
  var root = /** @type {typeof globalThis & {WBOBoardTurnstile?: typeof exports}} */ (global);
  root.WBOBoardTurnstile = exports;

  if ("object" === typeof module && module.exports) {
    module.exports = exports;
  }
})(typeof globalThis === "object" ? globalThis : window);
