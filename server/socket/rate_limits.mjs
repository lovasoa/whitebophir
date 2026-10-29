import RateLimitCommon from "../../client-data/js/rate_limit_common.js";
import { SocketEvents } from "../../client-data/js/socket_events.js";
import observability from "../observability/index.mjs";
import {
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
} from "./policy.mjs";
import {
  capToMaxSize,
  pruneStaleEntries,
  touchExisting,
} from "./bounded_state_map.mjs";

const createRateLimitState = RateLimitCommon.createRateLimitState;
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
 * @param {string} eventName
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function socketTraceAttributes(eventName, extras) {
  return {
    "wbo.socket.event": eventName,
    ...extras,
  };
}

/**
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {{[key: string]: any}} infos
 * @returns {void}
 */
function closeRateLimitedSocket(socket, eventName, infos) {
  socket.emit(SocketEvents.RATE_LIMITED, {
    event: eventName,
    kind: infos.kind,
    limit: infos.limit,
    periodMs: infos.period_ms,
    retryAfterMs: infos.retry_after_ms,
  });
  socket.disconnect(true);
}

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
 * @param {RateLimitState} state
 * @param {string} boardName
 * @param {number} limit
 * @param {number} periodMs
 * @returns {void}
 */
function updateRateLimitStateMetricMetadata(state, boardName, limit, periodMs) {
  state.metricBoardAnonymous = boardName === "anonymous";
  state.metricLimit = limit;
  state.metricPeriodMs = periodMs;
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
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {{[key: string]: any}} extras
 * @returns {{[key: string]: any}}
 */
function buildSocketLogInfo(socket, boardName, extras) {
  return {
    board: boardName,
    socket: socket.id,
    ...extras,
  };
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
 * @param {RateLimitRequest & {
 *   kind: RateLimitKind,
 *   cost: number,
 *   exceededEventName: string,
 * }} options
 * @returns {boolean}
 */
function enforceIpRateLimit(options) {
  const cost = Math.max(0, Number(options.cost) || 0);
  if (cost === 0) return true;

  const limit = getEffectiveRateLimitConfig(
    options.kind,
    options.boardName,
    options.config,
  );
  const rateLimitState = getIpRateLimitState(
    options.kind,
    options.clientIp,
    options.now,
    limit.periodMs,
  );
  recordExpiredRateLimitWindowIfNeeded(
    options.kind,
    rateLimitState,
    options.now,
  );
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    cost,
    limit.periodMs,
    options.now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    options.boardName,
    limit.limit,
    limit.periodMs,
  );
  if (rateLimitState.count <= limit.limit) return true;

  recordCompletedRateLimitWindow(options.kind, rateLimitState, "exceeded");
  const retryAfterMs = getRateLimitRemainingMs(
    rateLimitState,
    limit.periodMs,
    options.now,
  );
  const costLogField =
    options.kind === "general" ? undefined : `${options.kind}_cost`;
  const costTraceField =
    options.kind === "general" ? undefined : `wbo.${options.kind}_cost`;
  /** @type {{[key: string]: unknown}} */
  const traceExtras = {
    "wbo.board": options.boardName,
    "user.name": options.userName,
    "wbo.rate_limit.kind": options.kind,
    "wbo.rejection.reason": "rate_limit",
  };
  if (costTraceField) traceExtras[costTraceField] = cost;

  tracing.withDetachedSpan(
    "socket.rate_limited",
    {
      attributes: socketTraceAttributes("broadcast_write", traceExtras),
    },
    function logRateLimit() {
      /** @type {{[key: string]: unknown}} */
      const logInfo = {
        kind: options.kind,
        socket: options.socket.id,
        board: options.boardName,
        "client.address": options.clientIp,
        "user.name": options.userName,
        count: rateLimitState.count,
        limit: limit.limit,
        period_ms: limit.periodMs,
        retry_after_ms: retryAfterMs,
      };
      if (costLogField) logInfo[costLogField] = cost;
      logger.warn("socket.rate_limited", logInfo);
      metrics.recordBoardMessage(
        { board: options.boardName, ...(options.data || {}) },
        `rate_limit.${options.kind}`,
      );
    },
  );

  const socketInfo = buildSocketLogInfo(options.socket, options.boardName, {
    kind: options.kind,
    ip: options.clientIp,
    count: rateLimitState.count,
    limit: limit.limit,
    period_ms: limit.periodMs,
    retry_after_ms: retryAfterMs,
  });
  if (costLogField) socketInfo[costLogField] = cost;
  closeRateLimitedSocket(options.socket, options.exceededEventName, socketInfo);
  return false;
}

/**
 * @param {RateLimitRequest} request
 * @returns {boolean}
 */
function enforceGeneralRateLimit(request) {
  return enforceIpRateLimit({
    ...request,
    kind: "general",
    cost: 1,
    exceededEventName: "GENERAL_RATE_LIMIT_EXCEEDED",
  });
}

/**
 * @param {RateLimitRequest} request
 * @returns {boolean}
 */
function enforceDestructiveRateLimit(request) {
  if (request.boardState?.canClear === true) return true;
  return enforceIpRateLimit({
    ...request,
    kind: "destructive",
    cost: countDestructiveActions(request.data),
    exceededEventName: "DESTRUCTIVE_RATE_LIMIT_EXCEEDED",
  });
}

/**
 * @param {RateLimitRequest} request
 * @returns {boolean}
 */
function enforceConstructiveRateLimit(request) {
  return enforceIpRateLimit({
    ...request,
    kind: "constructive",
    cost: countConstructiveActions(request.data),
    exceededEventName: "CONSTRUCTIVE_RATE_LIMIT_EXCEEDED",
  });
}

/**
 * @param {RateLimitRequest} request
 * @returns {boolean}
 */
function enforceTextRateLimit(request) {
  return enforceIpRateLimit({
    ...request,
    kind: "text",
    cost: countTextCreationActions(request.data),
    exceededEventName: "TEXT_RATE_LIMIT_EXCEEDED",
  });
}

/**
 * @param {RateLimitRequest} request
 * @returns {boolean}
 */
function enforceBroadcastPreNormalization(request) {
  return enforceGeneralRateLimit(request);
}

/**
 * @param {RateLimitRequest} request
 * @returns {boolean}
 */
function enforceBroadcastPostNormalization(request) {
  return (
    enforceDestructiveRateLimit(request) &&
    enforceConstructiveRateLimit(request) &&
    enforceTextRateLimit(request)
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
