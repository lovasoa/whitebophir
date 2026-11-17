import RateLimitCommon from "../../client-data/js/rate_limit_common.js";
import { SocketEvents } from "../../client-data/js/socket_events.js";
import observability from "../observability/index.mjs";
import {
  capToMaxSize,
  pruneStaleEntries,
  touchExisting,
} from "./bounded_state_map.mjs";

const {
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
  createRateLimitState,
} = RateLimitCommon;
const consumeFixedWindowRateLimit = RateLimitCommon.consumeFixedWindowRateLimit;
const getRateLimitRemainingMs = RateLimitCommon.getRateLimitRemainingMs;
const getEffectiveRateLimitDefinition =
  RateLimitCommon.getEffectiveRateLimitDefinition;
const isRateLimitStateStale = RateLimitCommon.isRateLimitStateStale;
const SERVER_RATE_LIMIT_CONFIG_FIELDS =
  /** @type {{[key in RateLimitKind]: keyof ServerConfig}} */ (
    RateLimitCommon.SERVER_RATE_LIMIT_CONFIG_FIELDS
  );
const { logger, metrics, tracing } = observability;

/** @import { AppSocket, MessageData, NormalizedMessageData, RateLimitState as BaseRateLimitState, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @typedef {"general" | "constructive" | "destructive" | "text"} RateLimitKind */
/** @typedef {"disconnect" | "exceeded" | "expired" | "pruned"} RateLimitWindowOutcome */
/**
 * @typedef {BaseRateLimitState & {
 *   metricBoardAnonymous?: boolean,
 *   metricLimit?: number,
 *   metricPeriodMs?: number,
 *   metricRecordedWindowStart?: number,
 * }} RateLimitState
 * @typedef {{
 *   socket: AppSocket,
 *   boardName: string,
 *   data: MessageData | NormalizedMessageData | undefined,
 *   clientIp: string,
 *   userName: string,
 *   now: number,
 *   config: ServerConfig,
 *   boardState?: {canClear?: boolean} | null,
 * }} RateLimitRequest
 */

const RATE_LIMIT_MAP_MAX_SIZE = 4096;
const RATE_LIMIT_STALE_SCAN_LIMIT = 16;

/** @type {{[key in RateLimitKind]: Map<string, RateLimitState>}} */
const rateLimitMaps = {
  general: new Map(),
  constructive: new Map(),
  destructive: new Map(),
  text: new Map(),
};

/**
 * @param {RateLimitKind} kind
 * @param {string} boardName
 * @param {ServerConfig} config
 * @returns {{limit: number, periodMs: number}}
 */
function getEffectiveRateLimitConfig(kind, boardName, config) {
  return getEffectiveRateLimitDefinition(
    /** @type {import("../../types/app-runtime.d.ts").ConfiguredRateLimitDefinition | undefined} */ (
      config[SERVER_RATE_LIMIT_CONFIG_FIELDS[kind]]
    ),
    boardName,
  );
}

/**
 * @param {RateLimitKind} kind
 * @param {RateLimitState} state
 * @param {RateLimitWindowOutcome} outcome
 * @returns {void}
 */
function recordCompletedRateLimitWindow(kind, state, outcome) {
  const limit = Number(state.metricLimit);
  const periodMs = Number(state.metricPeriodMs);
  const used = Number(state.count);
  const windowStart = Number(state.windowStart);
  if (!(limit > 0) || !(periodMs > 0) || !(used > 0)) return;
  if (!Number.isFinite(windowStart)) return;
  if (state.metricRecordedWindowStart === windowStart) return;
  metrics.recordRateLimitWindowUtilization({
    boardAnonymous: state.metricBoardAnonymous,
    kind: kind,
    limit: limit,
    outcome: outcome,
    periodMs: periodMs,
    scope: "ip",
    used: used,
  });
  state.metricRecordedWindowStart = windowStart;
}

/**
 * @param {RateLimitKind} kind
 * @param {RateLimitState} state
 * @param {number} now
 * @returns {void}
 */
function recordExpiredRateLimitWindowIfNeeded(kind, state, now) {
  const periodMs = Number(state.metricPeriodMs);
  if (!(periodMs > 0)) return;
  if (!(state.count > 0)) return;
  if (now - state.windowStart < periodMs) return;
  recordCompletedRateLimitWindow(kind, state, "expired");
}

/**
 * @param {Map<string, RateLimitState>} map
 * @param {RateLimitKind} kind
 * @param {number} periodMs
 * @param {number} now
 * @returns {number}
 */
function pruneOldestStaleRateLimitEntries(map, kind, periodMs, now) {
  if (!(periodMs > 0)) return 0;
  return pruneStaleEntries(
    map,
    (state) => isRateLimitStateStale(state, periodMs, now),
    RATE_LIMIT_STALE_SCAN_LIMIT,
    (state) => recordCompletedRateLimitWindow(kind, state, "pruned"),
  );
}

/**
 * @param {Map<string, RateLimitState>} map
 * @param {RateLimitKind} kind
 * @returns {number}
 */
function capRateLimitMap(map, kind) {
  return capToMaxSize(map, RATE_LIMIT_MAP_MAX_SIZE, (state) =>
    recordCompletedRateLimitWindow(kind, state, "pruned"),
  );
}

/**
 * @param {RateLimitKind} kind
 * @param {string} clientIp
 * @param {number} now
 * @param {number} periodMs
 * @returns {RateLimitState}
 */
