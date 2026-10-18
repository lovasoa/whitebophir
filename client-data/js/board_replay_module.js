import * as BoardMessageReplay from "./board_message_replay.js";
import {
  buildBoardSvgBaselineUrl,
  parseServedBaselineSvgText,
} from "./board_svg_baseline.js";

/** @import { AppToolsState, AuthoritativeBaseline, IncomingBroadcast } from "../../types/app-runtime" */

const DENSE_BOARD_ITEMS = 8192;
const DRAWING_BROADCAST_BATCH_MS = 100;

/**
 * @param {number | undefined} [cacheBust]
 * @returns {string}
 */
export function getAuthoritativeBaselineUrl(cacheBust) {
  const url = new URL(
    buildBoardSvgBaselineUrl(window.location.pathname, window.location.search),
    window.location.href,
  );
  if (cacheBust !== undefined) {
    url.searchParams.set("baselineRefresh", String(cacheBust));
  }
  return `${url.pathname}${url.search}`;
}

export class ReplayModule {
  /**
   * @param {() => AppToolsState} getTools
   * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logBoardEvent
   */
  constructor(getTools, logBoardEvent) {
    this.getTools = getTools;
    this.logBoardEvent = logBoardEvent;
    this.awaitingSnapshot = true;
    this.hasAuthoritativeSnapshot = false;
    this.refreshBaselineBeforeConnect = false;
    this.authoritativeSeq = 0;
    this.preSnapshotMessages = /** @type {IncomingBroadcast[]} */ ([]);
    this.incomingBroadcastQueue = /** @type {IncomingBroadcast[]} */ ([]);
    this.processingIncomingBroadcast = /** @type {number | null} */ (null);
    this.broadcastTimer = 0;
  }

  /** @param {AuthoritativeBaseline} baseline */
  applyAuthoritativeBaseline(baseline) {
    const Tools = this.getTools();
    if (Tools.dom.status !== "attached") return;
    const dom = Tools.dom;
    this.hasAuthoritativeSnapshot = true;
    this.authoritativeSeq = baseline.seq;
    Tools.optimistic.journal.reset();
    dom.svg.setAttribute("data-wbo-seq", String(baseline.seq));
    dom.svg.setAttribute(
      "data-wbo-readonly",
      baseline.readonly ? "true" : "false",
    );
    if (baseline.drawingArea) {
      // Move the already parsed SVG nodes instead of serializing and parsing
      // every item again. A fragment avoids an argument-count limit on dense
      // boards and keeps the live drawing area replacement atomic.
      const fragment = document.createDocumentFragment();
      while (baseline.drawingArea.firstChild) {
        fragment.appendChild(baseline.drawingArea.firstChild);
      }
      dom.drawingArea.replaceChildren(fragment);
    } else {
      dom.drawingArea.innerHTML = baseline.drawingAreaMarkup;
    }
    Tools.toolRegistry.normalizeServerRenderedElements();
  }

