import RateLimitCommon from "../../client-data/js/rate_limit_common.js";
import { SocketEvents } from "../../client-data/js/socket_events.js";
import observability from "../observability/index.mjs";
import {
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
} from "./policy.mjs";

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
/** @typedef {"ip" | "socket"} RateLimitScope */
/**
 * @typedef {BaseRateLimitState & {
 *   metricBoardAnonymous?: boolean,
 *   metricLimit?: number,
 *   metricPeriodMs?: number,
 *   metricRecordedWindowStart?: number,
 * }} RateLimitState
 */

/** @type {Map<string, RateLimitState>} */
const destructiveRateLimits = new Map();
/** @type {Map<string, RateLimitState>} */
const constructiveRateLimits = new Map();
/** @type {Map<string, RateLimitState>} */
const textRateLimits = new Map();

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
 * @param {"general" | "constructive" | "destructive" | "text"} kind
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
 * @returns {RateLimitScope}
 */
function getRateLimitScope(kind) {
  return kind === "general" ? "socket" : "ip";
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
    scope: getRateLimitScope(kind),
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
 * @returns {void}
 */
function pruneRateLimitMap(map, kind, periodMs, now) {
  map.forEach(
    function pruneEntry(
      /** @type {RateLimitState} */ state,
      /** @type {string} */ key,
    ) {
      if (isRateLimitStateStale(state, periodMs, now)) {
        recordCompletedRateLimitWindow(kind, state, "pruned");
        map.delete(key);
      }
    },
  );
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
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData | undefined} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {RateLimitState} rateLimitState
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {boolean}
 */
function enforceGeneralRateLimit(
  socket,
  boardName,
  data,
  clientIp,
  userName,
  rateLimitState,
  now,
  config,
) {
  recordExpiredRateLimitWindowIfNeeded("general", rateLimitState, now);
  const generalLimit = getEffectiveRateLimitConfig(
    "general",
    boardName,
    config,
  );
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    1,
    generalLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    generalLimit.limit,
    generalLimit.periodMs,
  );
  if (rateLimitState.count <= generalLimit.limit) return true;
  recordCompletedRateLimitWindow("general", rateLimitState, "exceeded");
  const retryAfterMs = getRateLimitRemainingMs(
    rateLimitState,
    generalLimit.periodMs,
    now,
  );

  tracing.withDetachedSpan(
    "socket.rate_limited",
    {
      attributes: socketTraceAttributes("broadcast_write", {
        "wbo.board": boardName,
        "user.name": userName,
        "wbo.rate_limit.kind": "general",
        "wbo.rejection.reason": "rate_limit",
      }),
    },
    function logGeneralRateLimit() {
      logger.warn("socket.rate_limited", {
        kind: "general",
        socket: socket.id,
        board: boardName,
        "client.address": clientIp,
        count: rateLimitState.count,
        limit: generalLimit.limit,
        period_ms: generalLimit.periodMs,
        retry_after_ms: retryAfterMs,
        "user.name": userName,
      });
      metrics.recordBoardMessage(
        { board: boardName, ...(data || {}) },
        "rate_limit.general",
      );
    },
  );
  closeRateLimitedSocket(
    socket,
    "GENERAL_RATE_LIMIT_EXCEEDED",
    buildSocketLogInfo(socket, boardName, {
      kind: "general",
      ip: clientIp,
      count: rateLimitState.count,
      limit: generalLimit.limit,
      period_ms: generalLimit.periodMs,
      retry_after_ms: retryAfterMs,
    }),
  );
  return false;
}

/**
 * @param {string} clientIp
 * @param {number} now
 * @returns {RateLimitState}
 */
