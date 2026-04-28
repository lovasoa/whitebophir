import {
  buildBoardSvgBaselineUrl,
  parseServedBaselineSvgText,
} from "./board_svg_baseline.js";

/** @import { AppToolsState, AuthoritativeBaseline, IncomingBroadcast } from "../../types/app-runtime" */

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
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
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
}
