import RateLimitCommon from "../client-data/js/rate_limit_common.js";
import { Cursor } from "../client-data/tools/index.js";
import {
  canApplyBoardMessage,
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
const getRateLimitCost = RateLimitCommon.getRateLimitCost;
const RATE_LIMIT_KINDS =
  /** @type {Array<"general" | "constructive" | "destructive" | "text">} */ (
    RateLimitCommon.RATE_LIMIT_KINDS
  );
const SERVER_RATE_LIMIT_CONFIG_FIELDS =
  /** @type {{[key in "general" | "constructive" | "destructive" | "text"]: keyof ServerConfig}} */ (
    RateLimitCommon.SERVER_RATE_LIMIT_CONFIG_FIELDS
  );

/**
 * @param {number} now
 * @returns {BroadcastRateLimits}
 */
function createBroadcastRateLimits(now) {
  return RATE_LIMIT_KINDS.reduce(
    (rateLimits, kind) => {
      rateLimits[kind] = createRateLimitState(now);
      return rateLimits;
    },
    /** @type {BroadcastRateLimits} */ ({}),
  );
}

/**
 * @param {"general" | "constructive" | "destructive" | "text"} kind
 * @param {string} boardName
 * @param {ServerConfig} config
 * @returns {{limit: number, periodMs: number}}
 */
function getEffectiveRateLimitConfig(kind, boardName, config) {
  return getEffectiveRateLimitDefinition(
    /** @type {import("../types/app-runtime.d.ts").ConfiguredRateLimitDefinition | undefined} */ (
      config[SERVER_RATE_LIMIT_CONFIG_FIELDS[kind]]
    ),
    boardName,
  );
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
  return RATE_LIMIT_KINDS.every((kind) => {
    if (kind === "general") return true;
    return consumeRateLimit(
      rateLimits[kind],
      getRateLimitCost(kind, data),
      getEffectiveRateLimitConfig(kind, boardName, config),
      now,
    );
  });
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
  if (data.tool === Cursor.id) {
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
