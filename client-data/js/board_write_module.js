import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { optimisticPrunePlanForAuthoritativeMessage } from "./authoritative_mutation_effects.js";
import MessageCommon from "./message_common.js";
import {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} from "./optimistic_mutation.js";
import RateLimitCommon from "./rate_limit_common.js";
import { SocketEvents } from "./socket_events.js";

/** @import { AppToolsState, BoardMessage, BufferedWrite, ClientTrackedMessage, LiveBoardMessage, RateLimitKind } from "../../types/app-runtime" */
/** @typedef {{tool: import("../tools/tool-order.js").ToolCode, type?: unknown, id?: unknown, txt?: unknown, _children?: unknown, clientMutationId?: string, socket?: string, userId?: string, color?: string, size?: number | string}} RuntimeBoardMessage */

// Keep a bounded safety margin between the client-side local budget and the
// server's fixed window to absorb emit/receive skew. The buffer must be large
// enough that a queued write does not reconnect-loop under load by landing just
// before the server window resets.
const RATE_LIMIT_FLUSH_SAFETY_MIN_MS = 250;
const RATE_LIMIT_FLUSH_SAFETY_MAX_MS = 1500;
const RATE_LIMIT_KINDS = /** @type {RateLimitKind[]} */ (
  RateLimitCommon.RATE_LIMIT_KINDS
);

