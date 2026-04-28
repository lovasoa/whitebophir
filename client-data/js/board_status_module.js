/** @import { AppToolsState, BoardStatusView } from "../../types/app-runtime" */

function getBoardStatusElements() {
  return {
    indicator: document.getElementById("boardStatusIndicator"),
    title: document.getElementById("boardStatusTitle"),
    notice: document.getElementById("boardStatusNotice"),
  };
}

export class StatusModule {
  /**
   * @param {() => AppToolsState} getTools
   * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logBoardEvent
   */
  constructor(getTools, logBoardEvent) {
    this.getTools = getTools;
    this.logBoardEvent = logBoardEvent;
    this.rateLimitNoticeTimer = null;
    this.boardStatusTimer = null;
    this.explicitBoardStatus = null;
  }

  clearRateLimitNoticeTimer() {
    if (this.rateLimitNoticeTimer) {
      clearTimeout(this.rateLimitNoticeTimer);
      this.rateLimitNoticeTimer = null;
    }
  }

  clearBoardStatusTimer() {
    if (this.boardStatusTimer) {
      clearTimeout(this.boardStatusTimer);
      this.boardStatusTimer = null;
    }
  }

  /**
   * @param {string} message
   * @param {number} retryAfterMs
   */
  showRateLimitNotice(message, retryAfterMs) {
    const Tools = this.getTools();
    this.clearRateLimitNoticeTimer();
    this.showBoardStatus({
      hidden: false,
      state: "paused",
      title: Tools.i18n.t("slow_down_briefly"),
      detail: message,
    });
    if (retryAfterMs > 0) {
      this.rateLimitNoticeTimer = window.setTimeout(
        function hideRateLimitNotice() {
          Tools.status.hideRateLimitNotice();
        },
        retryAfterMs,
      );
    }
  }

  hideRateLimitNotice() {
    this.clearRateLimitNoticeTimer();
    this.clearBoardStatus();
  }

  /** @param {string} reason */
  showUnknownMutationError(reason) {
    const Tools = this.getTools();
    if (reason.length > 0) {
      this.logBoardEvent("warn", "mutation_rejected_unknown", {
        reason,
      });
    }
    this.showBoardStatus({
      hidden: false,
      state: "paused",
      title: Tools.i18n.t("unknown_error_reload_page"),
      detail: "",
    });
  }

  /**
   * @param {BoardStatusView} view
   * @param {number} [durationMs]
   */
  showBoardStatus(view, durationMs) {
    const Tools = this.getTools();
    this.clearBoardStatusTimer();
    this.explicitBoardStatus = view;
    this.syncWriteStatusIndicator();
    if (durationMs && durationMs > 0) {
      this.boardStatusTimer = window.setTimeout(() => {
        Tools.status.clearBoardStatus();
      }, durationMs);
    }
  }

  clearBoardStatus() {
    this.clearBoardStatusTimer();
    this.explicitBoardStatus = null;
    this.syncWriteStatusIndicator();
  }

  /** @returns {BoardStatusView} */
  getBoardStatusView() {
    const Tools = this.getTools();
    if (this.explicitBoardStatus) {
      return this.explicitBoardStatus;
    }
    if (
      Tools.connection.state !== "connected" ||
      Tools.replay.awaitingSnapshot
    ) {
      return {
        hidden: false,
        state: "reconnecting",
        title: Tools.i18n.t("loading"),
        detail: "",
      };
    }
    if (Tools.writes.localRateLimitedUntil > Date.now()) {
      return {
        hidden: false,
        state: "paused",
        title: Tools.i18n.t("slow_down_briefly"),
        detail: "",
      };
    }
    if (Tools.writes.bufferedWrites.length > 0) {
      return {
        hidden: false,
        state: "buffering",
        title: Tools.i18n.t("loading"),
        detail: "",
      };
    }
    return {
      hidden: true,
      state: "hidden",
      title: "",
      detail: "",
    };
  }

  syncWriteStatusIndicator() {
    const Tools = this.getTools();
    if (
      Tools.writes.canBufferWrites() &&
      Tools.writes.writeReadyWaiters.length > 0
    ) {
      const waiters = Tools.writes.writeReadyWaiters.splice(0);
      waiters.forEach((resolve) => resolve());
    }
    const { indicator, title, notice } = getBoardStatusElements();
    if (!indicator || !title || !notice) return;

    const view = this.getBoardStatusView();
    indicator.classList.remove(
      "board-status-buffering",
      "board-status-paused",
      "board-status-reconnecting",
    );
    indicator.dataset.state = view.state;
    if (view.hidden) {
      indicator.hidden = true;
      return;
    }
    indicator.hidden = false;
    title.textContent = view.title;
    notice.textContent = view.detail;
    notice.classList.toggle("board-status-detail-hidden", !view.detail);
    indicator.classList.add(`board-status-${view.state}`);
  }
}