function getDestructiveRateLimitState(clientIp, now) {
  const rateLimitState =
    destructiveRateLimits.get(clientIp) || createRateLimitState(now);
  destructiveRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {boolean}
 */
function enforceDestructiveRateLimit(
  socket,
  boardName,
  data,
  clientIp,
  userName,
  now,
  config,
) {
  const destructiveCost = countDestructiveActions(data);
  if (destructiveCost === 0) return true;

  const rateLimitState = getDestructiveRateLimitState(clientIp, now);
  recordExpiredRateLimitWindowIfNeeded("destructive", rateLimitState, now);
  const destructiveLimit = getEffectiveRateLimitConfig(
    "destructive",
    boardName,
    config,
  );
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    destructiveCost,
    destructiveLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    destructiveLimit.limit,
    destructiveLimit.periodMs,
  );
  if (rateLimitState.count > destructiveLimit.limit) {
    recordCompletedRateLimitWindow("destructive", rateLimitState, "exceeded");
    const retryAfterMs = getRateLimitRemainingMs(
      rateLimitState,
      destructiveLimit.periodMs,
      now,
    );
    tracing.withDetachedSpan(
      "socket.rate_limited",
      {
        attributes: socketTraceAttributes("broadcast_write", {
          "wbo.board": boardName,
          "user.name": userName,
          "wbo.rate_limit.kind": "destructive",
          "wbo.rejection.reason": "rate_limit",
          "wbo.destructive_cost": destructiveCost,
        }),
      },
      function logDestructiveRateLimit() {
        logger.warn("socket.rate_limited", {
          kind: "destructive",
          socket: socket.id,
          board: boardName,
          "client.address": clientIp,
          "user.name": userName,
          count: rateLimitState.count,
          limit: destructiveLimit.limit,
          period_ms: destructiveLimit.periodMs,
          retry_after_ms: retryAfterMs,
          destructive_cost: destructiveCost,
        });
        metrics.recordBoardMessage(
          { board: boardName, ...data },
          "rate_limit.destructive",
        );
      },
    );
    closeRateLimitedSocket(
      socket,
      "DESTRUCTIVE_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        kind: "destructive",
        ip: clientIp,
        count: rateLimitState.count,
        limit: destructiveLimit.limit,
        period_ms: destructiveLimit.periodMs,
        retry_after_ms: retryAfterMs,
        destructive_cost: destructiveCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(
    destructiveRateLimits,
    "destructive",
    destructiveLimit.periodMs,
    now,
  );
  return true;
}

/**
 * @param {string} clientIp
 * @param {number} now
 * @returns {RateLimitState}
 */
function getConstructiveRateLimitState(clientIp, now) {
  const rateLimitState =
    constructiveRateLimits.get(clientIp) || createRateLimitState(now);
  constructiveRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

/**
 * @param {string} clientIp
 * @param {number} now
 * @returns {RateLimitState}
 */
function getTextRateLimitState(clientIp, now) {
  const rateLimitState =
    textRateLimits.get(clientIp) || createRateLimitState(now);
  textRateLimits.set(clientIp, rateLimitState);
  return rateLimitState;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {boolean}
 */
function enforceConstructiveRateLimit(
  socket,
  boardName,
  data,
  clientIp,
  userName,
  now,
  config,
) {
  const constructiveCost = countConstructiveActions(data);
  if (constructiveCost === 0) return true;

  const rateLimitState = getConstructiveRateLimitState(clientIp, now);
  recordExpiredRateLimitWindowIfNeeded("constructive", rateLimitState, now);
  const constructiveLimit = getEffectiveRateLimitConfig(
    "constructive",
    boardName,
    config,
  );
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    constructiveCost,
    constructiveLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    constructiveLimit.limit,
    constructiveLimit.periodMs,
  );
  if (rateLimitState.count > constructiveLimit.limit) {
    recordCompletedRateLimitWindow("constructive", rateLimitState, "exceeded");
    const retryAfterMs = getRateLimitRemainingMs(
      rateLimitState,
      constructiveLimit.periodMs,
      now,
    );
    tracing.withDetachedSpan(
      "socket.rate_limited",
      {
        attributes: socketTraceAttributes("broadcast_write", {
          "wbo.board": boardName,
          "user.name": userName,
          "wbo.rate_limit.kind": "constructive",
          "wbo.rejection.reason": "rate_limit",
          "wbo.constructive_cost": constructiveCost,
        }),
      },
      function logConstructiveRateLimit() {
        logger.warn("socket.rate_limited", {
          kind: "constructive",
          socket: socket.id,
          board: boardName,
          "client.address": clientIp,
          "user.name": userName,
          count: rateLimitState.count,
          limit: constructiveLimit.limit,
          period_ms: constructiveLimit.periodMs,
          retry_after_ms: retryAfterMs,
          constructive_cost: constructiveCost,
        });
        metrics.recordBoardMessage(
          { board: boardName, ...data },
          "rate_limit.constructive",
        );
      },
    );
    closeRateLimitedSocket(
      socket,
      "CONSTRUCTIVE_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        kind: "constructive",
        ip: clientIp,
        count: rateLimitState.count,
        limit: constructiveLimit.limit,
        period_ms: constructiveLimit.periodMs,
        retry_after_ms: retryAfterMs,
        constructive_cost: constructiveCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(
    constructiveRateLimits,
    "constructive",
    constructiveLimit.periodMs,
    now,
  );
  return true;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {boolean}
 */
function enforceTextRateLimit(
  socket,
  boardName,
  data,
  clientIp,
  userName,
  now,
  config,
) {
  const textCost = countTextCreationActions(data);
  if (textCost === 0) return true;

  const rateLimitState = getTextRateLimitState(clientIp, now);
  recordExpiredRateLimitWindowIfNeeded("text", rateLimitState, now);
  const textLimit = getEffectiveRateLimitConfig("text", boardName, config);
  const nextState = consumeFixedWindowRateLimit(
    rateLimitState,
    textCost,
    textLimit.periodMs,
    now,
  );
  rateLimitState.windowStart = nextState.windowStart;
  rateLimitState.count = nextState.count;
  rateLimitState.lastSeen = nextState.lastSeen;
  updateRateLimitStateMetricMetadata(
    rateLimitState,
    boardName,
    textLimit.limit,
    textLimit.periodMs,
  );
  if (rateLimitState.count > textLimit.limit) {
    recordCompletedRateLimitWindow("text", rateLimitState, "exceeded");
    const retryAfterMs = getRateLimitRemainingMs(
      rateLimitState,
      textLimit.periodMs,
      now,
    );
    tracing.withDetachedSpan(
      "socket.rate_limited",
      {
        attributes: socketTraceAttributes("broadcast_write", {
          "wbo.board": boardName,
          "user.name": userName,
          "wbo.rate_limit.kind": "text",
          "wbo.rejection.reason": "rate_limit",
          "wbo.text_cost": textCost,
        }),
      },
      function logTextRateLimit() {
        logger.warn("socket.rate_limited", {
          kind: "text",
          socket: socket.id,
          board: boardName,
          "client.address": clientIp,
          "user.name": userName,
          count: rateLimitState.count,
          limit: textLimit.limit,
          period_ms: textLimit.periodMs,
          retry_after_ms: retryAfterMs,
          text_cost: textCost,
        });
        metrics.recordBoardMessage(
          { board: boardName, ...data },
          "rate_limit.text",
        );
      },
    );
    closeRateLimitedSocket(
      socket,
      "TEXT_RATE_LIMIT_EXCEEDED",
      buildSocketLogInfo(socket, boardName, {
        kind: "text",
        ip: clientIp,
        count: rateLimitState.count,
        limit: textLimit.limit,
        period_ms: textLimit.periodMs,
        retry_after_ms: retryAfterMs,
        text_cost: textCost,
      }),
    );
    return false;
  }

  pruneRateLimitMap(textRateLimits, "text", textLimit.periodMs, now);
  return true;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData | undefined} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {RateLimitState} generalRateLimit
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {boolean}
 */
function enforceBroadcastPreNormalization(
  socket,
  boardName,
  data,
  clientIp,
  userName,
  generalRateLimit,
  now,
  config,
) {
  return enforceGeneralRateLimit(
    socket,
    boardName,
    data,
    clientIp,
    userName,
    generalRateLimit,
    now,
    config,
  );
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {boolean}
 */
function enforceBroadcastPostNormalization(
  socket,
  boardName,
  data,
  clientIp,
  userName,
  now,
  config,
) {
  return (
    enforceDestructiveRateLimit(
      socket,
      boardName,
      data,
      clientIp,
      userName,
      now,
      config,
    ) &&
    enforceConstructiveRateLimit(
      socket,
      boardName,
      data,
      clientIp,
      userName,
      now,
      config,
    ) &&
    enforceTextRateLimit(
      socket,
      boardName,
      data,
      clientIp,
      userName,
      now,
      config,
    )
  );
}

/**
 * @returns {void}
 */
function resetRateLimitMaps() {
  destructiveRateLimits.clear();
  constructiveRateLimits.clear();
  textRateLimits.clear();
}

export {
  consumeFixedWindowRateLimit,
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
  createRateLimitState,
  enforceBroadcastPostNormalization,
  enforceBroadcastPreNormalization,
  pruneRateLimitMap,
  recordCompletedRateLimitWindow,
  resetRateLimitMaps,
};
