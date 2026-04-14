((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  /** @type {any} */ (root).WBORateLimitCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const ANONYMOUS_BOARD_NAME = "anonymous";
  const ANONYMOUS_RATE_LIMIT_DIVISOR = 2;

  const toPositiveInteger = (value) => {
    const number = Math.floor(Number(value));
    return number > 0 ? number : 0;
  };

  const createRateLimitState = (now) => ({
    windowStart: now,
    count: 0,
    lastSeen: now,
  });

  const normalizeRateLimitState = (state, periodMs, now) => {
    if (
      !state ||
      typeof state !== "object" ||
      typeof state.windowStart !== "number"
    ) {
      return createRateLimitState(now);
    }
    if (now - state.windowStart >= periodMs) {
      return createRateLimitState(now);
    }
    return {
      windowStart: state.windowStart,
      count: state.count,
      lastSeen: Math.max(state.lastSeen, now),
    };
  };

  const consumeFixedWindowRateLimit = (state, cost, periodMs, now) => {
    const nextState = normalizeRateLimitState(state, periodMs, now);
    return {
      windowStart: nextState.windowStart,
      count: nextState.count + Math.max(0, Number(cost) || 0),
      lastSeen: now,
    };
  };

  const getRateLimitRemainingMs = (state, periodMs, now) => {
    const normalized = normalizeRateLimitState(state, periodMs, now);
    if (normalized.count === 0) return 0;
    return Math.max(0, normalized.windowStart + periodMs - now);
  };

  const canConsumeFixedWindowRateLimit = (
    state,
    cost,
    limit,
    periodMs,
    now,
  ) => {
    const numericCost = Math.max(0, Number(cost) || 0);
    if (numericCost === 0) return true;
    const normalized = normalizeRateLimitState(state, periodMs, now);
    return normalized.count + numericCost <= Math.max(0, Number(limit) || 0);
  };

  const isRateLimitStateStale = (state, periodMs, now) => {
    if (
      !state ||
      typeof state !== "object" ||
      typeof state.lastSeen !== "number"
    )
      return true;
    return now - state.lastSeen >= 2 * periodMs;
  };

  const getEffectiveRateLimitDefinition = (definition, boardName) => {
    if (!definition || typeof definition !== "object")
      return { limit: 0, periodMs: 0 };
    const baseDefinition = {
      limit: toPositiveInteger(definition.limit),
      periodMs: toPositiveInteger(definition.periodMs),
    };
    if (typeof boardName !== "string") return baseDefinition;
    const normalizedBoardName = boardName.toLowerCase();
    const override = definition.overrides?.[normalizedBoardName];
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
  };

  const isConstructiveAction = (data) => {
    if (!data?.id) return false;
    if (data.type === "delete" || data.type === "clear") return false;
    if (data.type === "update" || data.type === "child") return false;
    return true;
  };

  return {
    ANONYMOUS_BOARD_NAME,
    ANONYMOUS_RATE_LIMIT_DIVISOR,
    createRateLimitState,
    normalizeRateLimitState,
    consumeFixedWindowRateLimit,
    getRateLimitRemainingMs,
    canConsumeFixedWindowRateLimit,
    isRateLimitStateStale,
    getEffectiveRateLimitDefinition,
    getEffectiveRateLimitLimit: (def, name) =>
      getEffectiveRateLimitDefinition(def, name).limit,
    countDestructiveActions: (data) => {
      if (!data || typeof data !== "object") return 0;
      if (Array.isArray(data._children)) {
        return data._children.reduce(
          (total, child) =>
            total +
            (child?.type === "delete" || child?.type === "clear" ? 1 : 0),
          0,
        );
      }
      return data.type === "delete" || data.type === "clear" ? 1 : 0;
    },
    isConstructiveAction,
    countConstructiveActions: (data) => {
      if (!data || typeof data !== "object") return 0;
      if (Array.isArray(data._children)) {
        return data._children.reduce(
          (total, child) => total + (isConstructiveAction(child) ? 1 : 0),
          0,
        );
      }
      return isConstructiveAction(data) ? 1 : 0;
    },
  };
});
