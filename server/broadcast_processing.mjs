import RateLimitCommon from "../client-data/js/rate_limit_common.js";
import { getToolCode } from "../client-data/js/message_tool_metadata.js";
import {
  canApplyBoardMessage,
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
  normalizeBroadcastData,
} from "./socket_policy.mjs";

/** @typedef {ReturnType<import("./configuration.mjs").readConfiguration>} ServerConfig */
/** @typedef {import("../types/server-runtime.d.ts").AppSocket} AppSocket */
/** @typedef {import("../types/server-runtime.d.ts").MessageData} MessageData */
/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {{windowStart: number, count: number, lastSeen: number}} RateLimitState */
/**
 * @typedef {{name: string, isReadOnly: () => boolean, processMessage: (message: any) => {ok: true} | {ok: false, reason: string}}} BroadcastBoard
 */
/** @typedef {{general: RateLimitState, constructive: RateLimitState, destructive: RateLimitState, text: RateLimitState}} BroadcastRateLimits */
/** @typedef {{ok: true, value: NormalizedMessageData}} AcceptedBoardBroadcast */
/**
 * @typedef {{ok: false, reason: string, stage: "normalize" | "policy" | "process" | "rate_limit"}} RejectedBoardBroadcast
 */
/** @typedef {AcceptedBoardBroadcast | RejectedBoardBroadcast} BroadcastProcessingResult */

const createRateLimitState = RateLimitCommon.createRateLimitState;
const consumeFixedWindowRateLimit = RateLimitCommon.consumeFixedWindowRateLimit;
const getEffectiveRateLimitDefinition =
  RateLimitCommon.getEffectiveRateLimitDefinition;
const CURSOR_TOOL_CODE = getToolCode("cursor");

/**
 * @param {number} now
 * @returns {BroadcastRateLimits}
 */
function createBroadcastRateLimits(now) {
  return {
    general: createRateLimitState(now),
    constructive: createRateLimitState(now),
    destructive: createRateLimitState(now),
    text: createRateLimitState(now),
  };
}

/**
 * @param {"general" | "constructive" | "destructive" | "text"} kind
 * @param {string} boardName
 * @param {ServerConfig} config
 * @returns {{limit: number, periodMs: number}}
 */
function getEffectiveRateLimitConfig(kind, boardName, config) {
  switch (kind) {
    case "constructive":
      return getEffectiveRateLimitDefinition(
        config.CONSTRUCTIVE_ACTION_RATE_LIMITS,
        boardName,
      );
    case "destructive":
      return getEffectiveRateLimitDefinition(
        config.DESTRUCTIVE_ACTION_RATE_LIMITS,
        boardName,
      );
    case "text":
      return getEffectiveRateLimitDefinition(
        config.TEXT_CREATION_RATE_LIMITS,
        boardName,
      );
    default:
      return getEffectiveRateLimitDefinition(
        config.GENERAL_RATE_LIMITS,
        boardName,
      );
  }
}

/**
 * @param {RateLimitState} state
 * @param {number} cost
 * @param {{limit: number, periodMs: number}} definition
 * @param {number} now
 * @returns {boolean}
 */
function consumeRateLimit(state, cost, definition, now) {
  if (cost === 0) return true;
  const nextState = consumeFixedWindowRateLimit(
    state,
    cost,
    definition.periodMs,
    now,
  );
  state.windowStart = nextState.windowStart;
  state.count = nextState.count;
  state.lastSeen = nextState.lastSeen;
  return state.count <= definition.limit;
}

/**
 * @param {ServerConfig} config
 * @param {string} boardName
 * @param {BroadcastRateLimits | undefined} rateLimits
 * @param {number | undefined} now
 * @returns {boolean}
 */
function consumePreNormalizationRateLimits(config, boardName, rateLimits, now) {
  if (!rateLimits || now === undefined) return true;
  return consumeRateLimit(
    rateLimits.general,
    1,
    getEffectiveRateLimitConfig("general", boardName, config),
    now,
  );
}

/**
 * @param {ServerConfig} config
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {BroadcastRateLimits | undefined} rateLimits
 * @param {number | undefined} now
 * @returns {boolean}
 */
function consumePostNormalizationRateLimits(
  config,
  boardName,
  data,
  rateLimits,
  now,
) {
  if (!rateLimits || now === undefined) return true;
  return (
    consumeRateLimit(
      rateLimits.destructive,
      countDestructiveActions(data),
      getEffectiveRateLimitConfig("destructive", boardName, config),
      now,
    ) &&
    consumeRateLimit(
      rateLimits.constructive,
      countConstructiveActions(data),
      getEffectiveRateLimitConfig("constructive", boardName, config),
      now,
    ) &&
    consumeRateLimit(
      rateLimits.text,
      countTextCreationActions(data),
      getEffectiveRateLimitConfig("text", boardName, config),
      now,
    )
  );
}

/**
 * Runs the normalized part of the broadcast write path without tracing,
 * metrics, or socket emission side effects so it can be tested directly.
 *
 * @param {BroadcastBoard} board
 * @param {NormalizedMessageData} data
 * @param {string} socketId
 * @returns {BroadcastProcessingResult}
 */
function processNormalizedBoardMessage(board, data, socketId) {
  if (data.tool === CURSOR_TOOL_CODE) {
    return {
      ok: true,
      value: { ...data, socket: socketId },
    };
  }

  const result = board.processMessage(data);
  if (result.ok === false) {
    return { ok: false, reason: result.reason, stage: "process" };
  }

  return {
    ok: true,
    value: data,
  };
}

/**
 * Runs the expensive core of socket broadcast admission: normalization,
 * rate-limit bookkeeping, board write policy, and board mutation. Logging,
 * tracing, and socket emission remain outside.
 *
 * @param {ServerConfig} config
 * @param {string} boardName
 * @param {BroadcastBoard} board
 * @param {MessageData | null | undefined} data
 * @param {AppSocket} socket
 * @param {{rateLimits?: BroadcastRateLimits, now?: number}=} [options]
 * @returns {BroadcastProcessingResult}
 */
function processBoardBroadcastMessage(
  config,
  boardName,
  board,
  data,
  socket,
  options,
) {
  if (
    !consumePreNormalizationRateLimits(
      config,
      boardName,
      options?.rateLimits,
      options?.now,
    )
  ) {
    return { ok: false, reason: "rate limit", stage: "rate_limit" };
  }

  const normalized = normalizeBroadcastData(config, boardName, data);
  if (normalized.ok === false) {
    return { ok: false, reason: normalized.reason, stage: "normalize" };
  }

  if (
    !consumePostNormalizationRateLimits(
      config,
      boardName,
      normalized.value,
      options?.rateLimits,
      options?.now,
    )
  ) {
    return { ok: false, reason: "rate limit", stage: "rate_limit" };
  }

  if (!canApplyBoardMessage(config, board, normalized.value, socket)) {
    return { ok: false, reason: "blocked board write", stage: "policy" };
  }

  return processNormalizedBoardMessage(board, normalized.value, socket.id);
}

export {
  createBroadcastRateLimits,
  processBoardBroadcastMessage,
  processNormalizedBoardMessage,
};