function getIpRateLimitState(kind, clientIp, now, periodMs) {
  const map = rateLimitMaps[kind];
  pruneOldestStaleRateLimitEntries(map, kind, periodMs, now);

  const existing = touchExisting(map, clientIp);
  if (existing) {
    capRateLimitMap(map, kind);
    return existing;
  }

  const state = createRateLimitState(now);
  map.set(clientIp, state);
  capRateLimitMap(map, kind);
  return state;
}

/**
 * @param {RateLimitRequest} request
 * @param {RateLimitKind} kind
 * @param {number} cost
 * @returns {boolean}
 */
function enforceIpRateLimit(request, kind, cost) {
  cost = Math.max(0, Number(cost) || 0);
  if (cost === 0) return true;

  const limit = getEffectiveRateLimitConfig(
    kind,
    request.boardName,
    request.config,
  );
  const rateLimitState = getIpRateLimitState(
    kind,
    request.clientIp,
    request.now,
    limit.periodMs,
  );
  recordExpiredRateLimitWindowIfNeeded(kind, rateLimitState, request.now);
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    cost,
    limit.periodMs,
    request.now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  rateLimitState.metricBoardAnonymous = request.boardName === "anonymous";
  rateLimitState.metricLimit = limit.limit;
  rateLimitState.metricPeriodMs = limit.periodMs;
  if (rateLimitState.count <= limit.limit) return true;

  recordCompletedRateLimitWindow(kind, rateLimitState, "exceeded");
  const retryAfterMs = getRateLimitRemainingMs(
    rateLimitState,
    limit.periodMs,
    request.now,
  );
  const costLogField = kind === "general" ? undefined : `${kind}_cost`;
  const costTraceField = kind === "general" ? undefined : `wbo.${kind}_cost`;
  /** @type {{[key: string]: unknown}} */
  const traceExtras = {
    "wbo.board": request.boardName,
    "user.name": request.userName,
    "wbo.rate_limit.kind": kind,
    "wbo.rejection.reason": "rate_limit",
  };
  if (costTraceField) traceExtras[costTraceField] = cost;

  tracing.annotateActiveSpan("socket.rate_limited", {
    "wbo.socket.event": "broadcast_write",
    ...traceExtras,
  });
  /** @type {{[key: string]: unknown}} */
  const logInfo = {
    kind,
    socket: request.socket.id,
    board: request.boardName,
    "client.address": request.clientIp,
    "user.name": request.userName,
    count: rateLimitState.count,
    limit: limit.limit,
    period_ms: limit.periodMs,
    retry_after_ms: retryAfterMs,
  };
  if (costLogField) logInfo[costLogField] = cost;
  logger.warn("socket.rate_limited", logInfo);
  metrics.recordBoardMessage(
    { board: request.boardName, ...(request.data || {}) },
    `rate_limit.${kind}`,
  );
  request.socket.emit(SocketEvents.RATE_LIMITED, {
    event: `${kind.toUpperCase()}_RATE_LIMIT_EXCEEDED`,
    kind,
    limit: limit.limit,
    periodMs: limit.periodMs,
    retryAfterMs,
  });
  request.socket.disconnect(true);
  return false;
}

/** @param {RateLimitRequest} request */
function enforceBroadcastPreNormalization(request) {
  return enforceIpRateLimit(request, "general", 1);
}

/** @param {RateLimitRequest} request */
function enforceBroadcastPostNormalization(request) {
  return (
    (request.boardState?.canClear === true ||
      enforceIpRateLimit(
        request,
        "destructive",
        countDestructiveActions(request.data),
      )) &&
    enforceIpRateLimit(
      request,
      "constructive",
      countConstructiveActions(request.data),
    ) &&
    enforceIpRateLimit(request, "text", countTextCreationActions(request.data))
  );
}

/**
 * @returns {void}
 */
function resetRateLimitMaps() {
  for (const map of Object.values(rateLimitMaps)) map.clear();
}

const rateLimitTestInternals = {
  RATE_LIMIT_MAP_MAX_SIZE,
  RATE_LIMIT_STALE_SCAN_LIMIT,
  getMapSize: function getRateLimitMapSize(/** @type {RateLimitKind} */ kind) {
    return rateLimitMaps[kind].size;
  },
  hasState: function hasRateLimitState(
    /** @type {RateLimitKind} */ kind,
    /** @type {string} */ clientIp,
  ) {
    return rateLimitMaps[kind].has(clientIp);
  },
  setState: function setRateLimitState(
    /** @type {RateLimitKind} */ kind,
    /** @type {string} */ clientIp,
    /** @type {RateLimitState} */ state,
  ) {
    rateLimitMaps[kind].set(clientIp, state);
  },
  touchState: function touchRateLimitState(
    /** @type {RateLimitKind} */ kind,
    /** @type {string} */ clientIp,
    /** @type {number} */ now,
    /** @type {number} */ periodMs,
  ) {
    return getIpRateLimitState(kind, clientIp, now, periodMs);
  },
};

export {
  consumeFixedWindowRateLimit,
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
  createRateLimitState,
  enforceBroadcastPostNormalization,
  enforceBroadcastPreNormalization,
  rateLimitTestInternals,
  recordCompletedRateLimitWindow,
  resetRateLimitMaps,
};
