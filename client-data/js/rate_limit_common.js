import {
  getMutationType,
  getToolCode,
  MutationType,
} from "./message_tool_metadata.js";

export const ANONYMOUS_BOARD_NAME = "anonymous";
export const ANONYMOUS_RATE_LIMIT_DIVISOR = 2;
const URL_LIKE_TEXT_PATTERN = /(?:https?:\/\/|www\.)\S+/i;
const TEXT_TOOL_CODE = getToolCode("Text");

/**
 * @param {unknown} value
 * @returns {number}
 */
function toPositiveInteger(value) {
  const number = Math.floor(Number(value));
  return number > 0 ? number : 0;
}

/**
 * @param {number} now
 * @returns {{windowStart: number, count: number, lastSeen: number}}
 */
export function createRateLimitState(now) {
  return {
    windowStart: now,
    count: 0,
    lastSeen: now,
  };
}

/**
 * @param {unknown} state
 * @param {number} periodMs
 * @param {number} now
 * @returns {{windowStart: number, count: number, lastSeen: number}}
 */
export function normalizeRateLimitState(state, periodMs, now) {
  const candidate =
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

  const normalized =
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
export function consumeFixedWindowRateLimit(state, cost, periodMs, now) {
  const nextState = normalizeRateLimitState(state, periodMs, now);
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
export function getRateLimitRemainingMs(state, periodMs, now) {
  const normalized = normalizeRateLimitState(state, periodMs, now);
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
export function canConsumeFixedWindowRateLimit(
  state,
  cost,
  limit,
  periodMs,
  now,
) {
  const numericCost = Math.max(0, Number(cost) || 0);
  if (numericCost === 0) return true;
  const normalized = normalizeRateLimitState(state, periodMs, now);
  return normalized.count + numericCost <= Math.max(0, Number(limit) || 0);
}

/**
 * @param {unknown} state
 * @param {number} periodMs
 * @param {number} now
 * @returns {boolean}
 */
export function isRateLimitStateStale(state, periodMs, now) {
  const candidate = /** @type {{lastSeen?: unknown} | null | undefined} */ (
    state
  );
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.lastSeen !== "number"
  )
    return true;
  return now - candidate.lastSeen >= 2 * periodMs;
}

/**
 * @param {{limit?: unknown, periodMs?: unknown, anonymousLimit?: unknown, overrides?: {[boardName: string]: {limit?: unknown, periodMs?: unknown}}} | null | undefined} definition
 * @param {unknown} boardName
 * @returns {{limit: number, periodMs: number}}
 */
export function getEffectiveRateLimitDefinition(definition, boardName) {
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
      periodMs: toPositiveInteger(override.periodMs || baseDefinition.periodMs),
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
 * @param {{id?: unknown, type?: unknown} | null | undefined} data
 * @returns {boolean}
 */
export function isConstructiveAction(data) {
  if (!data?.id) return false;
  const mutationType = getMutationType(data);
  return (
    mutationType === undefined ||
    mutationType === MutationType.CREATE ||
    mutationType === MutationType.COPY
  );
}

/**
 * @param {{limit?: unknown, periodMs?: unknown, anonymousLimit?: unknown, overrides?: {[boardName: string]: {limit?: unknown, periodMs?: unknown}}} | null | undefined} definition
 * @param {unknown} boardName
 * @returns {number}
 */
export function getEffectiveRateLimitLimit(definition, boardName) {
  return getEffectiveRateLimitDefinition(definition, boardName).limit;
}

/**
 * @param {{type?: unknown, _children?: unknown} | null | undefined} data
 * @returns {number}
 */
export function countDestructiveActions(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data._children)) {
    return data._children.reduce(function countDeletes(total, child) {
      const mutationType = getMutationType(child);
      return (
        total +
        (mutationType === MutationType.DELETE ||
        mutationType === MutationType.CLEAR
          ? 1
          : 0)
      );
    }, 0);
  }
  const mutationType = getMutationType(data);
  return mutationType === MutationType.DELETE ||
    mutationType === MutationType.CLEAR
    ? 1
    : 0;
}

/**
 * @param {{type?: unknown, _children?: unknown} | null | undefined} data
 * @returns {number}
 */
export function countConstructiveActions(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data._children)) {
    return data._children.reduce(function countCreates(total, child) {
      return total + (isConstructiveAction(child) ? 1 : 0);
    }, 0);
  }
  return isConstructiveAction(data) ? 1 : 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isUrlLikeText(value) {
  return typeof value === "string" && URL_LIKE_TEXT_PATTERN.test(value);
}

/**
 * @param {{tool?: unknown, type?: unknown, id?: unknown, txt?: unknown, _children?: unknown} | null | undefined} data
 * @returns {number}
 */
export function countTextCreationActions(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data._children)) {
    return data._children.reduce(function countTextCreates(total, child) {
      return total + countTextCreationActions(child);
    }, 0);
  }
  if (
    getToolCode(/** @type {{tool?: string | undefined}} */ (data).tool) !==
    TEXT_TOOL_CODE
  ) {
    return 0;
  }
  const mutationType = getMutationType(data);
  if (mutationType === MutationType.CREATE) return 1;
  if (mutationType === MutationType.UPDATE && isUrlLikeText(data.txt)) return 1;
  return 0;
}

const rateLimitCommon = {
  ANONYMOUS_BOARD_NAME,
  ANONYMOUS_RATE_LIMIT_DIVISOR,
  createRateLimitState,
  normalizeRateLimitState,
  consumeFixedWindowRateLimit,
  getRateLimitRemainingMs,
  canConsumeFixedWindowRateLimit,
  isRateLimitStateStale,
  getEffectiveRateLimitDefinition,
  getEffectiveRateLimitLimit,
  countDestructiveActions,
  isConstructiveAction,
  countConstructiveActions,
  countTextCreationActions,
};
export default rateLimitCommon;
