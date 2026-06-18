import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { optimisticPrunePlanForAuthoritativeMessage } from "./authoritative_mutation_effects.js";
import MessageCommon from "./message_common.js";
import {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} from "./optimistic_mutation.js";
import RateLimitCommon from "./rate_limit_common.js";
import { SocketEvents } from "./socket_events.js";

/** @import { AppToolsState, BoardMessage, BufferedWrite, ClientTrackedMessage, LiveBoardMessage, RateLimitCosts, RateLimitKind } from "../../types/app-runtime" */
/** @typedef {{tool: import("../tools/tool-order.js").ToolCode, type?: unknown, id?: unknown, parent?: string, txt?: unknown, _children?: unknown, clientMutationId?: string, socket?: string, userId?: string, color?: string, size?: number | string, opacity?: number, x?: number, y?: number, x2?: number, y2?: number, newid?: string, transform?: {a: number, b: number, c: number, d: number, e: number, f: number}}} RuntimeBoardMessage */

// Keep a bounded safety margin between the client-side local budget and the
// server's fixed window to absorb emit/receive skew. The buffer must be large
// enough that a queued write does not reconnect-loop under load by landing just
// before the server window resets.
const RATE_LIMIT_FLUSH_SAFETY_MIN_MS = 250;
const RATE_LIMIT_FLUSH_SAFETY_MAX_MS = 1500;
const RATE_LIMIT_KINDS = /** @type {RateLimitKind[]} */ (
  RateLimitCommon.RATE_LIMIT_KINDS
);

/** @param {LiveBoardMessage} message */
function getClientMutationId(message) {
  return typeof message.clientMutationId === "string" &&
    message.clientMutationId.length > 0
    ? message.clientMutationId
    : null;
}

/**
 * @param {LiveBoardMessage} message
 * @param {RateLimitCosts} costs
 * @returns {BufferedWrite}
 */