export class WriteModule {
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
    this.bufferedWrites = /** @type {BufferedWrite[]} */ ([]);
    this.bufferedWriteTimer = /** @type {number | null} */ (null);
    this.writeReadyWaiters = /** @type {Array<() => void>} */ ([]);
    this.serverRateLimitedUntil = 0;
    this.localRateLimitedUntil = 0;
    this.localRateLimitStates = {
      general: RateLimitCommon.createRateLimitState(Date.now()),
      constructive: RateLimitCommon.createRateLimitState(Date.now()),
      destructive: RateLimitCommon.createRateLimitState(Date.now()),
      text: RateLimitCommon.createRateLimitState(Date.now()),
    };
  }

  clearBufferedWriteTimer() {
    if (this.bufferedWriteTimer) {
      clearTimeout(this.bufferedWriteTimer);
      this.bufferedWriteTimer = null;
    }
  }

  /** @param {number} [now] */
  isWritePaused(now) {
    return this.serverRateLimitedUntil > (now || Date.now());
  }

  canBufferWrites() {
    const Tools = this.getTools();
    return !!(
      Tools.connection.socket &&
      Tools.connection.socket.connected &&
      !Tools.replay.awaitingSnapshot &&
      !this.isWritePaused()
    );
  }

  whenBoardWritable() {
    if (this.canBufferWrites()) return Promise.resolve();
    return new Promise(
      /** @param {(value?: void | PromiseLike<void>) => void} resolve */ (
        resolve,
      ) => {
        this.writeReadyWaiters.push(() => resolve());
      },
    );
  }

  /**
   * @param {RateLimitKind} kind
   * @param {number} [now]
   */
  resetLocalRateLimitState(kind, now) {
    this.localRateLimitStates[kind] = RateLimitCommon.createRateLimitState(
      now || Date.now(),
    );
  }

  /** @param {number} [now] */
  resetAllLocalRateLimitStates(now) {
    this.resetLocalRateLimitState("general", now);
    this.resetLocalRateLimitState("constructive", now);
    this.resetLocalRateLimitState("destructive", now);
    this.resetLocalRateLimitState("text", now);
  }

  /**
   * @param {BufferedWrite} bufferedWrite
   * @param {number} now
   */
  canEmitBufferedWrite(bufferedWrite, now) {
    const Tools = this.getTools();
    return RATE_LIMIT_KINDS.every((kind) => {
      const cost = bufferedWrite.costs[kind];
      if (!(cost > 0)) return true;
      const definition = Tools.rateLimits.getEffectiveRateLimit(kind);
      if (!(definition.periodMs > 0) || !(definition.limit >= 0)) return true;
      return RateLimitCommon.canConsumeFixedWindowRateLimit(
        this.localRateLimitStates[kind],
        cost,
        definition.limit,
        definition.periodMs,
        now,
      );
    });
  }

  /**
   * @param {BufferedWrite} bufferedWrite
   * @param {number} now
   */
  consumeBufferedWriteBudget(bufferedWrite, now) {
    const Tools = this.getTools();
    RATE_LIMIT_KINDS.forEach((kind) => {
      const cost = bufferedWrite.costs[kind];
      if (!(cost > 0)) return;
      const definition = Tools.rateLimits.getEffectiveRateLimit(kind);
      if (!(definition.periodMs > 0)) return;
      this.localRateLimitStates[kind] =
        RateLimitCommon.consumeFixedWindowRateLimit(
          this.localRateLimitStates[kind],
          cost,
          definition.periodMs,
          now,
        );
    });
  }

  /**
   * @param {BufferedWrite} bufferedWrite
   * @param {number} now
   */
  getBufferedWriteWaitMs(bufferedWrite, now) {
    const Tools = this.getTools();
    return RATE_LIMIT_KINDS.reduce((waitMs, kind) => {
      const cost = bufferedWrite.costs[kind];
      if (!(cost > 0)) return waitMs;
      const definition = Tools.rateLimits.getEffectiveRateLimit(kind);
      if (!(definition.periodMs > 0)) return waitMs;
      if (
        RateLimitCommon.canConsumeFixedWindowRateLimit(
          this.localRateLimitStates[kind],
          cost,
          definition.limit,
          definition.periodMs,
          now,
        )
      ) {
        return waitMs;
      }
      return Math.max(
        waitMs,
        RateLimitCommon.getRateLimitRemainingMs(
          this.localRateLimitStates[kind],
          definition.periodMs,
          now,
        ),
      );
    }, 0);
  }

  /** @param {number} waitMs */
  getBufferedWriteFlushSafetyMs(waitMs) {
    return Math.min(
      RATE_LIMIT_FLUSH_SAFETY_MAX_MS,
      Math.max(RATE_LIMIT_FLUSH_SAFETY_MIN_MS, Math.ceil(Math.max(0, waitMs))),
    );
  }

  scheduleBufferedWriteFlush() {
    const Tools = this.getTools();
    this.clearBufferedWriteTimer();
    if (!this.bufferedWrites.length || !this.canBufferWrites()) {
      Tools.status.syncWriteStatusIndicator();
      return;
    }
    const nextWrite = this.bufferedWrites[0];
    if (!nextWrite) return;
    const now = Date.now();
    const waitMs = this.getBufferedWriteWaitMs(nextWrite, now);
    this.localRateLimitedUntil = waitMs > 0 ? now + waitMs : 0;
    this.bufferedWriteTimer = window.setTimeout(
      function flushBufferedWrites() {
        Tools.writes.flushBufferedWrites();
      },
      Math.max(0, waitMs + this.getBufferedWriteFlushSafetyMs(waitMs)),
    );
    Tools.status.syncWriteStatusIndicator();
  }

  flushBufferedWrites() {
    const Tools = this.getTools();
    this.clearBufferedWriteTimer();
    this.localRateLimitedUntil = 0;
    if (!this.canBufferWrites()) {
      Tools.status.syncWriteStatusIndicator();
      return;
    }
    while (this.bufferedWrites.length > 0) {
      const bufferedWrite = this.bufferedWrites[0];
      if (!bufferedWrite) break;
      const now = Date.now();
      if (!this.canEmitBufferedWrite(bufferedWrite, now)) {
        this.scheduleBufferedWriteFlush();
        return;
      }
      this.bufferedWrites.shift();
      this.consumeBufferedWriteBudget(bufferedWrite, now);
      Tools.presence.updateCurrentConnectedUserFromActivity(
        bufferedWrite.message,
      );
      if (Tools.connection.socket) {
        Tools.connection.socket.emit(
          SocketEvents.BROADCAST,
          bufferedWrite.message,
        );
      }
    }
    Tools.status.syncWriteStatusIndicator();
  }

  /**
   * Takes ownership of message. Callers must not mutate it after queueing.
   * @param {RuntimeBoardMessage} message
   */
  enqueueBufferedWrite(message) {
    const Tools = this.getTools();
    const liveMessage = /** @type {LiveBoardMessage} */ (message);
    this.bufferedWrites.push({
      message: liveMessage,
      costs: Tools.rateLimits.getBufferedWriteCosts(liveMessage),
    });
    this.scheduleBufferedWriteFlush();
  }

  /**
   * Takes ownership of message. Callers must not mutate it after sending.
   * @param {RuntimeBoardMessage} message
   */
  sendBufferedWrite(message) {
    const Tools = this.getTools();
    const liveMessage = /** @type {LiveBoardMessage} */ (message);
    /** @type {BufferedWrite} */
    const bufferedWrite = {
      message: liveMessage,
      costs: Tools.rateLimits.getBufferedWriteCosts(liveMessage),
    };
    if (!this.canBufferWrites()) {
      return false;
    }
    const now = Date.now();
    if (
      this.bufferedWrites.length === 0 &&
      this.canEmitBufferedWrite(bufferedWrite, now)
    ) {
      this.consumeBufferedWriteBudget(bufferedWrite, now);
      Tools.presence.updateCurrentConnectedUserFromActivity(liveMessage);
      if (Tools.connection.socket) {
        Tools.connection.socket.emit(SocketEvents.BROADCAST, liveMessage);
      }
      Tools.status.syncWriteStatusIndicator();
      return true;
    }
    this.bufferedWrites.push(bufferedWrite);
    this.scheduleBufferedWriteFlush();
    return true;
  }

  discardBufferedWrites() {
    const Tools = this.getTools();
    this.bufferedWrites = [];
    this.localRateLimitedUntil = 0;
    this.clearBufferedWriteTimer();
    Tools.status.syncWriteStatusIndicator();
  }

  /**
   * @param {BoardMessage} message
   * @param {Set<string>} invalidatedIds
   * @returns {boolean}
   */
  messageReferencesInvalidatedId(message, invalidatedIds) {
    for (const itemId of collectOptimisticAffectedIds(message)) {
      if (invalidatedIds.has(itemId)) return true;
    }
    for (const itemId of collectOptimisticDependencyIds(message)) {
      if (invalidatedIds.has(itemId)) return true;
    }
    return false;
  }

  /**
   * @param {BoardMessage} message
   * @returns {void}
   */
  pruneBufferedWritesForInvalidatingMessage(message) {
    if (this.bufferedWrites.length === 0) return;
    const prunePlan = optimisticPrunePlanForAuthoritativeMessage(message);
    if (prunePlan.reset) {
      this.discardBufferedWrites();
      return;
    }
    if (prunePlan.invalidatedIds.length === 0) return;
    const invalidatedIds = new Set(prunePlan.invalidatedIds);
    const nextBufferedWrites = this.bufferedWrites.filter(
      (bufferedWrite) =>
        !this.messageReferencesInvalidatedId(
          bufferedWrite.message,
          invalidatedIds,
        ),
    );
    if (nextBufferedWrites.length === this.bufferedWrites.length) return;
    this.bufferedWrites = nextBufferedWrites;
    this.scheduleBufferedWriteFlush();
  }

  /**
   * Takes ownership of data. Callers must not mutate it after sending.
   * @param {RuntimeBoardMessage} data
   */
  send(data) {
    const Tools = this.getTools();
    const liveData = /** @type {LiveBoardMessage} */ (data);
    Tools.messages.applyHooks(Tools.messages.hooks, liveData);
    return this.sendBufferedWrite(liveData);
  }

  /**
   * @param {LiveBoardMessage} message
   * @returns {ClientTrackedMessage}
   */
  assignClientMutationId(message) {
    const Tools = this.getTools();
    message.clientMutationId = Tools.ids.generateUID("cm-");
    return /** @type {ClientTrackedMessage} */ (message);
  }

  /**
   * Takes ownership of data. Callers must create a fresh message object and
   * must not mutate it after calling this function, because it may be queued
   * and sent asynchronously.
   * @param {RuntimeBoardMessage} data
   */
  drawAndSend(data) {
    const Tools = this.getTools();
    const toolName = TOOL_ID_BY_CODE[data.tool];
    if (!toolName) throw new Error(`Unknown tool '${data.tool}'.`);
    const mountedTool = Tools.toolRegistry.mounted[toolName];
    if (!mountedTool) throw new Error(`Missing mounted tool '${data.tool}'.`);
    if (Tools.toolRegistry.shouldDisableTool(toolName)) return false;
    if (
      !Tools.connection.socket ||
      !Tools.connection.socket.connected ||
      Tools.replay.awaitingSnapshot ||
      this.isWritePaused()
    ) {
      return false;
    }

    if (toolName === "cursor") {
      mountedTool.draw(/** @type {LiveBoardMessage} */ (data), true);
      return this.send(data) !== false;
    }

    const trackedData = this.assignClientMutationId(
      /** @type {LiveBoardMessage} */ (data),
    );
    const rollback = Tools.optimistic.captureRollback(trackedData);

    // Optimistically render the drawing immediately.
    mountedTool.draw(trackedData, true);

    if (
      MessageCommon.requiresTurnstile(Tools.identity.boardName, toolName) &&
      Tools.config.serverConfig.TURNSTILE_SITE_KEY &&
      !Tools.turnstile.isValidated()
    ) {
      Tools.optimistic.trackMutation(trackedData, rollback);
      Tools.turnstile.queueProtectedWrite(trackedData);
      return true;
    }

    const sent = this.send(trackedData) !== false;
    if (sent) {
      Tools.optimistic.trackMutation(trackedData, rollback);
    }
    return sent;
  }
}
