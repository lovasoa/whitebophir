((root, factory) => {
  /**
   * @typedef {{
   *   ANONYMOUS_BOARD_NAME: string,
   *   ANONYMOUS_RATE_LIMIT_DIVISOR: number,
   *   createRateLimitState: (now: number) => {windowStart: number, count: number, lastSeen: number},
   *   normalizeRateLimitState: (state: unknown, periodMs: number, now: number) => {windowStart: number, count: number, lastSeen: number},
   *   consumeFixedWindowRateLimit: (state: unknown, cost: number, periodMs: number, now: number) => {windowStart: number, count: number, lastSeen: number},
   *   getRateLimitRemainingMs: (state: unknown, periodMs: number, now: number) => number,
   *   canConsumeFixedWindowRateLimit: (state: unknown, cost: number, limit: number, periodMs: number, now: number) => boolean,
   *   isRateLimitStateStale: (state: unknown, periodMs: number, now: number) => boolean,
   *   getEffectiveRateLimitDefinition: (definition: {limit?: unknown, periodMs?: unknown, anonymousLimit?: unknown, overrides?: {[boardName: string]: {limit?: unknown, periodMs?: unknown}}} | null | undefined, boardName: unknown) => {limit: number, periodMs: number},
   *   getEffectiveRateLimitLimit: (definition: {limit?: unknown, periodMs?: unknown, anonymousLimit?: unknown, overrides?: {[boardName: string]: {limit?: unknown, periodMs?: unknown}}} | null | undefined, boardName: unknown) => number,
   *   countDestructiveActions: (data: {type?: unknown, _children?: unknown} | null | undefined) => number,
   *   isConstructiveAction: (data: {id?: unknown, type?: unknown} | null | undefined) => boolean,
   *   countConstructiveActions: (data: {type?: unknown, _children?: unknown} | null | undefined) => number,
   * }} RateLimitCommonApi
   */
  /** @type {RateLimitCommonApi} */
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  /** @type {any} */ (root).WBORateLimitCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  var ANONYMOUS_BOARD_NAME = "anonymous";
  var ANONYMOUS_RATE_LIMIT_DIVISOR = 2;

  /**
   * @param {unknown} value
   * @returns {number}
   */
  function toPositiveInteger(value) {
    var number = Math.floor(Number(value));
    return number > 0 ? number : 0;
  }

  /**
   * @param {number} now
   * @returns {{windowStart: number, count: number, lastSeen: number}}
   */
  function createRateLimitState(now) {
    return { windowStart: now, count: 0, lastSeen: now };
  }

  /**
   * @param {unknown} state
   * @param {number} periodMs
   * @param {number} now
   * @returns {{windowStart: number, count: number, lastSeen: number}}
   */
  function normalizeRateLimitState(state, periodMs, now) {
    var candidate =
      /** @type {{windowStart?: unknown, count?: unknown, lastSeen?: unknown}} */ (
        state
      );
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.windowStart !== "number" ||
      typeof candidate.count !== "number" ||
      typeof candidate.lastSeen !== "number"
    ) {
      return createRateLimitState(now);
    }

    var normalized =
      /** @type {{windowStart: number, count: number, lastSeen: number}} */ (
        state
      );
    if (now - normalized.windowStart >= periodMs) {
      return createRateLimitState(now);
    }
    return {
      windowStart: normalized.windowStart,
      count: normalized.count,
      lastSeen: Math.max(normalized.lastSeen, now),
    };
  }

  /**
   * @param {unknown} state
   * @param {number} cost
   * @param {number} periodMs
   * @param {number} now
   * @returns {{windowStart: number, count: number, lastSeen: number}}
   */
  function consumeFixedWindowRateLimit(state, cost, periodMs, now) {
    var nextState = normalizeRateLimitState(state, periodMs, now);
    return {
      windowStart: nextState.windowStart,
      count: nextState.count + Math.max(0, Number(cost) || 0),
      lastSeen: now,
    };
  }

  /**
   * @param {unknown} state
   * @param {number} periodMs
   * @param {number} now
   * @returns {number}
   */
  function getRateLimitRemainingMs(state, periodMs, now) {
    var normalized = normalizeRateLimitState(state, periodMs, now);
    if (normalized.count === 0) return 0;
    return Math.max(0, normalized.windowStart + periodMs - now);
  }

  /**
   * @param {unknown} state
   * @param {number} cost
   * @param {number} limit
   * @param {number} periodMs
   * @param {number} now
   * @returns {boolean}
   */
  function canConsumeFixedWindowRateLimit(state, cost, limit, periodMs, now) {
    var numericCost = Math.max(0, Number(cost) || 0);
    if (numericCost === 0) return true;
    var normalized = normalizeRateLimitState(state, periodMs, now);
    return normalized.count + numericCost <= Math.max(0, Number(limit) || 0);
  }

  /**
   * @param {unknown} state
   * @param {number} periodMs
   * @param {number} now
   * @returns {boolean}
   */
  function isRateLimitStateStale(state, periodMs, now) {
    var candidate = /** @type {{lastSeen?: unknown} | null | undefined} */ (
      state
    );
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.lastSeen !== "number"
    ) {
      return true;
    }
    return now - candidate.lastSeen >= 2 * periodMs;
  }

  /**
   * @param {{limit?: unknown, periodMs?: unknown, anonymousLimit?: unknown, overrides?: {[boardName: string]: {limit?: unknown, periodMs?: unknown}}} | null | undefined} definition
   * @param {unknown} boardName
   * @returns {{limit: number, periodMs: number}}
   */
  function getEffectiveRateLimitDefinition(definition, boardName) {
    if (!definition || typeof definition !== "object") {
      return { limit: 0, periodMs: 0 };
    }
    var baseDefinition = {
      limit: toPositiveInteger(definition.limit),
      periodMs: toPositiveInteger(definition.periodMs),
    };
    if (typeof boardName !== "string") return baseDefinition;

    var normalizedBoardName = boardName.toLowerCase();
    var override = definition.overrides?.[normalizedBoardName];
    if (override) {
      return {
        limit: toPositiveInteger(override.limit),
        periodMs: toPositiveInteger(
          override.periodMs || baseDefinition.periodMs,
        ),
      };
    }
    if (
      normalizedBoardName === ANONYMOUS_BOARD_NAME &&
      definition.anonymousLimit !== undefined
    ) {
      return {
        limit: toPositiveInteger(definition.anonymousLimit),
        periodMs: baseDefinition.periodMs,
      };
    }
    return baseDefinition;
  }

  /**
   * @param {{limit?: unknown, periodMs?: unknown, anonymousLimit?: unknown, overrides?: {[boardName: string]: {limit?: unknown, periodMs?: unknown}}} | null | undefined} definition
   * @param {unknown} boardName
   * @returns {number}
   */
  function getEffectiveRateLimitLimit(definition, boardName) {
    return getEffectiveRateLimitDefinition(definition, boardName).limit;
  }

  /**
   * @param {{type?: unknown, _children?: unknown} | null | undefined} data
   * @returns {number}
   */
  function countDestructiveActions(data) {
    if (!data || typeof data !== "object") return 0;
    if (Array.isArray(data._children)) {
      return data._children.reduce(function countDeletes(total, child) {
        return (
          total +
          (child && (child.type === "delete" || child.type === "clear") ? 1 : 0)
        );
      }, 0);
    }
    return data.type === "delete" || data.type === "clear" ? 1 : 0;
  }

  /**
   * @param {{id?: unknown, type?: unknown} | null | undefined} data
   * @returns {boolean}
   */
  function isConstructiveAction(data) {
    if (!data?.id) return false;
    if (data.type === "delete" || data.type === "clear") return false;
    if (data.type === "update" || data.type === "child") return false;
    return true;
  }

  /**
   * @param {{type?: unknown, _children?: unknown} | null | undefined} data
   * @returns {number}
   */
  function countConstructiveActions(data) {
    if (!data || typeof data !== "object") return 0;
    if (Array.isArray(data._children)) {
      return data._children.reduce(function countConstructs(total, child) {
        return total + (isConstructiveAction(child) ? 1 : 0);
      }, 0);
    }
    return isConstructiveAction(data) ? 1 : 0;
  }

  return {
    ANONYMOUS_BOARD_NAME: ANONYMOUS_BOARD_NAME,
    ANONYMOUS_RATE_LIMIT_DIVISOR: ANONYMOUS_RATE_LIMIT_DIVISOR,
    createRateLimitState: createRateLimitState,
    normalizeRateLimitState: normalizeRateLimitState,
    consumeFixedWindowRateLimit: consumeFixedWindowRateLimit,
    getRateLimitRemainingMs: getRateLimitRemainingMs,
    canConsumeFixedWindowRateLimit: canConsumeFixedWindowRateLimit,
    isRateLimitStateStale: isRateLimitStateStale,
    getEffectiveRateLimitDefinition: getEffectiveRateLimitDefinition,
    getEffectiveRateLimitLimit: getEffectiveRateLimitLimit,
    countDestructiveActions: countDestructiveActions,
    isConstructiveAction: isConstructiveAction,
    countConstructiveActions: countConstructiveActions,
  };
});