function createBufferedWrite(message, costs) {
  return {
    message,
    costs,
    state: "queued",
    notBeforeMs: Date.now(),
  };
}

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
  getBufferedWriteBudgetWaitMs(bufferedWrite, now) {
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

  /**
   * @param {BufferedWrite} bufferedWrite
   * @param {number} now
   * @returns {boolean}
   */
  deferBufferedWriteIfRateLimited(bufferedWrite, now) {
    const waitMs = this.getBufferedWriteBudgetWaitMs(bufferedWrite, now);
    if (!(waitMs > 0)) return false;
    const deferMs = waitMs + this.getBufferedWriteFlushSafetyMs(waitMs);
    bufferedWrite.notBeforeMs = Math.max(
      bufferedWrite.notBeforeMs,
      now + deferMs,
    );
    return true;
  }

  /**
   * @param {number} notBeforeMs
   * @param {boolean} [redrawOnSend]
   */
  deferBufferedWritesUntil(notBeforeMs, redrawOnSend) {
    this.bufferedWrites.forEach((bufferedWrite) => {
      bufferedWrite.state = "queued";
      bufferedWrite.notBeforeMs = Math.max(
        bufferedWrite.notBeforeMs,
        notBeforeMs,
      );
      if (redrawOnSend && getClientMutationId(bufferedWrite.message)) {
        bufferedWrite.redrawOnSend = true;
      }
    });
    this.localRateLimitedUntil = 0;
    this.clearBufferedWriteTimer();
    this.scheduleBufferedWriteFlush();
  }

  /** @param {number} waitMs */
  getBufferedWriteFlushSafetyMs(waitMs) {
    return Math.min(
      RATE_LIMIT_FLUSH_SAFETY_MAX_MS,
      Math.max(RATE_LIMIT_FLUSH_SAFETY_MIN_MS, Math.ceil(Math.max(0, waitMs))),
    );
  }

  /** @returns {BufferedWrite | undefined} */
  getNextQueuedWrite() {
    return this.bufferedWrites.find(
      (bufferedWrite) => bufferedWrite.state === "queued",
    );
  }

  scheduleBufferedWriteFlush() {
    const Tools = this.getTools();
    this.clearBufferedWriteTimer();
    const nextWrite = this.getNextQueuedWrite();
    if (!nextWrite || !this.canBufferWrites()) {
      Tools.status.syncWriteStatusIndicator();
      return;
    }
    const now = Date.now();
    this.deferBufferedWriteIfRateLimited(nextWrite, now);
    const waitMs = Math.max(0, nextWrite.notBeforeMs - now);
    this.localRateLimitedUntil = waitMs > 0 ? now + waitMs : 0;
    this.bufferedWriteTimer = window.setTimeout(function pumpBufferedWrites() {
      Tools.writes.pumpBufferedWrites();
    }, waitMs);
    Tools.status.syncWriteStatusIndicator();
  }

  /** @param {BufferedWrite} bufferedWrite */
  redrawBufferedWriteIfNeeded(bufferedWrite) {
    if (!bufferedWrite.redrawOnSend) return;
    bufferedWrite.redrawOnSend = false;
    const Tools = this.getTools();
    const toolName = TOOL_ID_BY_CODE[bufferedWrite.message.tool];
    const mountedTool = toolName ? Tools.toolRegistry.mounted[toolName] : null;
    if (!mountedTool) return;

    const trackedMessage = /** @type {ClientTrackedMessage} */ (
      bufferedWrite.message
    );
    const rollback = Tools.optimistic.captureRollback(trackedMessage);
    mountedTool.draw(trackedMessage, true);
    Tools.optimistic.trackMutation(trackedMessage, rollback);
  }

  /**
   * @param {BufferedWrite} bufferedWrite
   * @param {number} now
   */
  emitBufferedWrite(bufferedWrite, now) {
    const Tools = this.getTools();
    this.consumeBufferedWriteBudget(bufferedWrite, now);
    this.redrawBufferedWriteIfNeeded(bufferedWrite);
    Tools.presence.updateCurrentConnectedUserFromActivity(
      bufferedWrite.message,
    );
    if (Tools.connection.socket) {
      Tools.connection.socket.emit(
        SocketEvents.BROADCAST,
        bufferedWrite.message,
      );
    }
    if (getClientMutationId(bufferedWrite.message)) {
      bufferedWrite.state = "inflight";
      return;
    }
    const index = this.bufferedWrites.indexOf(bufferedWrite);
    if (index >= 0) this.bufferedWrites.splice(index, 1);
  }

  pumpBufferedWrites() {
    const Tools = this.getTools();
    this.clearBufferedWriteTimer();
    this.localRateLimitedUntil = 0;
    if (!this.canBufferWrites()) {
      Tools.status.syncWriteStatusIndicator();
      return;
    }
    while (true) {
      const bufferedWrite = this.getNextQueuedWrite();
      if (!bufferedWrite) break;
      const now = Date.now();
      if (bufferedWrite.notBeforeMs > now) {
        this.scheduleBufferedWriteFlush();
        return;
      }
      if (this.deferBufferedWriteIfRateLimited(bufferedWrite, now)) {
        this.scheduleBufferedWriteFlush();
        return;
      }
      this.emitBufferedWrite(bufferedWrite, now);
    }
    Tools.status.syncWriteStatusIndicator();
  }

  /**
   * @param {string | undefined} clientMutationId
   * @returns {boolean}
   */
  resolveBufferedWrite(clientMutationId) {
    if (!clientMutationId) return false;
    const index = this.bufferedWrites.findIndex(
      (bufferedWrite) =>
        getClientMutationId(bufferedWrite.message) === clientMutationId,
    );
    if (index < 0) return false;
    this.bufferedWrites.splice(index, 1);
    this.scheduleBufferedWriteFlush();
    return true;
  }

  /**
   * Takes ownership of message. Callers must not mutate it after queueing.
   * @param {RuntimeBoardMessage} message
   */
  enqueueBufferedWrite(message) {
    const Tools = this.getTools();
    const liveMessage = /** @type {LiveBoardMessage} */ (message);
    this.bufferedWrites.push(
      createBufferedWrite(
        liveMessage,
        Tools.rateLimits.getBufferedWriteCosts(liveMessage),
      ),
    );
    this.scheduleBufferedWriteFlush();
  }

  /**
   * Takes ownership of message. Callers must not mutate it after sending.
   * @param {RuntimeBoardMessage} message
   */
  sendBufferedWrite(message) {
    const Tools = this.getTools();
    const liveMessage = /** @type {LiveBoardMessage} */ (message);
    if (!this.canBufferWrites()) {
      return false;
    }
    this.bufferedWrites.push(
      createBufferedWrite(
        liveMessage,
        Tools.rateLimits.getBufferedWriteCosts(liveMessage),
      ),
    );
    this.pumpBufferedWrites();
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
      Tools.access.canClear !== true &&
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