  async refreshAuthoritativeBaseline() {
    const connection = this.getTools().connection;
    const generation = connection.generation;
    const response = await fetch(getAuthoritativeBaselineUrl(Date.now()), {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "image/svg+xml" },
    });
    if (!response.ok) {
      throw new Error(`Baseline fetch failed with HTTP ${response.status}`);
    }
    const text = await response.text();
    if (generation !== connection.generation) return;
    this.applyAuthoritativeBaseline(
      parseServedBaselineSvgText(text, new DOMParser()),
    );
  }

  /** @param {{preserveBufferedWrites?: boolean}} [options] */
  beginAuthoritativeResync(options) {
    const Tools = this.getTools();
    window.clearTimeout(this.broadcastTimer);
    this.broadcastTimer = 0;
    Tools.connection.generation++;
    this.awaitingSnapshot = true;
    this.refreshBaselineBeforeConnect = true;
    Tools.optimistic.journal.reset();
    this.preSnapshotMessages = [];
    this.incomingBroadcastQueue = [];
    Tools.toolRegistry.pendingMessages = {};
    if (!options?.preserveBufferedWrites) {
      Tools.writes.discardBufferedWrites();
    }
    Tools.turnstile.pendingWrites = [];
    Tools.turnstile.hideOverlay();
    Tools.interaction.releaseAll();
    Tools.presence.clearConnectedUsers();
    Tools.dom.clearBoardCursors();
    Object.values(Tools.toolRegistry.mounted || {}).forEach((tool) => {
      if (tool) tool.onSocketDisconnect();
    });
    Tools.toolRegistry.syncActiveToolInputPolicy();
    Tools.status.syncWriteStatusIndicator();
  }

  /** @param {IncomingBroadcast} msg @returns {Promise<boolean>} */
  async processIncomingBroadcast(msg) {
    const Tools = this.getTools();
    const generation = Tools.connection.generation;
    const replay = BoardMessageReplay.isAuthoritativeReplayBatch(msg);
    const sequenced = BoardMessageReplay.isSequencedMutationBroadcast(msg);
    if (sequenced && msg.seq <= this.authoritativeSeq) return false;
    const fromSeq = replay ? msg.fromSeq : this.authoritativeSeq;
    const seq = replay || sequenced ? msg.seq : fromSeq;
    const children = replay
      ? msg._children
      : [BoardMessageReplay.unwrapSequencedMutationBroadcast(msg)];
    if (
      (replay || sequenced) &&
      (fromSeq !== this.authoritativeSeq ||
        seq < fromSeq ||
        children.length !== seq - fromSeq)
    ) {
      this.logBoardEvent(
        "warn",
        replay ? "replay.batch_gap" : "replay.gap",
        replay
          ? {
              authoritativeSeq: this.authoritativeSeq,
              fromSeq,
              toSeq: seq,
              childCount: children.length,
            }
          : { authoritativeSeq: this.authoritativeSeq, incomingSeq: seq },
      );
      this.beginAuthoritativeResync();
      Tools.connection.start();
      return false;
    }
    if (
      !replay &&
      BoardMessageReplay.shouldBufferLiveMessage(msg, this.awaitingSnapshot)
    ) {
      this.preSnapshotMessages.push(msg);
      return false;
    }
    for (const [index, message] of children.entries()) {
      const own = sequenced && message.socket === Tools.connection.socket?.id;
      if (own && message.clientMutationId) {
        Tools.optimistic.promoteMutation(message.clientMutationId);
        Tools.writes.resolveBufferedWrite(message.clientMutationId);
      }
      if (sequenced && !own)
        Tools.optimistic.pruneForAuthoritativeMessage(message);
      if (!own) {
        if (message.clientMutationId)
          Tools.writes.resolveBufferedWrite(message.clientMutationId);
        Tools.writes.pruneBufferedWritesForInvalidatingMessage(message);
        await Tools.messages.messageForTool(message);
      }
      if (generation !== Tools.connection.generation) return false;
      if (replay || sequenced) this.authoritativeSeq = fromSeq + index + 1;
    }
    if (replay) {
      this.hasAuthoritativeSnapshot = true;
      this.authoritativeSeq = seq;
      this.awaitingSnapshot = false;
      this.refreshBaselineBeforeConnect = false;
      Tools.writes.pumpBufferedWrites();
      this.incomingBroadcastQueue =
        BoardMessageReplay.filterBufferedMessagesAfterSeqReplay(
          this.preSnapshotMessages,
          this.authoritativeSeq,
        ).concat(this.incomingBroadcastQueue);
      this.preSnapshotMessages = [];
      Tools.status.syncWriteStatusIndicator();
    }
    return true;
  }

  async drainIncomingBroadcastQueue() {
    const generation = this.getTools().connection.generation;
    if (this.processingIncomingBroadcast === generation) return;
    this.processingIncomingBroadcast = generation;
    try {
      while (generation === this.getTools().connection.generation) {
        const msg = this.incomingBroadcastQueue.shift();
        if (!msg) return;
        const processed = await this.processIncomingBroadcast(msg);
        if (generation !== this.getTools().connection.generation) return;
        const Tools = this.getTools();
        if (processed && !BoardMessageReplay.isAuthoritativeReplayBatch(msg)) {
          const message =
            BoardMessageReplay.unwrapSequencedMutationBroadcast(msg);
          Tools.presence.updateConnectedUsersFromActivity(
            message.userId,
            message,
          );
        }
        Tools.status.syncWriteStatusIndicator();
      }
    } finally {
      if (this.processingIncomingBroadcast === generation)
        this.processingIncomingBroadcast = null;
      if (this.incomingBroadcastQueue.length > 0) {
        void this.drainIncomingBroadcastQueue();
      }
    }
  }

  /**
   * @param {IncomingBroadcast} msg
   * @returns {void}
   */
  enqueueIncomingBroadcast(msg) {
    this.incomingBroadcastQueue.push(msg);
    const Tools = this.getTools();
    if (this.processingIncomingBroadcast === Tools.connection.generation)
      return;
    // Incoming ink repaints the entire board SVG. During a local stroke on a
    // dense board, group those paints so they leave time for the local overlay.
    // Apply every message in order; replay, geometry and socket data are intact.
    if (
      Tools.dom.status === "attached" &&
      Tools.dom.drawingArea.childElementCount >= DENSE_BOARD_ITEMS &&
      Tools.interaction.isOwnCursorSuppressed()
    ) {
      if (!this.broadcastTimer) {
        this.broadcastTimer = window.setTimeout(() => {
          this.broadcastTimer = 0;
          void this.drainIncomingBroadcastQueue();
        }, DRAWING_BROADCAST_BATCH_MS);
      }
      return;
    }
    window.clearTimeout(this.broadcastTimer);
    this.broadcastTimer = 0;
    void this.drainIncomingBroadcastQueue();
  }
}
