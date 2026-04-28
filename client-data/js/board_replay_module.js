import * as BoardMessageReplay from "./board_message_replay.js";
import {
  buildBoardSvgBaselineUrl,
  parseServedBaselineSvgText,
} from "./board_svg_baseline.js";

/** @import { AppToolsState, AuthoritativeBaseline, AuthoritativeReplayBatch, BoardMessage, IncomingBroadcast } from "../../types/app-runtime" */

/** @param {AppToolsState} Tools */
function getAttachedBoardDom(Tools) {
  return Tools.dom.status === "attached" ? Tools.dom : null;
}

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
    this.processingIncomingBroadcast = false;
  }

  /** @param {AuthoritativeBaseline} baseline */
  applyAuthoritativeBaseline(baseline) {
    const Tools = this.getTools();
    const dom = getAttachedBoardDom(Tools);
    if (!dom) return;
    this.hasAuthoritativeSnapshot = true;
    this.authoritativeSeq = baseline.seq;
    Tools.optimistic.journal.reset();
    dom.svg.setAttribute("data-wbo-seq", String(baseline.seq));
    dom.svg.setAttribute(
      "data-wbo-readonly",
      baseline.readonly ? "true" : "false",
    );
    dom.drawingArea.innerHTML = baseline.drawingAreaMarkup;
    Tools.toolRegistry.normalizeServerRenderedElements();
  }

  async refreshAuthoritativeBaseline() {
    const response = await fetch(getAuthoritativeBaselineUrl(Date.now()), {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "image/svg+xml" },
    });
    if (!response.ok) {
      throw new Error(`Baseline fetch failed with HTTP ${response.status}`);
    }
    const baseline = parseServedBaselineSvgText(
      await response.text(),
      new DOMParser(),
    );
    this.applyAuthoritativeBaseline(baseline);
  }

  beginAuthoritativeResync() {
    const Tools = this.getTools();
    this.awaitingSnapshot = true;
    this.refreshBaselineBeforeConnect = true;
    Tools.optimistic.journal.reset();
    this.preSnapshotMessages = [];
    this.incomingBroadcastQueue = [];
    this.processingIncomingBroadcast = false;
    Tools.writes.discardBufferedWrites();
    Tools.turnstile.pendingWrites = [];
    Tools.turnstile.hideOverlay();
    Tools.presence.clearConnectedUsers();
    Tools.dom.clearBoardCursors();
    Object.values(Tools.toolRegistry.mounted || {}).forEach((tool) => {
      if (tool) tool.onSocketDisconnect();
    });
    Tools.toolRegistry.syncActiveToolInputPolicy();
    Tools.status.syncWriteStatusIndicator();
  }

  /**
   * @param {BoardMessage} message
   * @returns {Promise<void>}
   */
  async handleMessage(message) {
    const Tools = this.getTools();
    Tools.writes.pruneBufferedWritesForInvalidatingMessage(message);
    await Tools.messages.messageForTool(message);
  }

  /**
   * @param {IncomingBroadcast} msg
   * @param {boolean} processed
   * @returns {void}
   */
  finalizeIncomingBroadcast(msg, processed) {
    const Tools = this.getTools();
    if (processed && !BoardMessageReplay.isAuthoritativeReplayBatch(msg)) {
      const activityMessage =
        BoardMessageReplay.unwrapSequencedMutationBroadcast(msg);
      Tools.presence.updateConnectedUsersFromActivity(
        activityMessage.userId,
        activityMessage,
      );
    }
    Tools.status.syncWriteStatusIndicator();
  }

  /**
   * @param {number} replayedToSeq
   * @returns {void}
   */
  completeAuthoritativeReplay(replayedToSeq) {
    const Tools = this.getTools();
    this.hasAuthoritativeSnapshot = true;
    this.authoritativeSeq = replayedToSeq;
    this.awaitingSnapshot = false;
    this.refreshBaselineBeforeConnect = false;
    Tools.writes.flushBufferedWrites();
    this.incomingBroadcastQueue =
      BoardMessageReplay.filterBufferedMessagesAfterSeqReplay(
        this.preSnapshotMessages,
        this.authoritativeSeq,
      ).concat(this.incomingBroadcastQueue);
    this.preSnapshotMessages = [];
    Tools.status.syncWriteStatusIndicator();
  }

  /**
   * @param {AuthoritativeReplayBatch} batch
   * @returns {Promise<boolean>}
   */
  async processAuthoritativeReplayBatch({ fromSeq, seq, _children }) {
    const Tools = this.getTools();
    if (
      fromSeq !== this.authoritativeSeq ||
      seq < fromSeq ||
      _children.length !== seq - fromSeq
    ) {
      this.logBoardEvent("warn", "replay.batch_gap", {
        authoritativeSeq: this.authoritativeSeq,
        fromSeq,
        toSeq: seq,
        childCount: _children.length,
      });
      this.beginAuthoritativeResync();
      Tools.connection.start();
      return false;
    }

    for (const [index, child] of _children.entries()) {
      await this.handleMessage(child);
      this.authoritativeSeq = fromSeq + index + 1;
    }
    this.completeAuthoritativeReplay(seq);
    return true;
  }

  /**
   * @param {IncomingBroadcast} msg
   * @returns {Promise<boolean>}
   */
  async processIncomingBroadcast(msg) {
    const Tools = this.getTools();
    if (BoardMessageReplay.isAuthoritativeReplayBatch(msg)) {
      return this.processAuthoritativeReplayBatch(msg);
    }
    const isSequencedBroadcast =
      BoardMessageReplay.isSequencedMutationBroadcast(msg);
    if (isSequencedBroadcast) {
      const seqDisposition = BoardMessageReplay.classifySequencedMutationSeq(
        msg.seq,
        this.authoritativeSeq,
      );
      if (seqDisposition === "stale") {
        return false;
      }
      if (seqDisposition !== "next") {
        this.logBoardEvent("warn", "replay.gap", {
          authoritativeSeq: this.authoritativeSeq,
          incomingSeq: msg.seq,
        });
        this.beginAuthoritativeResync();
        Tools.connection.start();
        return false;
      }
    }
    if (
      BoardMessageReplay.shouldBufferLiveMessage(msg, this.awaitingSnapshot)
    ) {
      this.preSnapshotMessages.push(msg);
      return false;
    }
    const replayMessage =
      BoardMessageReplay.unwrapSequencedMutationBroadcast(msg);
    const isOwnSequencedBroadcast =
      isSequencedBroadcast &&
      replayMessage.socket === Tools.connection.socket?.id;
    if (isOwnSequencedBroadcast && replayMessage.clientMutationId) {
      Tools.optimistic.promoteMutation(replayMessage.clientMutationId);
    }
    if (isSequencedBroadcast && !isOwnSequencedBroadcast) {
      Tools.optimistic.pruneForAuthoritativeMessage(replayMessage);
    }
    if (!isOwnSequencedBroadcast) {
      await this.handleMessage(replayMessage);
    }
    if (isSequencedBroadcast) {
      this.authoritativeSeq = msg.seq;
    }
    return true;
  }

  async drainIncomingBroadcastQueue() {
    if (this.processingIncomingBroadcast) return;
    this.processingIncomingBroadcast = true;
    try {
      while (true) {
        const msg = this.incomingBroadcastQueue.shift();
        if (!msg) return;
        const processed = await this.processIncomingBroadcast(msg);
        this.finalizeIncomingBroadcast(msg, processed);
      }
    } finally {
      this.processingIncomingBroadcast = false;
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
    void this.drainIncomingBroadcastQueue();
  }
}
