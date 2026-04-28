/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

import { optimisticPrunePlanForAuthoritativeMessage } from "./authoritative_mutation_effects.js";
import * as BoardMessageReplay from "./board_message_replay.js";
import {
  drainPendingMessages,
  getRequiredElement,
  isBlockedToolName,
  normalizeBoardState,
  parseEmbeddedJson,
  resolveBoardName,
  updateRecentBoards,
} from "./board_page_state.js";
import { logFrontendEvent as logBoardEvent } from "./frontend_logging.js";
import {
  buildBoardSvgBaselineUrl,
  parseServedBaselineSvgText,
} from "./board_svg_baseline.js";
import {
  createViewportController,
  DEFAULT_BOARD_SCALE,
  VIEWPORT_HASH_SCALE_DECIMALS,
} from "./board_viewport.js";
import { getContentMessageBounds } from "./board_extent.js";
import {
  connection as BoardConnection,
  messages as BoardMessages,
} from "./board_transport.js";
import * as BoardTurnstile from "./board_turnstile.js";
import MessageCommon from "./message_common.js";
import {
  getTool,
  getMutationType,
  getToolId,
  MutationType,
} from "./message_tool_metadata.js";
import {
  hasMessageColor,
  hasMessageId,
  hasMessageNewId,
  hasMessagePoint,
  hasMessageSize,
} from "./message_shape.js";
import { createOptimisticJournal } from "./optimistic_journal.js";
import {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} from "./optimistic_mutation.js";
import RateLimitCommon from "./rate_limit_common.js";
import { SocketEvents } from "./socket_events.js";
import {
  getToolIconPath,
  getToolModuleImportPath,
  getToolRuntimeAssetPath,
  getToolStylesheetPath,
} from "../tools/tool-defaults.js";
import { TOOL_BY_ID } from "../tools/index.js";

/** @import { AppBoardState, AppToolsState, AttachedBoardDomModule, AuthoritativeBaseline, AuthoritativeReplayBatch, BoardConnectionState, BoardDomActions, BoardDomModule, BoardMessage, BoardStatusView, BufferedWrite, ColorPreset, CompiledToolListener, CompiledToolListeners, ConfiguredRateLimitDefinition, ConnectedUser, ConnectedUserMap, DetachedBoardDomModule, HandChildMessage, IncomingBroadcast, LiveBoardMessage, MountedAppTool, MountedAppToolsState, MutationRejectedPayload, OptimisticJournalEntry, OptimisticRollback, PendingMessages, PendingWrite, RateLimitKind, ReplayMessage, ServerConfig, SocketHeaders, ToolBootContext, ToolModule, ToolPointerListener, ToolPointerListeners, ToolRuntimeModules } from "../../types/app-runtime" */
/** @typedef {HTMLLIElement} ConnectedUserRow */
const Tools = /** @type {AppToolsState} */ ({});
window.WBOApp = Tools;

/**
 * @param {unknown} tool
 * @returns {string | undefined}
 */
function getRuntimeToolId(tool) {
  return getToolId(tool);
}

/**
 * @param {unknown} tool
 * @param {string} expectedToolId
 * @returns {boolean}
 */
function isRuntimeTool(tool, expectedToolId) {
  return getTool(tool)?.id === TOOL_BY_ID[expectedToolId]?.id;
}
// Keep a bounded safety margin between the client-side local budget and the
// server's fixed window to absorb emit/receive skew. The buffer must be large
// enough that a queued write does not reconnect-loop under load by landing just
// before the server window resets.
const RATE_LIMIT_FLUSH_SAFETY_MIN_MS = 250;
const RATE_LIMIT_FLUSH_SAFETY_MAX_MS = 1500;
const RATE_LIMIT_KINDS = /** @type {RateLimitKind[]} */ (
  RateLimitCommon.RATE_LIMIT_KINDS
);
const DEFAULT_INITIAL_SIZE = 40;
const DEFAULT_INITIAL_OPACITY = 1;

/**
 * @param {string} elementId
 * @returns {HTMLInputElement}
 */
function getRequiredInput(elementId) {
  return /** @type {HTMLInputElement} */ (getRequiredElement(elementId));
}

/**
 * @param {string} toolName
 * @returns {{button: HTMLElement, primaryIcon: HTMLImageElement, secondaryIcon: HTMLImageElement | null, label: HTMLElement}}
 */
function getRequiredToolButtonParts(toolName) {
  const button = getRequiredElement(`toolID-${toolName}`);
  const primaryIcon = /** @type {HTMLImageElement | null} */ (
    button.querySelector(".tool-icon")
  );
  const label = /** @type {HTMLElement | null} */ (
    button.querySelector(".tool-name")
  );
  if (!primaryIcon || !label) {
    throw new Error(`Missing required tool button structure for ${toolName}`);
  }
  return {
    button: button,
    primaryIcon: primaryIcon,
    secondaryIcon: /** @type {HTMLImageElement | null} */ (
      button.querySelector(".secondaryIcon")
    ),
    label: label,
  };
}

/**
 * @param {EventTarget | null} target
 * @returns {target is HTMLInputElement | HTMLTextAreaElement}
 */
function isTextEntryTarget(target) {
  return (
    (target instanceof HTMLInputElement && target.type === "text") ||
    target instanceof HTMLTextAreaElement
  );
}

function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

/**
 * @param {SVGSVGElement} svg
 * @returns {{authoritativeSeq: number, drawingArea: SVGGElement}}
 */
function readInlineBaseline(svg) {
  const drawingArea = svg.getElementById("drawingArea");
  if (!(drawingArea instanceof SVGGElement)) {
    throw new Error("Missing required element: #drawingArea");
  }
  return {
    authoritativeSeq: BoardMessageReplay.normalizeSeq(
      svg.getAttribute("data-wbo-seq"),
    ),
    drawingArea: drawingArea,
  };
}

/**
 * @template {DetachedBoardDomModule | AttachedBoardDomModule} T
 * @param {T} dom
 * @returns {T & BoardDomActions}
 */
function withBoardDomActions(dom) {
  return Object.assign(dom, {
    createSVGElement,
    positionElement,
    clearBoardCursors,
    resetBoardViewport,
  });
}

/**
 * @param {Document} document
 * @returns {Promise<void>}
 */
export async function attachBoardDom(document) {
  /**
   * @param {string} elementId
   * @returns {Promise<Element>}
   */
  const waitForElement = (elementId) => {
    const existing = document.getElementById(elementId);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const element = document.getElementById(elementId);
        if (!element) return;
        observer.disconnect();
        resolve(element);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  };
  const [boardElement, canvasElement] = await Promise.all([
    waitForElement("board"),
    waitForElement("canvas"),
  ]);
  if (!(boardElement instanceof HTMLElement)) {
    throw new Error("Missing required element: #board");
  }
  if (!(canvasElement instanceof SVGSVGElement)) {
    throw new Error("Missing required element: #canvas");
  }
  const baseline = readInlineBaseline(canvasElement);
  Tools.dom = withBoardDomActions({
    status: "attached",
    board: boardElement,
    svg: canvasElement,
    drawingArea: baseline.drawingArea,
  });
  Tools.replay.authoritativeSeq = baseline.authoritativeSeq;
  Tools.dom.svg.width.baseVal.value = Math.max(
    Tools.dom.svg.width.baseVal.value,
    document.body.clientWidth,
  );
  Tools.dom.svg.height.baseVal.value = Math.max(
    Tools.dom.svg.height.baseVal.value,
    document.body.clientHeight,
  );
  normalizeServerRenderedElements();
  Tools.toolRegistry.syncActiveToolInputPolicy();
}

function getAttachedBoardDom() {
  return Tools.dom.status === "attached" ? Tools.dom : null;
}

Tools.i18n = (function i18n() {
  const translations = /** @type {{[key: string]: string}} */ (
    parseEmbeddedJson("translations", {})
  );
  return {
    /** @param {string} s */
    t: function translate(s) {
      const key = s.toLowerCase().replace(/ /g, "_");
      return translations[key] || s;
    },
  };
})();

Tools.config = {
  serverConfig: /** @type {ServerConfig} */ ({}),
};

/**
 * @param {unknown} value
 * @returns {number}
 */
Tools.coordinates = {
  /** @param {unknown} value */
  toBoardCoordinate(value) {
    return MessageCommon.clampCoord(
      value,
      Tools.config.serverConfig.MAX_BOARD_SIZE,
    );
  },

  /** @param {unknown} value */
  pageCoordinateToBoard(value) {
    return Tools.viewportState.controller.pageCoordinateToBoard(value);
  },
};

/**
 * @param {string} assetPath
 * @returns {string}
 */
function normalizeBoardAssetPath(assetPath) {
  if (
    assetPath.startsWith("./") ||
    assetPath.startsWith("../") ||
    assetPath.startsWith("/") ||
    assetPath.startsWith("data:") ||
    assetPath.startsWith("http://") ||
    assetPath.startsWith("https://")
  ) {
    return assetPath;
  }
  return `../${assetPath}`;
}

/**
 * @param {string} assetPath
 * @returns {string}
 */
Tools.assets = {
  resolveAssetPath: normalizeBoardAssetPath,
  /**
   * @param {string} toolName
   * @param {string} assetFile
   */
  getToolAssetUrl(toolName, assetFile) {
    return Tools.assets.resolveAssetPath(
      getToolRuntimeAssetPath(toolName, assetFile),
    );
  },
};

Tools.toolRegistry = {
  current: null,
  mounted: /** @type {AppToolsState["toolRegistry"]["mounted"]} */ ({}),
  bootPromises:
    /** @type {AppToolsState["toolRegistry"]["bootPromises"]} */ ({}),
  bootedNames: new Set(),
  pendingMessages: /** @type {PendingMessages} */ ({}),
  restoreLocalCursor,
  mountTool,
  bootTool,
  activateTool,
  addToolListeners,
  removeToolListeners,
  syncActiveToolInputPolicy,
  shouldDisableTool,
  shouldDisplayTool,
  canUseTool,
  syncToolDisabledState,
  syncDrawToolAvailability,
  isBlocked,
  change,
};
Tools.turnstile = BoardTurnstile.createTurnstileModule(Tools, {
  logBoardEvent,
  queueProtectedWrite,
  flushPendingWrites,
});
Tools.writes = {
  bufferedWrites: [],
  bufferedWriteTimer: null,
  writeReadyWaiters: /** @type {Array<() => void>} */ ([]),
  serverRateLimitedUntil: 0,
  localRateLimitedUntil: 0,
  localRateLimitStates: {
    general: RateLimitCommon.createRateLimitState(Date.now()),
    constructive: RateLimitCommon.createRateLimitState(Date.now()),
    destructive: RateLimitCommon.createRateLimitState(Date.now()),
    text: RateLimitCommon.createRateLimitState(Date.now()),
  },
  clearBufferedWriteTimer,
  isWritePaused,
  canBufferWrites,
  whenBoardWritable,
  resetLocalRateLimitState,
  resetAllLocalRateLimitStates,
  canEmitBufferedWrite,
  consumeBufferedWriteBudget,
  getBufferedWriteWaitMs,
  getBufferedWriteFlushSafetyMs,
  scheduleBufferedWriteFlush,
  flushBufferedWrites,
  enqueueBufferedWrite,
  sendBufferedWrite,
  discardBufferedWrites,
  drawAndSend,
  send,
};
Tools.status = {
  rateLimitNoticeTimer: null,
  boardStatusTimer: null,
  explicitBoardStatus: null,
  clearRateLimitNoticeTimer,
  clearBoardStatusTimer,
  showRateLimitNotice,
  hideRateLimitNotice,
  showUnknownMutationError,
  showBoardStatus,
  clearBoardStatus,
  getBoardStatusView,
  syncWriteStatusIndicator,
};

Tools.replay = {
  awaitingSnapshot: true,
  hasAuthoritativeSnapshot: false,
  refreshBaselineBeforeConnect: false,
  authoritativeSeq: 0,
  preSnapshotMessages: [],
  incomingBroadcastQueue: [],
  processingIncomingBroadcast: false,
  applyAuthoritativeBaseline,
  refreshAuthoritativeBaseline,
  beginAuthoritativeResync,
};
Tools.optimistic = {
  journal: createOptimisticJournal(),
  captureRollback: captureOptimisticRollback,
  collectDependencyMutationIds: collectOptimisticDependencyMutationIds,
  trackMutation: trackOptimisticMutation,
  restoreRollback: restoreOptimisticRollback,
  applyRejectedEntries: applyRejectedOptimisticEntries,
  promoteMutation: promoteOptimisticMutation,
  rejectMutation: rejectOptimisticMutation,
  pruneForAuthoritativeMessage: pruneOptimisticMutationsForAuthoritativeMessage,
};
Tools.connection = {
  socket: null,
  state: /** @type {BoardConnectionState} */ ("idle"),
  hasConnectedOnce: false,
  socketIOExtraHeaders: null,
};
function initializeShellControls() {
  const colorChooser = getRequiredInput("chooseColor");
  const sizeChooser = getRequiredInput("chooseSize");
  const opacityChooser = getRequiredInput("chooseOpacity");
  const opacityIndicator = getRequiredElement("opacityIndicator");
  const opacityIndicatorFill =
    document.getElementById("opacityIndicatorFill") || opacityIndicator;

  Tools.preferences.colorChooser = colorChooser;
  colorChooser.value = Tools.preferences.currentColor;
  colorChooser.onchange = colorChooser.oninput = () => {
    Tools.preferences.setColor(colorChooser.value);
  };

  sizeChooser.value = String(Tools.preferences.currentSize);
  sizeChooser.onchange = sizeChooser.oninput = () => {
    Tools.preferences.setSize(sizeChooser.value);
  };

  const updateOpacity = () => {
    Tools.preferences.currentOpacity = MessageCommon.clampOpacity(
      opacityChooser.value,
    );
    opacityChooser.value = String(Tools.preferences.currentOpacity);
    opacityIndicatorFill.setAttribute(
      "opacity",
      String(Tools.preferences.currentOpacity),
    );
  };
  Tools.preferences.colorChangeHandlers.push(
    /** @param {string} color */ (color) => {
      opacityIndicatorFill.setAttribute("fill", color);
    },
  );
  opacityChooser.value = String(Tools.preferences.currentOpacity);
  updateOpacity();
  opacityChooser.onchange = opacityChooser.oninput = updateOpacity;

  if (!Tools.preferences.colorButtonsInitialized) {
    Tools.preferences.colorButtonsInitialized = true;
    Tools.preferences.colorPresets.forEach(addColorButton);
  }
  Tools.preferences.setColor(Tools.preferences.currentColor);
  Tools.preferences.setSize(Tools.preferences.currentSize);
}

function getBoardStatusElements() {
  return {
    indicator: document.getElementById("boardStatusIndicator"),
    title: document.getElementById("boardStatusTitle"),
    notice: document.getElementById("boardStatusNotice"),
  };
}

/**
 * @param {number | undefined} [cacheBust]
 * @returns {string}
 */
function getAuthoritativeBaselineUrl(cacheBust) {
  const url = new URL(
    buildBoardSvgBaselineUrl(window.location.pathname, window.location.search),
    window.location.href,
  );
  if (cacheBust !== undefined) {
    url.searchParams.set("baselineRefresh", String(cacheBust));
  }
  return `${url.pathname}${url.search}`;
}

Tools.rateLimits = {
  /** @param {RateLimitKind} kind */
  getRateLimitDefinition(kind) {
    const configured = Tools.config.serverConfig.RATE_LIMITS || {};
    if (configured && configured[kind]) return configured[kind];

    return {
      limit: 0,
      anonymousLimit: 0,
      periodMs: 0,
    };
  },

  /** @param {RateLimitKind} kind */
  getEffectiveRateLimit(kind) {
    return RateLimitCommon.getEffectiveRateLimitDefinition(
      Tools.rateLimits.getRateLimitDefinition(kind),
      Tools.identity.boardName,
    );
  },

  /** @param {LiveBoardMessage} message */
  getBufferedWriteCosts(message) {
    return RATE_LIMIT_KINDS.reduce(
      (costs, kind) => {
        costs[kind] = RateLimitCommon.getRateLimitCost(kind, message);
        return costs;
      },
      /** @type {import("../../types/app-runtime").RateLimitCosts} */ ({}),
    );
  },
};

function clearBufferedWriteTimer() {
  if (Tools.writes.bufferedWriteTimer) {
    clearTimeout(Tools.writes.bufferedWriteTimer);
    Tools.writes.bufferedWriteTimer = null;
  }
}

function clearRateLimitNoticeTimer() {
  if (Tools.status.rateLimitNoticeTimer) {
    clearTimeout(Tools.status.rateLimitNoticeTimer);
    Tools.status.rateLimitNoticeTimer = null;
  }
}

function clearBoardStatusTimer() {
  if (Tools.status.boardStatusTimer) {
    clearTimeout(Tools.status.boardStatusTimer);
    Tools.status.boardStatusTimer = null;
  }
}

/** @param {number} [delayMs] */
function scheduleSocketReconnect(delayMs = 250) {
  window.setTimeout(() => Tools.startConnection(), Math.max(0, delayMs));
}

/**
 * @param {number} [now]
 * @returns {boolean}
 */
function isWritePaused(now) {
  return Tools.writes.serverRateLimitedUntil > (now || Date.now());
}

function canBufferWrites() {
  return !!(
    Tools.connection.socket &&
    Tools.connection.socket.connected &&
    !Tools.replay.awaitingSnapshot &&
    !Tools.writes.isWritePaused()
  );
}

function whenBoardWritable() {
  if (Tools.writes.canBufferWrites()) return Promise.resolve();
  return new Promise(
    /** @param {(value?: void | PromiseLike<void>) => void} resolve */ (
      resolve,
    ) => {
      Tools.writes.writeReadyWaiters.push(() => resolve());
    },
  );
}

/**
 * @param {string} message
 * @param {number} retryAfterMs
 * @returns {void}
 */
function showRateLimitNotice(message, retryAfterMs) {
  Tools.status.clearRateLimitNoticeTimer();
  Tools.status.showBoardStatus({
    hidden: false,
    state: "paused",
    title: Tools.i18n.t("slow_down_briefly"),
    detail: message,
  });
  if (retryAfterMs > 0) {
    Tools.status.rateLimitNoticeTimer = window.setTimeout(
      function hideRateLimitNotice() {
        Tools.status.hideRateLimitNotice();
      },
      retryAfterMs,
    );
  }
}

function hideRateLimitNotice() {
  Tools.status.clearRateLimitNoticeTimer();
  Tools.status.clearBoardStatus();
}

/**
 * @param {string | undefined} reason
 * @returns {void}
 */
function showUnknownMutationError(reason) {
  if (typeof reason === "string" && reason.length > 0) {
    logBoardEvent("warn", "mutation_rejected_unknown", {
      reason,
    });
  }
  Tools.status.showBoardStatus({
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
function showBoardStatus(view, durationMs) {
  Tools.status.clearBoardStatusTimer();
  Tools.status.explicitBoardStatus = view;
  Tools.status.syncWriteStatusIndicator();
  if (durationMs && durationMs > 0) {
    Tools.status.boardStatusTimer = window.setTimeout(() => {
      Tools.status.clearBoardStatus();
    }, durationMs);
  }
}

function clearBoardStatus() {
  Tools.status.clearBoardStatusTimer();
  Tools.status.explicitBoardStatus = null;
  Tools.status.syncWriteStatusIndicator();
}

/** @returns {BoardStatusView} */
function getBoardStatusView() {
  if (Tools.status.explicitBoardStatus) {
    return Tools.status.explicitBoardStatus;
  }
  if (Tools.connection.state !== "connected" || Tools.replay.awaitingSnapshot) {
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

function syncWriteStatusIndicator() {
  if (
    Tools.writes.canBufferWrites() &&
    Tools.writes.writeReadyWaiters.length > 0
  ) {
    const waiters = Tools.writes.writeReadyWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }
  const { indicator, title, notice } = getBoardStatusElements();
  if (!indicator || !title || !notice) return;

  const view = Tools.status.getBoardStatusView();
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

function clearBoardCursors() {
  const dom = getAttachedBoardDom();
  if (!dom) return;
  const cursors = dom.svg.getElementById("cursors");
  if (cursors) cursors.innerHTML = "";
}

function resetBoardViewport() {
  const dom = getAttachedBoardDom();
  if (dom) dom.drawingArea.innerHTML = "";
  Tools.dom.clearBoardCursors();
}

function restoreLocalCursor() {
  const cursorTool = Tools.toolRegistry.mounted.cursor;
  if (!cursorTool) return;
  const message =
    "message" in cursorTool && cursorTool.message
      ? /** @type {BoardMessage} */ (cursorTool.message)
      : null;
  if (!message) return;
  cursorTool.draw(message, true);
}

/**
 * @param {LiveBoardMessage} message
 * @returns {OptimisticRollback}
 */
function captureOptimisticRollback(message) {
  const dom = getAttachedBoardDom();
  if (getMutationType(message) === MutationType.CLEAR) {
    return {
      kind: "drawing-area",
      markup: dom?.drawingArea.innerHTML || "",
    };
  }
  return {
    kind: "items",
    snapshots: collectOptimisticAffectedIds(message).map((itemId) => {
      if (!dom) {
        return {
          id: itemId,
          outerHTML: null,
          nextSiblingId: null,
        };
      }
      const current = dom.svg.getElementById(itemId);
      return {
        id: itemId,
        outerHTML: current ? current.outerHTML : null,
        nextSiblingId:
          current && current.nextElementSibling
            ? current.nextElementSibling.id || null
            : null,
      };
    }),
  };
}

/**
 * @param {LiveBoardMessage} message
 * @returns {string[]}
 */
function collectOptimisticDependencyMutationIds(message) {
  return Tools.optimistic.journal.dependencyMutationIdsForItemIds(
    collectOptimisticDependencyIds(message),
  );
}

/**
 * @param {LiveBoardMessage} message
 * @param {OptimisticRollback} rollback
 * @returns {void}
 */
function trackOptimisticMutation(message, rollback) {
  if (typeof message.clientMutationId !== "string" || !message.clientMutationId)
    return;
  Tools.optimistic.journal.append({
    clientMutationId: message.clientMutationId,
    affectedIds: collectOptimisticAffectedIds(message),
    dependsOn: Tools.optimistic.collectDependencyMutationIds(message),
    dependencyItemIds: collectOptimisticDependencyIds(message),
    rollback,
    message,
  });
}

/**
 * @param {OptimisticJournalEntry[]} rejected
 * @returns {void}
 */
function applyRejectedOptimisticEntries(rejected) {
  if (!Array.isArray(rejected) || rejected.length === 0) return;
  rejected
    .slice()
    .reverse()
    .forEach((entry) => {
      Tools.optimistic.restoreRollback(entry.rollback);
    });
  Tools.toolRegistry.restoreLocalCursor();
}

/**
 * @param {OptimisticJournalEntry[]} rejected
 * @param {string | undefined} reason
 * @returns {void}
 */
function notifyRejectedTools(rejected, reason) {
  if (!Array.isArray(rejected) || rejected.length === 0) return;
  rejected.forEach((entry) => {
    const toolName = getRuntimeToolId(entry.message.tool);
    const tool = toolName ? Tools.toolRegistry.mounted[toolName] : undefined;
    tool?.onMutationRejected?.(entry.message, reason);
  });
}

/**
 * @param {OptimisticRollback} rollback
 * @returns {void}
 */
function restoreOptimisticRollback(rollback) {
  const dom = getAttachedBoardDom();
  if (!dom) return;
  if (rollback.kind === "drawing-area") {
    dom.drawingArea.innerHTML = rollback.markup;
    return;
  }
  rollback.snapshots.forEach((snapshot) => {
    const current = dom.svg.getElementById(snapshot.id);
    if (snapshot.outerHTML === null) {
      current?.remove();
      return;
    }
    if (current) {
      current.outerHTML = snapshot.outerHTML;
      return;
    }
    const nextSibling = snapshot.nextSiblingId
      ? dom.svg.getElementById(snapshot.nextSiblingId)
      : null;
    if (nextSibling?.parentElement === dom.drawingArea) {
      nextSibling.insertAdjacentHTML("beforebegin", snapshot.outerHTML);
    } else {
      dom.drawingArea.insertAdjacentHTML("beforeend", snapshot.outerHTML);
    }
  });
}

/**
 * @param {string} clientMutationId
 * @returns {void}
 */
function promoteOptimisticMutation(clientMutationId) {
  if (Tools.optimistic.journal.promote(clientMutationId).length === 0) return;
}

/**
 * @param {string} clientMutationId
 * @param {string | undefined} reason
 * @returns {void}
 */
function rejectOptimisticMutation(clientMutationId, reason) {
  const rejected = Tools.optimistic.journal.reject(clientMutationId);
  Tools.optimistic.applyRejectedEntries(rejected);
  notifyRejectedTools(rejected, reason);
}

/**
 * @param {BoardMessage} message
 * @returns {void}
 */
function pruneOptimisticMutationsForAuthoritativeMessage(message) {
  const prunePlan = optimisticPrunePlanForAuthoritativeMessage(message);
  if (prunePlan.reset) {
    Tools.optimistic.applyRejectedEntries(Tools.optimistic.journal.reset());
    return;
  }
  if (prunePlan.invalidatedIds.length === 0) {
    return;
  }
  Tools.optimistic.applyRejectedEntries(
    Tools.optimistic.journal.rejectByInvalidatedIds(prunePlan.invalidatedIds),
  );
}

/**
 * @param {AuthoritativeBaseline} baseline
 */
function applyAuthoritativeBaseline(baseline) {
  const dom = getAttachedBoardDom();
  if (!dom) return;
  Tools.replay.hasAuthoritativeSnapshot = true;
  Tools.replay.authoritativeSeq = baseline.seq;
  Tools.optimistic.journal.reset();
  dom.svg.setAttribute("data-wbo-seq", String(baseline.seq));
  dom.svg.setAttribute(
    "data-wbo-readonly",
    baseline.readonly ? "true" : "false",
  );
  dom.drawingArea.innerHTML = baseline.drawingAreaMarkup;
  normalizeServerRenderedElements();
}

/**
 * @param {MountedAppTool} tool
 * @returns {void}
 */
function normalizeServerRenderedElementsForTool(tool) {
  const dom = getAttachedBoardDom();
  if (!dom) return;
  const selector = tool.serverRenderedElementSelector;
  const normalizeElement = tool.normalizeServerRenderedElement;
  if (!selector || typeof normalizeElement !== "function") return;

  dom.drawingArea.querySelectorAll(selector).forEach((element) => {
    if (element instanceof SVGElement) {
      normalizeElement.call(tool, element);
    }
  });
}

function normalizeServerRenderedElements() {
  Object.values(Tools.toolRegistry.mounted).forEach((tool) => {
    normalizeServerRenderedElementsForTool(tool);
  });
}

async function refreshAuthoritativeBaseline() {
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
  Tools.replay.applyAuthoritativeBaseline(baseline);
}

/**
 * @param {RateLimitKind} kind
 * @param {number} [now]
 * @returns {void}
 */
function resetLocalRateLimitState(kind, now) {
  Tools.writes.localRateLimitStates[kind] =
    RateLimitCommon.createRateLimitState(now || Date.now());
}

/** @param {number} [now] */
function resetAllLocalRateLimitStates(now) {
  Tools.writes.resetLocalRateLimitState("general", now);
  Tools.writes.resetLocalRateLimitState("constructive", now);
  Tools.writes.resetLocalRateLimitState("destructive", now);
  Tools.writes.resetLocalRateLimitState("text", now);
}

/**
 * @param {BufferedWrite} bufferedWrite
 * @param {number} now
 * @returns {boolean}
 */
function canEmitBufferedWrite(bufferedWrite, now) {
  return RATE_LIMIT_KINDS.every((kind) => {
    const cost = bufferedWrite.costs[kind];
    if (!(cost > 0)) return true;
    const definition = Tools.rateLimits.getEffectiveRateLimit(kind);
    if (!(definition.periodMs > 0) || !(definition.limit >= 0)) return true;
    return RateLimitCommon.canConsumeFixedWindowRateLimit(
      Tools.writes.localRateLimitStates[kind],
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
 * @returns {void}
 */
function consumeBufferedWriteBudget(bufferedWrite, now) {
  RATE_LIMIT_KINDS.forEach((kind) => {
    const cost = bufferedWrite.costs[kind];
    if (!(cost > 0)) return;
    const definition = Tools.rateLimits.getEffectiveRateLimit(kind);
    if (!(definition.periodMs > 0)) return;
    Tools.writes.localRateLimitStates[kind] =
      RateLimitCommon.consumeFixedWindowRateLimit(
        Tools.writes.localRateLimitStates[kind],
        cost,
        definition.periodMs,
        now,
      );
  });
}

/**
 * @param {BufferedWrite} bufferedWrite
 * @param {number} now
 * @returns {number}
 */
function getBufferedWriteWaitMs(bufferedWrite, now) {
  return RATE_LIMIT_KINDS.reduce((waitMs, kind) => {
    const cost = bufferedWrite.costs[kind];
    if (!(cost > 0)) return waitMs;
    const definition = Tools.rateLimits.getEffectiveRateLimit(kind);
    if (!(definition.periodMs > 0)) return waitMs;
    if (
      RateLimitCommon.canConsumeFixedWindowRateLimit(
        Tools.writes.localRateLimitStates[kind],
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
        Tools.writes.localRateLimitStates[kind],
        definition.periodMs,
        now,
      ),
    );
  }, 0);
}

/**
 * @param {number} waitMs
 * @returns {number}
 */
function getBufferedWriteFlushSafetyMs(waitMs) {
  return Math.min(
    RATE_LIMIT_FLUSH_SAFETY_MAX_MS,
    Math.max(RATE_LIMIT_FLUSH_SAFETY_MIN_MS, Math.ceil(Math.max(0, waitMs))),
  );
}

/** @returns {void} */
function scheduleBufferedWriteFlush() {
  Tools.writes.clearBufferedWriteTimer();
  if (!Tools.writes.bufferedWrites.length || !Tools.writes.canBufferWrites()) {
    Tools.status.syncWriteStatusIndicator();
    return;
  }
  const nextWrite = Tools.writes.bufferedWrites[0];
  if (!nextWrite) return;
  const now = Date.now();
  const waitMs = Tools.writes.getBufferedWriteWaitMs(nextWrite, now);
  Tools.writes.localRateLimitedUntil = waitMs > 0 ? now + waitMs : 0;
  Tools.writes.bufferedWriteTimer = window.setTimeout(
    function flushBufferedWrites() {
      Tools.writes.flushBufferedWrites();
    },
    Math.max(0, waitMs + Tools.writes.getBufferedWriteFlushSafetyMs(waitMs)),
  );
  Tools.status.syncWriteStatusIndicator();
}

/** @returns {void} */
function flushBufferedWrites() {
  Tools.writes.clearBufferedWriteTimer();
  Tools.writes.localRateLimitedUntil = 0;
  if (!Tools.writes.canBufferWrites()) {
    Tools.status.syncWriteStatusIndicator();
    return;
  }
  while (Tools.writes.bufferedWrites.length > 0) {
    const bufferedWrite = Tools.writes.bufferedWrites[0];
    if (!bufferedWrite) break;
    const now = Date.now();
    if (!Tools.writes.canEmitBufferedWrite(bufferedWrite, now)) {
      Tools.writes.scheduleBufferedWriteFlush();
      return;
    }
    Tools.writes.bufferedWrites.shift();
    Tools.writes.consumeBufferedWriteBudget(bufferedWrite, now);
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
 * @param {LiveBoardMessage} message
 * @returns {void}
 */
function enqueueBufferedWrite(message) {
  Tools.writes.bufferedWrites.push({
    message: message,
    costs: Tools.rateLimits.getBufferedWriteCosts(message),
  });
  Tools.writes.scheduleBufferedWriteFlush();
}

/**
 * Takes ownership of message. Callers must not mutate it after sending.
 * @param {LiveBoardMessage} message
 * @returns {boolean}
 */
function sendBufferedWrite(message) {
  /** @type {BufferedWrite} */
  const bufferedWrite = {
    message: message,
    costs: Tools.rateLimits.getBufferedWriteCosts(message),
  };
  if (!Tools.writes.canBufferWrites()) {
    return false;
  }
  const now = Date.now();
  if (
    Tools.writes.bufferedWrites.length === 0 &&
    Tools.writes.canEmitBufferedWrite(bufferedWrite, now)
  ) {
    Tools.writes.consumeBufferedWriteBudget(bufferedWrite, now);
    Tools.presence.updateCurrentConnectedUserFromActivity(message);
    if (Tools.connection.socket) {
      Tools.connection.socket.emit(SocketEvents.BROADCAST, message);
    }
    Tools.status.syncWriteStatusIndicator();
    return true;
  }
  Tools.writes.bufferedWrites.push(bufferedWrite);
  Tools.writes.scheduleBufferedWriteFlush();
  return true;
}

function discardBufferedWrites() {
  Tools.writes.bufferedWrites = [];
  Tools.writes.localRateLimitedUntil = 0;
  Tools.writes.clearBufferedWriteTimer();
  Tools.status.syncWriteStatusIndicator();
}

/**
 * @param {BoardMessage} message
 * @param {Set<string>} invalidatedIds
 * @returns {boolean}
 */
function messageReferencesInvalidatedId(message, invalidatedIds) {
  return collectOptimisticAffectedIds(message)
    .concat(collectOptimisticDependencyIds(message))
    .some((itemId) => invalidatedIds.has(itemId));
}

/**
 * @param {BoardMessage} message
 * @returns {void}
 */
function pruneBufferedWritesForInvalidatingMessage(message) {
  if (Tools.writes.bufferedWrites.length === 0) return;
  const prunePlan = optimisticPrunePlanForAuthoritativeMessage(message);
  if (prunePlan.reset) {
    Tools.writes.discardBufferedWrites();
    return;
  }
  if (prunePlan.invalidatedIds.length === 0) return;
  const invalidatedIds = new Set(prunePlan.invalidatedIds);
  const nextBufferedWrites = Tools.writes.bufferedWrites.filter(
    (bufferedWrite) =>
      !messageReferencesInvalidatedId(bufferedWrite.message, invalidatedIds),
  );
  if (nextBufferedWrites.length === Tools.writes.bufferedWrites.length) return;
  Tools.writes.bufferedWrites = nextBufferedWrites;
  Tools.writes.scheduleBufferedWriteFlush();
}

function beginAuthoritativeResync() {
  Tools.replay.awaitingSnapshot = true;
  Tools.replay.refreshBaselineBeforeConnect = true;
  Tools.optimistic.journal.reset();
  Tools.replay.preSnapshotMessages = [];
  Tools.replay.incomingBroadcastQueue = [];
  Tools.replay.processingIncomingBroadcast = false;
  Tools.writes.discardBufferedWrites();
  Tools.turnstile.pendingWrites = [];
  Tools.turnstile.hideOverlay();
  Object.values(getConnectedUsers()).forEach((user) => {
    if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  });
  Tools.presence.users = /** @type {ConnectedUserMap} */ ({});
  Tools.presence.renderConnectedUsers();
  Tools.dom.clearBoardCursors();
  Object.values(Tools.toolRegistry.mounted || {}).forEach((tool) => {
    if (tool) tool.onSocketDisconnect();
  });
  Tools.toolRegistry.syncActiveToolInputPolicy();
  Tools.status.syncWriteStatusIndicator();
}

/**
 * Takes ownership of data. Callers must not mutate it after queueing.
 * @param {LiveBoardMessage} data
 */
function queueProtectedWrite(data) {
  const hadPendingWrites = Tools.turnstile.pendingWrites.length > 0;
  Tools.turnstile.pendingWrites.push({ data });
  if (hadPendingWrites) return;
  const toolName = getRuntimeToolId(data.tool) || "unknown";
  logBoardEvent("log", "turnstile.write_queued", {
    toolName,
    clientMutationId:
      typeof data.clientMutationId === "string" ? data.clientMutationId : null,
  });
  Tools.turnstile.showWidget();
}

function flushPendingWrites() {
  const pendingWrites = Tools.turnstile.pendingWrites;
  Tools.turnstile.pendingWrites = [];
  logBoardEvent("log", "turnstile.write_flush", {
    count: pendingWrites.length,
  });
  Tools.status.clearBoardStatus();
  pendingWrites.forEach(function replayPendingWrite(write) {
    const pendingWrite = /** @type {PendingWrite} */ (write);
    Tools.writes.send(pendingWrite.data);
  });
}

/**
 * @param {IncomingBroadcast} msg
 * @param {boolean} processed
 * @returns {void}
 */
function finalizeIncomingBroadcast(msg, processed) {
  const activityMessage =
    BoardMessageReplay.unwrapSequencedMutationBroadcast(msg);
  if (processed && "tool" in activityMessage) {
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
function completeAuthoritativeReplay(replayedToSeq) {
  Tools.replay.hasAuthoritativeSnapshot = true;
  Tools.replay.authoritativeSeq =
    BoardMessageReplay.normalizeSeq(replayedToSeq);
  Tools.replay.awaitingSnapshot = false;
  Tools.replay.refreshBaselineBeforeConnect = false;
  Tools.writes.flushBufferedWrites();
  Tools.replay.incomingBroadcastQueue =
    BoardMessageReplay.filterBufferedMessagesAfterSeqReplay(
      Tools.replay.preSnapshotMessages,
      Tools.replay.authoritativeSeq,
    ).concat(Tools.replay.incomingBroadcastQueue);
  Tools.replay.preSnapshotMessages = [];
  Tools.toolRegistry.restoreLocalCursor();
  Tools.status.syncWriteStatusIndicator();
}

/**
 * @param {AuthoritativeReplayBatch} batch
 * @returns {Promise<boolean>}
 */
async function processAuthoritativeReplayBatch(batch) {
  const fromSeq = BoardMessageReplay.normalizeSeq(batch.fromSeq);
  const toSeq = BoardMessageReplay.normalizeSeq(batch.seq);
  if (
    fromSeq !== Tools.replay.authoritativeSeq ||
    toSeq < fromSeq ||
    batch._children.length !== toSeq - fromSeq
  ) {
    logBoardEvent("warn", "replay.batch_gap", {
      authoritativeSeq: Tools.replay.authoritativeSeq,
      fromSeq,
      toSeq,
      childCount: batch._children.length,
    });
    Tools.replay.beginAuthoritativeResync();
    Tools.startConnection();
    return false;
  }

  for (let index = 0; index < batch._children.length; index++) {
    const child = batch._children[index];
    if (child) await handleMessage(child);
    Tools.replay.authoritativeSeq = fromSeq + index + 1;
  }
  completeAuthoritativeReplay(toSeq);
  return true;
}

/**
 * @param {IncomingBroadcast} msg
 * @returns {Promise<boolean>}
 */
async function processIncomingBroadcast(msg) {
  if (
    "type" in msg &&
    "fromSeq" in msg &&
    "_children" in msg &&
    msg?.type === MutationType.BATCH &&
    typeof msg.fromSeq === "number" &&
    Array.isArray(msg._children)
  ) {
    return processAuthoritativeReplayBatch(
      /** @type {AuthoritativeReplayBatch} */ (msg),
    );
  }
  const isSequencedBroadcast =
    BoardMessageReplay.isSequencedMutationBroadcast(msg);
  if (isSequencedBroadcast) {
    const seqDisposition = BoardMessageReplay.classifySequencedMutationSeq(
      msg.seq,
      Tools.replay.authoritativeSeq,
    );
    if (seqDisposition === "stale") {
      return false;
    }
    if (seqDisposition !== "next") {
      logBoardEvent("warn", "replay.gap", {
        authoritativeSeq: Tools.replay.authoritativeSeq,
        incomingSeq: msg.seq,
      });
      Tools.replay.beginAuthoritativeResync();
      Tools.startConnection();
      return false;
    }
  }
  if (
    BoardMessageReplay.shouldBufferLiveMessage(
      msg,
      Tools.replay.awaitingSnapshot,
    )
  ) {
    Tools.replay.preSnapshotMessages.push(msg);
    return false;
  }
  const replayMessage =
    BoardMessageReplay.unwrapSequencedMutationBroadcast(msg);
  if (!("tool" in replayMessage)) {
    logBoardEvent("error", "broadcast.invalid_replay_payload", {
      message: msg,
    });
    return false;
  }
  const isOwnSequencedBroadcast =
    isSequencedBroadcast &&
    replayMessage.socket === Tools.connection.socket?.id;
  if (
    isOwnSequencedBroadcast &&
    typeof replayMessage.clientMutationId === "string" &&
    replayMessage.clientMutationId
  ) {
    Tools.optimistic.promoteMutation(replayMessage.clientMutationId);
  }
  if (isSequencedBroadcast && !isOwnSequencedBroadcast) {
    Tools.optimistic.pruneForAuthoritativeMessage(replayMessage);
  }
  if (!isOwnSequencedBroadcast) {
    await handleMessage(replayMessage);
  }
  if (isSequencedBroadcast) {
    Tools.replay.authoritativeSeq = BoardMessageReplay.normalizeSeq(msg.seq);
  }
  return true;
}

async function drainIncomingBroadcastQueue() {
  if (Tools.replay.processingIncomingBroadcast) return;
  Tools.replay.processingIncomingBroadcast = true;
  try {
    while (true) {
      const msg = Tools.replay.incomingBroadcastQueue.shift();
      if (!msg) return;
      const processed = await processIncomingBroadcast(msg);
      finalizeIncomingBroadcast(msg, processed);
    }
  } finally {
    Tools.replay.processingIncomingBroadcast = false;
    if (Tools.replay.incomingBroadcastQueue.length > 0) {
      void drainIncomingBroadcastQueue();
    }
  }
}

/**
 * @param {IncomingBroadcast} msg
 * @returns {void}
 */
function enqueueIncomingBroadcast(msg) {
  Tools.replay.incomingBroadcastQueue.push(msg);
  void drainIncomingBroadcastQueue();
}

Tools.viewportState = {
  scale: DEFAULT_BOARD_SCALE,
  controller: createViewportController(Tools),
  drawToolsAllowed: null,
};
Tools.access = {
  boardState: {
    readonly: false,
    canWrite: true,
  },
  readOnly: false,
  canWrite: true,
};

/** @param {string} toolName */
function shouldDisableTool(toolName) {
  return (
    MessageCommon.isDrawTool(toolName) &&
    !MessageCommon.isDrawToolAllowedAtScale(Tools.viewportState.scale)
  );
}

/** @param {string} toolName */
function canUseTool(toolName) {
  return (
    Tools.toolRegistry.shouldDisplayTool(toolName) &&
    !Tools.toolRegistry.shouldDisableTool(toolName)
  );
}

/** @param {string} toolName */
function syncToolDisabledState(toolName) {
  const toolElem = document.getElementById(`toolID-${toolName}`);
  if (!toolElem) return;
  const disabled = Tools.toolRegistry.shouldDisableTool(toolName);
  toolElem.classList.toggle("disabledTool", disabled);
  toolElem.setAttribute("aria-disabled", disabled ? "true" : "false");
}

/** @param {boolean} force */
function syncDrawToolAvailability(force) {
  const drawToolsAllowed = MessageCommon.isDrawToolAllowedAtScale(
    Tools.viewportState.scale,
  );
  if (!force && drawToolsAllowed === Tools.viewportState.drawToolsAllowed) {
    return;
  }
  Tools.viewportState.drawToolsAllowed = drawToolsAllowed;

  Object.keys(Tools.toolRegistry.mounted || {}).forEach((toolName) => {
    Tools.toolRegistry.syncToolDisabledState(toolName);
  });

  if (
    !drawToolsAllowed &&
    Tools.toolRegistry.current &&
    MessageCommon.isDrawTool(Tools.toolRegistry.current.name) &&
    Tools.toolRegistry.mounted.hand
  ) {
    Tools.toolRegistry.change("hand");
  }
}

/** @param {unknown} state */
Tools.setBoardState = function setBoardState(state) {
  const boardState = /** @type {AppBoardState} */ (normalizeBoardState(state));
  Tools.access = {
    boardState,
    readOnly: boardState.readonly,
    canWrite: boardState.canWrite,
  };

  const hideEditingTools = Tools.access.readOnly && !Tools.access.canWrite;
  const settings = document.getElementById("settings");
  if (settings) settings.style.display = hideEditingTools ? "none" : "";

  Object.keys(Tools.toolRegistry.mounted || {}).forEach((toolName) => {
    const toolElem = document.getElementById(`toolID-${toolName}`);
    if (!toolElem) return;
    toolElem.style.display = Tools.toolRegistry.shouldDisplayTool(toolName)
      ? ""
      : "none";
  });

  Tools.toolRegistry.syncDrawToolAvailability(true);

  if (
    hideEditingTools &&
    Tools.toolRegistry.current &&
    !Tools.toolRegistry.shouldDisplayTool(Tools.toolRegistry.current.name) &&
    Tools.toolRegistry.mounted.hand
  ) {
    Tools.toolRegistry.change("hand");
  }
};

/** @param {string} toolName */
function shouldDisplayTool(toolName) {
  return getToolButton(toolName) !== null;
}

Tools.dom = withBoardDomActions({ status: "detached" });

//Initialization
document.documentElement.dataset.activeToolSecondary = "false";
Tools.interaction = {
  drawingEvent: true,
  showMarker: true,
  showOtherCursors: true,
  showMyCursor: true,
};

Tools.presence = {
  users: /** @type {ConnectedUserMap} */ ({}),
  panelOpen: false,
  renderConnectedUsers,
  setConnectedUsersPanelOpen,
  upsertConnectedUser,
  removeConnectedUser,
  updateConnectedUsersFromActivity,
  updateCurrentConnectedUserFromActivity,
  initConnectedUsersUI,
};

function isCurrentSocketUser(/** @type {ConnectedUser} */ user) {
  return !!(
    Tools.connection.socket?.id && user.socketId === Tools.connection.socket.id
  );
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toFiniteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getConnectedUsersToggle() {
  return getRequiredElement("connectedUsersToggle");
}

function getConnectedUsersPanel() {
  return getRequiredElement("connectedUsersPanel");
}

function getConnectedUsersList() {
  return getRequiredElement("connectedUsersList");
}

/**
 * @returns {{[socketId: string]: ConnectedUser}}
 */
function getConnectedUsers() {
  return /** @type {{[socketId: string]: ConnectedUser}} */ (
    Tools.presence.users
  );
}

/**
 * @returns {number}
 */
function getConnectedUsersCount() {
  return Object.keys(getConnectedUsers()).length;
}

function syncConnectedUsersToggleLabel() {
  const toggle = getConnectedUsersToggle();
  const label = /** @type {HTMLElement | null} */ (
    toggle.querySelector(".tool-name")
  );
  const userCount = getConnectedUsersCount();
  const accessibleLabel = `${userCount} ${Tools.i18n.t("users")}`;
  toggle.setAttribute("aria-label", accessibleLabel);
  toggle.title = accessibleLabel;
  if (!label) return;
  if (userCount <= 1) {
    label.hidden = true;
    label.textContent = "";
    delete label.dataset.badgeSize;
    return;
  }
  const badgeText = userCount > 99 ? "99+" : String(userCount);
  label.hidden = false;
  label.textContent = badgeText;
  label.dataset.badgeSize =
    badgeText.length === 1
      ? "single"
      : badgeText.length === 2
        ? "double"
        : "capped";
}

/**
 * @param {number | undefined} size
 * @returns {number}
 */
function getConnectedUserDotSize(size) {
  const userSize = Number(size);
  if (!Number.isFinite(userSize) || userSize <= 0) return 8;
  return Math.max(8, Math.min(18, 6 + userSize / 30));
}

/**
 * @param {ConnectedUser} user
 * @returns {string}
 */
function getConnectedUserToolLabel(user) {
  return Tools.i18n.t(user.lastTool || "hand");
}

/**
 * @param {ConnectedUser} user
 * @returns {boolean}
 */
function hasConnectedUserFocus(user) {
  return Number.isFinite(user.lastFocusX) && Number.isFinite(user.lastFocusY);
}

/**
 * @param {{minX: number, minY: number, maxX: number, maxY: number} | null} bounds
 * @returns {{x: number, y: number} | null}
 */
function getBoundsCenter(bounds) {
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/**
 * @param {SVGGraphicsElement} element
 * @returns {{minX: number, minY: number, maxX: number, maxY: number} | null}
 */
function getRenderedElementBounds(element) {
  if (typeof element.transformedBBox !== "function") return null;
  const box = element.transformedBBox();
  /** @type {[number, number][]} */
  const points = [
    box.r,
    [box.r[0] + box.a[0], box.r[1] + box.a[1]],
    [box.r[0] + box.b[0], box.r[1] + box.b[1]],
    [box.r[0] + box.a[0] + box.b[0], box.r[1] + box.a[1] + box.b[1]],
  ];
  const firstPoint = points[0];
  if (!firstPoint) return null;
  return points.reduce(
    /**
     * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds
     * @param {[number, number]} point
     */
    function extend(bounds, point) {
      return {
        minX: Math.min(bounds.minX, point[0]),
        minY: Math.min(bounds.minY, point[1]),
        maxX: Math.max(bounds.maxX, point[0]),
        maxY: Math.max(bounds.maxY, point[1]),
      };
    },
    {
      minX: firstPoint[0],
      minY: firstPoint[1],
      maxX: firstPoint[0],
      maxY: firstPoint[1],
    },
  );
}

/**
 * @param {HandChildMessage[]} children
 * @returns {{x: number, y: number} | null}
 */
function getBatchFocusPoint(children) {
  /** @type {{minX: number, minY: number, maxX: number, maxY: number} | null} */
  let bounds = null;
  children.forEach((child) => {
    const targetId =
      getMutationType(child) === MutationType.UPDATE
        ? hasMessageId(child)
          ? child.id
          : null
        : getMutationType(child) === MutationType.COPY
          ? hasMessageNewId(child)
            ? child.newid
            : null
          : null;
    if (!targetId) return;
    const element = document.getElementById(targetId);
    if (!(element instanceof SVGGraphicsElement)) return;
    const elementBounds = getRenderedElementBounds(element);
    if (!elementBounds) return;
    if (!bounds) {
      bounds = elementBounds;
      return;
    }
    bounds = {
      minX: Math.min(bounds.minX, elementBounds.minX),
      minY: Math.min(bounds.minY, elementBounds.minY),
      maxX: Math.max(bounds.maxX, elementBounds.maxX),
      maxY: Math.max(bounds.maxY, elementBounds.maxY),
    };
  });
  return getBoundsCenter(bounds);
}

/**
 * @param {BoardMessage} message
 * @returns {{x: number, y: number} | null}
 */
function getMessageFocusPoint(message) {
  if (BoardMessages.hasChildMessages(message)) {
    return getBatchFocusPoint(
      /** @type {HandChildMessage[]} */ (message._children),
    );
  }

  if (hasMessagePoint(message)) {
    const pointX = toFiniteCoordinate(message.x);
    const pointY = toFiniteCoordinate(message.y);
    if (pointX !== null && pointY !== null) {
      return { x: pointX, y: pointY };
    }
  }

  if (
    getMutationType(message) === MutationType.UPDATE &&
    hasMessageId(message)
  ) {
    const element = document.getElementById(message.id);
    return element instanceof SVGGraphicsElement
      ? getBoundsCenter(getRenderedElementBounds(element))
      : null;
  }

  return getBoundsCenter(
    MessageCommon.getEffectiveGeometryBounds(/** @type {any} */ (message)),
  );
}

/**
 * @param {ConnectedUser} user
 * @returns {void}
 */
function scheduleConnectedUserPulseEnd(user) {
  if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  if (!user.pulseUntil) {
    user.pulseTimeoutId = null;
    return;
  }
  const remainingMs = Math.max(0, user.pulseUntil - Date.now());
  user.pulseTimeoutId = window.setTimeout(() => {
    if (user.pulseUntil && user.pulseUntil <= Date.now()) {
      user.pulseUntil = 0;
      user.pulseTimeoutId = null;
      Tools.presence.renderConnectedUsers();
    }
  }, remainingMs + 20);
}

/**
 * @param {ConnectedUser} user
 * @returns {void}
 */
function markConnectedUserActivity(user) {
  const now = Date.now();
  const interval = user.lastActivityAt ? now - user.lastActivityAt : 700;
  user.lastActivityAt = now;
  user.pulseMs = Math.max(160, Math.min(1200, interval));
  user.pulseUntil = now + user.pulseMs * 2;
  scheduleConnectedUserPulseEnd(user);
}

/**
 * @param {ConnectedUser} user
 * @returns {string}
 */
function getConnectedUserFocusHash(user) {
  if (!hasConnectedUserFocus(user)) return "";
  const scale = Tools.viewportState.controller.getScale();
  const x = /** @type {number} */ (user.lastFocusX);
  const y = /** @type {number} */ (user.lastFocusY);
  return `#${Math.max(0, (x - window.innerWidth / (2 * scale)) | 0)},${Math.max(
    0,
    (y - window.innerHeight / (2 * scale)) | 0,
  )},${scale.toFixed(VIEWPORT_HASH_SCALE_DECIMALS)}`;
}

/**
 * @param {ConnectedUserRow} row
 * @param {ConnectedUser} user
 * @returns {void}
 */
function updateConnectedUserRow(row, user) {
  row.dataset.socketId = user.socketId;
  row.classList.toggle("connected-user-row-self", isCurrentSocketUser(user));

  const focusHash = getConnectedUserFocusHash(user);
  row.classList.toggle("connected-user-row-jumpable", focusHash !== "");

  const link = /** @type {HTMLAnchorElement | null} */ (
    row.querySelector(".connected-user-main-link")
  );
  if (link) {
    if (focusHash) {
      link.setAttribute("href", focusHash);
      link.removeAttribute("aria-disabled");
      link.tabIndex = 0;
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.tabIndex = -1;
    }
  }

  const color = /** @type {HTMLSpanElement | null} */ (
    row.querySelector(".connected-user-color")
  );
  if (color) {
    color.style.backgroundColor = user.color || "#001f3f";
    const dotSize = getConnectedUserDotSize(user.size);
    color.style.width = `${dotSize}px`;
    color.style.height = `${dotSize}px`;
    if (user.pulseUntil && user.pulseUntil > Date.now()) {
      color.classList.add("active");
      color.style.setProperty("--pulse-ms", `${user.pulseMs || 700}ms`);
    } else {
      color.classList.remove("active");
      color.style.removeProperty("--pulse-ms");
    }
  }

  const name = /** @type {HTMLElement | null} */ (
    row.querySelector(".connected-user-name")
  );
  if (name) name.textContent = user.name;

  const meta = /** @type {HTMLElement | null} */ (
    row.querySelector(".connected-user-meta")
  );
  if (meta) meta.textContent = getConnectedUserToolLabel(user);

  const report = /** @type {HTMLButtonElement | null} */ (
    row.querySelector(".connected-user-report")
  );
  if (report) {
    report.hidden = !!(user.reported && !isCurrentSocketUser(user));
    report.disabled = isCurrentSocketUser(user);
    report.classList.toggle("connected-user-report-latched", !!user.reported);
  }
}

/**
 * @param {ConnectedUser} user
 * @returns {ConnectedUserRow}
 */
function createConnectedUserRow(user) {
  const row = /** @type {ConnectedUserRow} */ (document.createElement("li"));
  row.className = "connected-user-row";

  const color = document.createElement("span");
  color.className = "connected-user-color";
  row.appendChild(color);

  const main = document.createElement("a");
  main.className = "connected-user-main connected-user-main-link";

  const name = document.createElement("div");
  name.className = "connected-user-name";
  main.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "connected-user-meta";
  main.appendChild(meta);

  row.appendChild(main);

  const report = document.createElement("button");
  report.type = "button";
  report.className = "connected-user-report";
  report.textContent = "!";
  report.title = Tools.i18n.t("report");
  report.setAttribute("aria-label", Tools.i18n.t("report"));
  report.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    if (!Tools.connection.socket || !row.dataset.socketId) return;
    const connectedUser = getConnectedUsers()[row.dataset.socketId];
    if (!connectedUser || isCurrentSocketUser(connectedUser)) return;
    connectedUser.reported = true;
    updateConnectedUserRow(row, connectedUser);
    Tools.connection.socket.emit(SocketEvents.REPORT_USER, {
      socketId: connectedUser.socketId,
    });
  });
  row.appendChild(report);

  updateConnectedUserRow(row, user);
  return row;
}

function renderConnectedUsers() {
  const list = getConnectedUsersList();
  const panel = getConnectedUsersPanel();
  /** @type {{[socketId: string]: ConnectedUserRow}} */
  const rowsBySocketId = {};
  Array.from(list.children).forEach((child) => {
    if (
      child instanceof HTMLLIElement &&
      child.dataset.socketId &&
      child.classList.contains("connected-user-row")
    ) {
      rowsBySocketId[child.dataset.socketId] = /** @type {ConnectedUserRow} */ (
        child
      );
    }
  });

  const users = Object.values(getConnectedUsers()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  users.forEach((user, index) => {
    const row = rowsBySocketId[user.socketId] || createConnectedUserRow(user);
    delete rowsBySocketId[user.socketId];
    updateConnectedUserRow(row, user);
    const currentChild = list.children[index];
    if (currentChild !== row) {
      list.insertBefore(row, currentChild || null);
    }
  });

  Object.values(rowsBySocketId).forEach((row) => {
    row.remove();
  });
  panel.dataset.empty = users.length === 0 ? "true" : "false";
  if (users.length === 0 && Tools.presence.panelOpen) {
    Tools.presence.setConnectedUsersPanelOpen(false);
  }
  syncConnectedUsersToggleLabel();
}

function setConnectedUsersPanelOpen(/** @type {boolean} */ open) {
  const shouldOpen = open && getConnectedUsersCount() > 0;
  const panel = getConnectedUsersPanel();
  const toggle = getConnectedUsersToggle();
  Tools.presence.panelOpen = shouldOpen;
  panel.classList.toggle("connected-users-panel-hidden", !shouldOpen);
  toggle.classList.toggle("board-presence-toggle-open", shouldOpen);
  toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function upsertConnectedUser(/** @type {ConnectedUser} */ user) {
  getConnectedUsers()[user.socketId] = Object.assign(
    {},
    getConnectedUsers()[user.socketId] || {},
    user,
  );
  Tools.presence.renderConnectedUsers();
}

function removeConnectedUser(/** @type {string} */ socketId) {
  const user = getConnectedUsers()[socketId];
  if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  delete getConnectedUsers()[socketId];
  Tools.presence.renderConnectedUsers();
}

/**
 * @param {ConnectedUser} user
 * @param {string | undefined} userId
 * @param {string | null} messageSocketId
 * @returns {boolean}
 */
function connectedUserMatchesActivity(user, userId, messageSocketId) {
  if (messageSocketId !== null) {
    return user.socketId === messageSocketId;
  }
  return user.userId === userId;
}

/**
 * @param {ConnectedUser} user
 * @param {BoardMessage} message
 * @param {{x: number, y: number} | null} focusPoint
 * @param {string | null} messageSocketId
 * @returns {boolean}
 */
function applyConnectedUserActivity(
  user,
  message,
  focusPoint,
  messageSocketId,
) {
  let changed = false;
  const runtimeToolId = getRuntimeToolId(message.tool);

  if (!isRuntimeTool(message.tool, "cursor")) {
    markConnectedUserActivity(user);
    changed = true;
  }
  if (hasMessageColor(message)) {
    user.color = message.color;
    changed = true;
  }
  if (hasMessageSize(message)) {
    user.size = message.size || user.size;
    changed = true;
  }
  if (runtimeToolId && runtimeToolId !== "cursor") {
    user.lastTool = runtimeToolId;
    changed = true;
  }
  if (
    focusPoint &&
    (!isRuntimeTool(message.tool, "cursor") ||
      messageSocketId === null ||
      messageSocketId === user.socketId)
  ) {
    user.lastFocusX = /** @type {{x: number, y: number}} */ (focusPoint).x;
    user.lastFocusY = /** @type {{x: number, y: number}} */ (focusPoint).y;
    changed = true;
  }
  return changed;
}

function updateConnectedUsersFromActivity(
  /** @type {string | undefined} */ userId,
  /** @type {BoardMessage} */ message,
) {
  // Presence has three layers:
  // - `socketId`: one live browser tab/socket connection. This is the most precise activity target.
  // - `userId`: derived server-side from the shared user-secret cookie, so multiple tabs from one browser profile can share it.
  // - displayed name: combines an IP-derived word with the `userId`, so it is human-readable but not a stable routing key.
  // When a live message includes `socket`, update that exact row only. Falling back to `userId` keeps older/non-live paths working.
  const messageSocketId = message.socket || null;
  if (!userId && messageSocketId === null) return;
  let changed = false;
  const focusPoint = getMessageFocusPoint(message);
  Object.values(getConnectedUsers()).forEach((user) => {
    if (!connectedUserMatchesActivity(user, userId, messageSocketId)) return;
    changed =
      applyConnectedUserActivity(user, message, focusPoint, messageSocketId) ||
      changed;
  });
  if (changed) Tools.presence.renderConnectedUsers();
}

function updateCurrentConnectedUserFromActivity(
  /** @type {BoardMessage} */ message,
) {
  if (!Tools.connection.socket?.id) return;
  const current = getConnectedUsers()[Tools.connection.socket.id];
  if (!current) return;
  Tools.presence.updateConnectedUsersFromActivity(
    current.userId,
    Object.assign({}, message, { socket: current.socketId }),
  );
}

function initConnectedUsersUI() {
  const toggle = document.getElementById("connectedUsersToggle");
  const panel = document.getElementById("connectedUsersPanel");
  if (!(toggle instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
    return;
  }
  Tools.presence.panelOpen = toggle.getAttribute("aria-expanded") === "true";
  syncConnectedUsersToggleLabel();
  if (toggle.dataset.connectedUsersUiBound !== "true") {
    toggle.dataset.connectedUsersUiBound = "true";
    toggle.addEventListener("click", () => {
      Tools.presence.setConnectedUsersPanelOpen(!Tools.presence.panelOpen);
    });
    toggle.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (
          !panel.matches(":hover") &&
          !panel.contains(document.activeElement) &&
          document.activeElement !== toggle
        ) {
          Tools.presence.setConnectedUsersPanelOpen(false);
        }
      }, 0);
    });
    panel.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        Tools.presence.setConnectedUsersPanelOpen(false);
        toggle.focus();
      }
    });
  }
  Tools.presence.renderConnectedUsers();
}

Tools.startConnection = () => {
  const reusableSocket =
    Tools.connection.socket && !Tools.connection.socket.connected
      ? Tools.connection.socket
      : null;
  if (Tools.connection.socket && !reusableSocket) {
    BoardConnection.closeSocket(Tools.connection.socket);
    Tools.connection.socket = null;
  }
  Tools.connection.state = "connecting";
  Tools.replay.awaitingSnapshot = true;
  Object.values(getConnectedUsers()).forEach((user) => {
    if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  });
  Tools.presence.users = /** @type {ConnectedUserMap} */ ({});
  Tools.presence.renderConnectedUsers();

  void (async function openSocketWithBaseline() {
    if (!getAttachedBoardDom()) {
      scheduleSocketReconnect();
      return;
    }
    if (Tools.replay.refreshBaselineBeforeConnect) {
      try {
        await Tools.replay.refreshAuthoritativeBaseline();
        Tools.replay.refreshBaselineBeforeConnect = false;
      } catch (error) {
        logBoardEvent("error", "replay.baseline_refresh_failed", {
          error: error instanceof Error ? error.message : String(error),
          baselineUrl: getAuthoritativeBaselineUrl(),
          pendingPreSnapshotMessages: Tools.replay.preSnapshotMessages.length,
        });
        scheduleSocketReconnect(1000);
        return;
      }
    }

    const socketParams = BoardConnection.buildSocketParams(
      window.location.pathname,
      Tools.connection.socketIOExtraHeaders,
      Tools.identity.token,
      Tools.identity.boardName,
      {
        baselineSeq: String(Tools.replay.authoritativeSeq),
        tool: Tools.preferences.initial.tool,
        color: Tools.preferences.getColor(),
        size: String(Tools.preferences.getSize()),
      },
    );

    if (reusableSocket) {
      if (reusableSocket.io) {
        reusableSocket.io.opts = {
          ...(reusableSocket.io.opts || {}),
          query: socketParams.query || "",
        };
      }
      reusableSocket.connect?.();
      return;
    }

    const socket = io.connect("", socketParams);
    Tools.connection.socket = socket;

    //Receive draw instructions from the server
    socket.on(SocketEvents.CONNECT, function onConnection() {
      const hadConnectedBefore = Tools.connection.hasConnectedOnce;
      Tools.connection.state = "connected";
      logBoardEvent(
        "log",
        hadConnectedBefore ? "socket.reconnected" : "socket.connected",
      );
      if (hadConnectedBefore && Tools.config.serverConfig.TURNSTILE_SITE_KEY) {
        Tools.turnstile.setValidation(null);
        BoardTurnstile.resetTurnstileWidget(
          typeof turnstile !== "undefined" ? turnstile : undefined,
          Tools.turnstile.widgetId,
        );
      }
      Tools.connection.hasConnectedOnce = true;
      Tools.status.syncWriteStatusIndicator();
    });
    socket.on(
      SocketEvents.BROADCAST,
      (/** @type {IncomingBroadcast} */ msg) => {
        enqueueIncomingBroadcast(msg);
      },
    );
    socket.on(SocketEvents.BOARDSTATE, Tools.setBoardState);
    socket.on(
      SocketEvents.MUTATION_REJECTED,
      function onMutationRejected(
        /** @type {MutationRejectedPayload} */ payload,
      ) {
        if (
          typeof payload?.clientMutationId === "string" &&
          payload.clientMutationId
        ) {
          Tools.optimistic.rejectMutation(
            payload.clientMutationId,
            payload.reason,
          );
        }
        Tools.status.showUnknownMutationError(payload.reason);
      },
    );
    socket.on(
      SocketEvents.CONNECT_ERROR,
      function onConnectError(/** @type {unknown} */ error) {
        if (socket !== Tools.connection.socket) return;
        const data =
          error && typeof error === "object" && "data" in error
            ? /** @type {{reason?: string, latestSeq?: number, minReplayableSeq?: number}} */ (
                error.data
              )
            : undefined;
        const reason =
          data?.reason ||
          (error && typeof error === "object" && "message" in error
            ? String(error.message)
            : "connect_error");
        logBoardEvent("warn", "socket.connect_error", {
          reason,
          ...(data?.latestSeq === undefined
            ? {}
            : { latestSeq: data.latestSeq }),
          ...(data?.minReplayableSeq === undefined
            ? {}
            : { minReplayableSeq: data.minReplayableSeq }),
          authoritativeSeq: Tools.replay.authoritativeSeq,
        });
        Tools.connection.state = "disconnected";
        if (reason === "baseline_not_replayable") {
          logBoardEvent("warn", "replay.baseline_not_replayable", {
            authoritativeSeq: Tools.replay.authoritativeSeq,
            latestSeq: BoardMessageReplay.normalizeSeq(data?.latestSeq),
            minReplayableSeq: BoardMessageReplay.normalizeSeq(
              data?.minReplayableSeq,
            ),
          });
          Tools.replay.beginAuthoritativeResync();
          if (socket === Tools.connection.socket) {
            Tools.connection.socket = null;
            BoardConnection.closeSocket(socket);
          }
        }
        scheduleSocketReconnect();
      },
    );
    socket.on(
      SocketEvents.USER_JOINED,
      function onUserJoined(/** @type {ConnectedUser} */ user) {
        Tools.presence.upsertConnectedUser(user);
      },
    );
    socket.on(
      SocketEvents.USER_LEFT,
      function onUserLeft(
        /** @type {import("../../types/app-runtime").UserLeftPayload} */ user,
      ) {
        Tools.presence.removeConnectedUser(user.socketId);
      },
    );
    socket.on(
      SocketEvents.RATE_LIMITED,
      function onRateLimited(
        /** @type {{retryAfterMs?: number} | null | undefined} */ payload,
      ) {
        const retryAfterMs =
          payload && typeof payload.retryAfterMs === "number"
            ? payload.retryAfterMs
            : 60 * 1000;
        Tools.writes.serverRateLimitedUntil =
          Date.now() + Math.max(0, retryAfterMs);
        Tools.status.showRateLimitNotice(
          Tools.i18n.t("rate_limit_disconnect_message"),
          retryAfterMs,
        );
        Tools.status.syncWriteStatusIndicator();
      },
    );
    socket.on(
      SocketEvents.DISCONNECT,
      function onDisconnect(/** @type {string} */ reason) {
        if (socket !== Tools.connection.socket) return;
        if (reason === "io client disconnect") return;
        Tools.connection.state = "disconnected";
        logBoardEvent("warn", "socket.disconnected", { reason });
        Tools.replay.beginAuthoritativeResync();
        scheduleSocketReconnect();
      },
    );
    if (typeof socket.connect === "function") {
      socket.connect();
    }
  })();
};
function saveBoardNametoLocalStorage() {
  const boardName = Tools.identity.boardName;
  const key = "recent-boards";
  let recentBoards;
  try {
    const storedBoards = localStorage.getItem(key);
    recentBoards = storedBoards ? JSON.parse(storedBoards) : [];
  } catch (e) {
    // On localstorage or json error, reset board list
    recentBoards = [];
    logBoardEvent("warn", "boot.recent_boards_load_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  recentBoards = updateRecentBoards(recentBoards, boardName);
  localStorage.setItem(key, JSON.stringify(recentBoards));
}
// Refresh recent boards list on each page show
window.addEventListener("pageshow", saveBoardNametoLocalStorage);

/**
 * @param {HTMLElement} button
 * @param {string} toolName
 * @returns {void}
 */
function bindToolButton(button, toolName) {
  if (button.dataset.toolBound === "true") return;
  button.dataset.toolId = toolName;
  button.dataset.toolBound = "true";
  button.setAttribute("aria-label", toolName);
  button.addEventListener("click", () => {
    void Tools.toolRegistry.activateTool(toolName);
  });
  button.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      void Tools.toolRegistry.activateTool(toolName);
    }
  });
}

/**
 * @param {string} toolName
 * @returns {HTMLElement | null}
 */
function getToolButton(toolName) {
  const button = document.getElementById(`toolID-${toolName}`);
  return button instanceof HTMLElement ? button : null;
}

/**
 * @param {string} toolName
 * @param {MountedAppTool} tool
 * @returns {void}
 */
function syncToolButton(toolName, tool) {
  const button = getToolButton(toolName);
  if (!button) return;
  bindToolButton(button, toolName);
  const parts = getRequiredToolButtonParts(toolName);
  const translatedToolName = Tools.i18n.t(toolName);
  parts.label.textContent = translatedToolName;
  button.setAttribute("aria-label", translatedToolName);
  parts.primaryIcon.src = Tools.assets.resolveAssetPath(tool.icon);
  parts.primaryIcon.alt = "";
  button.classList.toggle("oneTouch", tool.oneTouch === true);
  button.classList.toggle("hasSecondary", !!tool.secondary);
  parts.primaryIcon.classList.toggle("primaryIcon", !!tool.secondary);
  button.title = tool.shortcut
    ? `${translatedToolName} (${Tools.i18n.t("keyboard shortcut")}: ${tool.shortcut})`
    : translatedToolName;
  if (tool.secondary && parts.secondaryIcon) {
    parts.secondaryIcon.src = Tools.assets.resolveAssetPath(
      tool.secondary.icon,
    );
    parts.secondaryIcon.alt = "";
    button.title += ` [${Tools.i18n.t("click_to_toggle")}]`;
  } else if (parts.secondaryIcon) {
    parts.secondaryIcon.src = "data:,";
    parts.secondaryIcon.alt = "";
  }
}

function bindRenderedToolButtons() {
  document
    .querySelectorAll("#tools > .tool[data-tool-id]")
    .forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const toolName = element.dataset.toolId;
      if (!toolName) return;
      bindToolButton(element, toolName);
    });
}

/**
 * @param {string} key
 * @param {() => void} callback
 * @returns {void}
 */
function addToolShortcut(key, callback) {
  window.addEventListener("keydown", (e) => {
    if (e.key === key && !isTextEntryTarget(e.target)) {
      callback();
    }
  });
}

/**
 * @param {string} toolName
 * @returns {HTMLElement | null}
 */
function syncMountedToolButton(toolName) {
  const tool = Tools.toolRegistry.mounted[toolName];
  if (!tool) {
    throw new Error(`Tool not registered before rendering: ${toolName}`);
  }
  if (tool.shortcut) {
    addToolShortcut(tool.shortcut, () => {
      void Tools.toolRegistry.activateTool(toolName);
      blurActiveElement();
    });
  }
  syncToolButton(toolName, tool);
  Tools.toolRegistry.syncToolDisabledState(toolName);
  return getToolButton(toolName);
}

/**
 * @param {string} oldToolName
 * @param {string} newToolName
 * @returns {void}
 */
function changeActiveToolButton(oldToolName, newToolName) {
  const oldTool = document.getElementById(`toolID-${oldToolName}`);
  const newTool = document.getElementById(`toolID-${newToolName}`);
  if (oldTool) oldTool.classList.remove("curTool");
  if (newTool) newTool.classList.add("curTool");
}

/**
 * @param {string} toolName
 * @param {string} name
 * @param {string} icon
 * @returns {void}
 */
function toggleToolButtonMode(toolName, name, icon) {
  const parts = getRequiredToolButtonParts(toolName);
  const secondaryIcon = parts.secondaryIcon;
  if (!secondaryIcon) {
    throw new Error(`Missing secondary icon for tool ${toolName}`);
  }
  const primaryIconSrc = parts.primaryIcon.src;
  parts.primaryIcon.src = secondaryIcon.src;
  secondaryIcon.src = primaryIconSrc;
  parts.primaryIcon.src = Tools.assets.resolveAssetPath(icon);
  parts.label.textContent = Tools.i18n.t(name);
}

/**
 * @param {string} href
 * @returns {HTMLLinkElement}
 */
function addToolStylesheet(href) {
  const resolvedHref = Tools.assets.resolveAssetPath(href);
  const existing = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  ).find((link) => link.getAttribute("href") === resolvedHref);
  if (existing instanceof HTMLLinkElement) return existing;
  const link = document.createElement("link");
  link.href = resolvedHref;
  link.rel = "stylesheet";
  link.type = "text/css";
  document.head.appendChild(link);
  return link;
}

const colorPresetContainer = getRequiredElement("colorPresetSel");
const colorPresetTemplateElement =
  colorPresetContainer.querySelector(".colorPresetButton");
if (!(colorPresetTemplateElement instanceof HTMLElement)) {
  throw new Error("Missing required color preset template");
}
const colorPresetTemplate = colorPresetTemplateElement;
colorPresetTemplate.remove();

/**
 * @param {ColorPreset} button
 * @returns {HTMLElement}
 */
function addColorButton(button) {
  const setColor = Tools.preferences.setColor.bind(Tools, button.color);
  if (button.key) addToolShortcut(button.key, setColor);
  const elem = colorPresetTemplate.cloneNode(true);
  if (!(elem instanceof HTMLElement)) {
    throw new Error("Color preset template clone must be an element");
  }
  elem.addEventListener("click", setColor);
  elem.id = `color_${button.color.replace(/^#/, "")}`;
  elem.style.backgroundColor = button.color;
  if (button.key) {
    elem.title = `${Tools.i18n.t("keyboard shortcut")}: ${button.key}`;
  }
  colorPresetContainer.appendChild(elem);
  return elem;
}

bindRenderedToolButtons();

/**
 * @param {string} toolName
 * @returns {Promise<ToolModule>}
 */
async function loadToolModule(toolName) {
  const namespace = /** @type {ToolModule} */ (
    await import(
      Tools.assets.resolveAssetPath(getToolModuleImportPath(toolName))
    )
  );
  if (typeof namespace.boot !== "function") {
    throw new Error(`Missing boot export for ${toolName}.`);
  }
  if (namespace.toolId !== toolName) {
    throw new Error(
      `Tool module for ${toolName} exported ${String(namespace.toolId)}.`,
    );
  }
  return namespace;
}

/**
 * @param {MountedAppToolsState} mountedTools
 * @returns {ToolRuntimeModules}
 */
function createToolRuntimeModules(mountedTools) {
  return {
    board: {
      status: mountedTools.dom.status,
      board: mountedTools.dom.board,
      svg: mountedTools.dom.svg,
      drawingArea: mountedTools.dom.drawingArea,
      createSVGElement: (name, attrs) =>
        mountedTools.dom.createSVGElement(name, attrs),
      toBoardCoordinate: (value) =>
        mountedTools.coordinates.toBoardCoordinate(value),
      pageCoordinateToBoard: (value) =>
        mountedTools.coordinates.pageCoordinateToBoard(value),
    },
    viewport: mountedTools.viewportState.controller,
    writes: {
      drawAndSend: (message) => mountedTools.writes.drawAndSend(message),
      send: (message) => mountedTools.writes.send(message),
      canBufferWrites: () => mountedTools.writes.canBufferWrites(),
      whenBoardWritable: () => mountedTools.writes.whenBoardWritable(),
    },
    identity: mountedTools.identity,
    preferences: {
      getColor: () => mountedTools.preferences.getColor(),
      getSize: () => mountedTools.preferences.getSize(),
      setSize: (size) => mountedTools.preferences.setSize(size),
      getOpacity: () => mountedTools.preferences.getOpacity(),
    },
    rateLimits: {
      getEffectiveRateLimit: (kind) =>
        mountedTools.rateLimits.getEffectiveRateLimit(kind),
    },
    ui: {
      getCurrentTool: () => mountedTools.toolRegistry.current,
      changeTool: (toolName) => mountedTools.toolRegistry.change(toolName),
      shouldShowMarker: () => mountedTools.interaction.showMarker,
      shouldShowMyCursor: () => mountedTools.interaction.showMyCursor,
    },
    config: {
      serverConfig: mountedTools.config.serverConfig,
    },
    ids: {
      generateUID: (prefix, suffix) =>
        mountedTools.ids.generateUID(prefix, suffix),
    },
    rendering: {
      markDrawingEvent: () => {
        mountedTools.interaction.drawingEvent = true;
      },
    },
    messages: {
      messageForTool: (message) =>
        mountedTools.messages.messageForTool(message),
    },
    permissions: {
      canWrite: () => mountedTools.access.canWrite,
    },
  };
}

/**
 * @param {string} toolName
 * @returns {ToolBootContext}
 */
function createToolBootContext(toolName) {
  /** @type {MountedAppToolsState} */
  const mountedTools = (() => {
    if (Tools.dom.status !== "attached") {
      throw new Error("Tool boot requires board, svg, and drawing area.");
    }
    return /** @type {MountedAppToolsState} */ (Tools);
  })();
  return {
    runtime: createToolRuntimeModules(mountedTools),
    assetUrl: (assetFile) => Tools.assets.getToolAssetUrl(toolName, assetFile),
  };
}

/**
 * @param {ToolModule} toolModule
 * @param {unknown} toolState
 * @param {string} toolName
 * @returns {MountedAppTool}
 */
function createMountedTool(toolModule, toolState, toolName) {
  if (typeof toolModule.draw !== "function") {
    throw new Error(`Missing draw export for ${toolName}.`);
  }
  const draw = toolModule.draw;
  const normalizeServerRenderedElement =
    toolModule.normalizeServerRenderedElement;
  const press = toolModule.press;
  const move = toolModule.move;
  const release = toolModule.release;
  const onMessage = toolModule.onMessage;
  const onstart = toolModule.onstart;
  const onquit = toolModule.onquit;
  const onSocketDisconnect = toolModule.onSocketDisconnect;
  const onMutationRejected = toolModule.onMutationRejected;
  const onSizeChange = toolModule.onSizeChange;
  const touchListenerOptions = toolModule.touchListenerOptions;
  const getTouchPolicy = toolModule.getTouchPolicy;
  const toolStateObject =
    /** @type {{mouseCursor?: string, secondary?: import("../../types/app-runtime").ToolSecondaryMode | null} | null} */ (
      toolState && typeof toolState === "object" ? toolState : null
    );
  const toolDefinition = TOOL_BY_ID[toolName];
  /** @type {MountedAppTool} */
  const tool = {
    name: toolName,
    shortcut: toolModule.shortcut,
    icon: "",
    draw: (message, isLocal) => draw(toolState, message, isLocal),
    normalizeServerRenderedElement:
      typeof normalizeServerRenderedElement === "function"
        ? (element) => normalizeServerRenderedElement(toolState, element)
        : undefined,
    serverRenderedElementSelector: toolModule.serverRenderedElementSelector,
    press:
      typeof press === "function"
        ? (x, y, evt, isTouchEvent) => press(toolState, x, y, evt, isTouchEvent)
        : undefined,
    move:
      typeof move === "function"
        ? (x, y, evt, isTouchEvent) => move(toolState, x, y, evt, isTouchEvent)
        : undefined,
    release:
      typeof release === "function"
        ? (x, y, evt, isTouchEvent) =>
            release(toolState, x, y, evt, isTouchEvent)
        : undefined,
    onMessage:
      typeof onMessage === "function"
        ? (message) => onMessage(toolState, message)
        : () => {},
    listeners: {},
    compiledListeners: {},
    onstart:
      typeof onstart === "function"
        ? (oldTool) => onstart(toolState, oldTool)
        : () => {},
    onquit:
      typeof onquit === "function"
        ? (newTool) => onquit(toolState, newTool)
        : () => {},
    onSocketDisconnect:
      typeof onSocketDisconnect === "function"
        ? () => onSocketDisconnect(toolState)
        : () => {},
    onMutationRejected:
      typeof onMutationRejected === "function"
        ? (message, reason) => onMutationRejected(toolState, message, reason)
        : undefined,
    stylesheet: undefined,
    oneTouch: toolModule.oneTouch,
    alwaysOn: toolModule.alwaysOn,
    mouseCursor: toolModule.mouseCursor ?? toolStateObject?.mouseCursor,
    helpText: toolModule.helpText,
    secondary: toolStateObject?.secondary ?? toolModule.secondary ?? null,
    onSizeChange:
      typeof onSizeChange === "function"
        ? (size) => onSizeChange(toolState, size)
        : undefined,
    getTouchPolicy:
      typeof getTouchPolicy === "function"
        ? () => getTouchPolicy(toolState)
        : undefined,
    showMarker: toolModule.showMarker,
    requiresWritableBoard: toolModule.requiresWritableBoard,
    touchListenerOptions:
      touchListenerOptions && typeof touchListenerOptions === "object"
        ? touchListenerOptions
        : undefined,
  };
  if (toolDefinition) {
    tool.icon ||= getToolIconPath(toolDefinition.toolId);
    tool.stylesheet ||=
      getToolStylesheetPath(
        toolDefinition.toolId,
        toolDefinition.drawsOnBoard,
      ) || undefined;
  }
  tool.listeners = {
    press: tool.press,
    move: tool.move,
    release: tool.release,
  };

  /**
   * @param {ToolPointerListener} listener
   * @param {boolean} isTouchEvent
   * @returns {CompiledToolListener}
   */
  function compilePointerListener(listener, isTouchEvent) {
    return function handlePointer(evt) {
      if (isTouchEvent) {
        const touchEvent = /** @type {TouchEvent} */ (evt);
        if (touchEvent.changedTouches.length !== 1) return true;
        if (
          (touchEvent.type === "touchstart" ||
            touchEvent.type === "touchmove") &&
          touchEvent.touches.length !== 1
        ) {
          return true;
        }
        if (
          (touchEvent.type === "touchend" ||
            touchEvent.type === "touchcancel") &&
          touchEvent.touches.length !== 0
        ) {
          return true;
        }
        const touch = touchEvent.changedTouches[0];
        if (!touch) return true;
        return listener(
          Tools.coordinates.pageCoordinateToBoard(touch.pageX),
          Tools.coordinates.pageCoordinateToBoard(touch.pageY),
          touchEvent,
          true,
        );
      }
      const mouseEvent = /** @type {MouseEvent} */ (evt);
      return listener(
        Tools.coordinates.pageCoordinateToBoard(mouseEvent.pageX),
        Tools.coordinates.pageCoordinateToBoard(mouseEvent.pageY),
        mouseEvent,
        false,
      );
    };
  }

  /**
   * @param {CompiledToolListener} listener
   * @returns {CompiledToolListener}
   */
  function wrapUnsetHover(listener) {
    return function unsetHover(evt) {
      blurActiveElement();
      return listener(evt);
    };
  }

  const compiled = /** @type {CompiledToolListeners} */ ({});
  if (tool.listeners.press) {
    compiled.mousedown = wrapUnsetHover(
      compilePointerListener(tool.listeners.press, false),
    );
    compiled.touchstart = wrapUnsetHover(
      compilePointerListener(tool.listeners.press, true),
    );
  }
  if (tool.listeners.move) {
    compiled.mousemove = compilePointerListener(tool.listeners.move, false);
    compiled.touchmove = compilePointerListener(tool.listeners.move, true);
  }
  if (tool.listeners.release) {
    compiled.mouseup = compilePointerListener(tool.listeners.release, false);
    compiled.mouseleave = compiled.mouseup;
    const touchRelease = compilePointerListener(tool.listeners.release, true);
    compiled.touchleave = touchRelease;
    compiled.touchend = touchRelease;
    compiled.touchcancel = touchRelease;
  }
  tool.compiledListeners = compiled;
  return tool;
}

/**
 * @param {ToolModule} toolModule
 * @param {unknown} toolState
 * @param {string} toolName
 * @returns {MountedAppTool | null}
 */
function mountTool(toolModule, toolState, toolName) {
  const mountedTool = createMountedTool(toolModule, toolState, toolName);
  if (mountedTool.stylesheet) {
    addToolStylesheet(mountedTool.stylesheet);
  }
  if (Tools.toolRegistry.isBlocked(mountedTool)) return null;

  if (toolName in Tools.toolRegistry.mounted) {
    logBoardEvent("warn", "tool.mount_replaced", {
      toolName,
    });
  }

  Tools.toolRegistry.mounted[toolName] = mountedTool;

  if (mountedTool.onSizeChange) {
    Tools.preferences.sizeChangeHandlers.push(mountedTool.onSizeChange);
  }

  const pending = drainPendingMessages(
    Tools.toolRegistry.pendingMessages,
    toolName,
  );
  if (pending.length > 0) {
    logBoardEvent("log", "tool.pending_replayed", {
      toolName,
      count: pending.length,
    });
    pending.forEach((/** @type {BoardMessage} */ msg) => {
      mountedTool.draw(msg, false);
    });
  }
  if (Tools.toolRegistry.shouldDisplayTool(toolName)) {
    syncMountedToolButton(toolName);
  }
  Tools.toolRegistry.syncToolDisabledState(toolName);
  if (mountedTool.alwaysOn === true) {
    Tools.toolRegistry.addToolListeners(mountedTool);
  }
  normalizeServerRenderedElementsForTool(mountedTool);
  return mountedTool;
}

/**
 * @param {string} toolName
 * @returns {Promise<MountedAppTool | null>}
 */
async function bootToolPromise(toolName) {
  const toolModule = await loadToolModule(toolName);
  const toolState = await toolModule.boot(createToolBootContext(toolName));
  if (toolState === null) return null;
  return Tools.toolRegistry.mountTool(toolModule, toolState, toolName);
}

/**
 * @param {string} toolName
 * @returns {Promise<MountedAppTool | null>}
 */
async function bootTool(toolName) {
  const existingTool = Tools.toolRegistry.mounted[toolName];
  if (existingTool) return existingTool;
  const inFlight = Tools.toolRegistry.bootPromises[toolName];
  if (inFlight) return inFlight;

  const promise = bootToolPromise(toolName);
  Tools.toolRegistry.bootPromises[toolName] = promise;
  try {
    return await promise;
  } finally {
    delete Tools.toolRegistry.bootPromises[toolName];
  }
}

/**
 * @param {string} toolName
 * @returns {Promise<boolean>}
 */
async function activateTool(toolName) {
  if (!Tools.toolRegistry.shouldDisplayTool(toolName)) return false;
  const tool = await Tools.toolRegistry.bootTool(toolName);
  if (!tool || !Tools.toolRegistry.canUseTool(toolName)) return false;
  if (tool.requiresWritableBoard === true && !Tools.writes.canBufferWrites()) {
    await Tools.writes.whenBoardWritable();
    if (!Tools.toolRegistry.canUseTool(toolName)) return false;
  }
  return Tools.toolRegistry.change(toolName) !== false;
}

/** @param {MountedAppTool} tool */
function isBlocked(tool) {
  return isBlockedToolName(
    tool.name,
    Tools.config.serverConfig.BLOCKED_TOOLS || [],
  );
}

/** @param {MountedAppTool} newTool */
function toggleSecondaryTool(newTool) {
  if (!newTool.secondary) return;
  newTool.secondary.active = !newTool.secondary.active;
  const props = newTool.secondary.active ? newTool.secondary : newTool;
  toggleToolButtonMode(newTool.name, props.name, props.icon);
  if (newTool.secondary.switch) newTool.secondary.switch();
  syncActiveToolState();
  Tools.toolRegistry.syncActiveToolInputPolicy();
}

/**
 * @param {string} toolName
 * @param {MountedAppTool} newTool
 * @returns {void}
 */
function updateCurrentToolChrome(toolName, newTool) {
  const dom = getAttachedBoardDom();
  if (!dom) return;
  const curToolName = Tools.toolRegistry.current
    ? Tools.toolRegistry.current.name
    : "";
  try {
    changeActiveToolButton(curToolName, toolName);
  } catch (e) {
    logBoardEvent("error", "tool.chrome_update_failed", {
      toolName,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  dom.svg.style.cursor = newTool.mouseCursor || "auto";
  dom.board.title = Tools.i18n.t(newTool.helpText || "");
}

/** @param {MountedAppTool} newTool */
function replaceCurrentTool(newTool) {
  const currentTool = Tools.toolRegistry.current;
  if (currentTool !== null) {
    Tools.toolRegistry.removeToolListeners(currentTool);
    currentTool.onquit && currentTool.onquit(newTool);
  }
  Tools.toolRegistry.addToolListeners(newTool);
  Tools.toolRegistry.current = newTool;
  syncActiveToolState();
}

function syncActiveToolState() {
  const currentTool = Tools.toolRegistry.current;
  if (!currentTool) {
    delete document.documentElement.dataset.activeTool;
    delete document.documentElement.dataset.activeToolMode;
    document.documentElement.dataset.activeToolSecondary = "false";
    return;
  }
  document.documentElement.dataset.activeTool = currentTool.name;
  document.documentElement.dataset.activeToolMode =
    currentTool.secondary && currentTool.secondary.active
      ? currentTool.secondary.name
      : currentTool.name;
  document.documentElement.dataset.activeToolSecondary =
    currentTool.secondary && currentTool.secondary.active ? "true" : "false";
}

function syncActiveToolInputPolicy() {
  Tools.viewportState.controller.setTouchPolicy(
    Tools.toolRegistry.current?.getTouchPolicy?.() || "app-gesture",
  );
}

/** @param {string} toolName */
function change(toolName) {
  const newTool = Tools.toolRegistry.mounted[toolName];
  const oldTool = Tools.toolRegistry.current;
  if (!newTool)
    throw new Error("Trying to select a tool that has never been added!");
  if (Tools.toolRegistry.shouldDisableTool(toolName)) return false;
  if (newTool === oldTool) {
    toggleSecondaryTool(newTool);
    return;
  }
  if (!newTool.oneTouch) {
    updateCurrentToolChrome(toolName, newTool);
    replaceCurrentTool(newTool);
  }

  if (newTool.onstart) newTool.onstart(oldTool);
  Tools.toolRegistry.syncActiveToolInputPolicy();
  return true;
}

/** @param {MountedAppTool} tool */
function addToolListeners(tool) {
  const dom = getAttachedBoardDom();
  if (!tool.compiledListeners) return;
  for (const event in tool.compiledListeners) {
    const listener = tool.compiledListeners[event];
    if (!listener) continue;
    const target = listener.target || dom?.board;
    if (!target) continue;
    target.addEventListener(
      event,
      listener,
      event.startsWith("touch")
        ? tool.touchListenerOptions || { passive: false }
        : { passive: false },
    );
  }
}

/** @param {MountedAppTool} tool */
function removeToolListeners(tool) {
  const dom = getAttachedBoardDom();
  if (!tool.compiledListeners) return;
  for (const event in tool.compiledListeners) {
    const listener = tool.compiledListeners[event];
    if (!listener) continue;
    const target = listener.target || dom?.board;
    if (!target) continue;
    target.removeEventListener(event, listener);
  }
}

(() => {
  // Handle secondary tool switch with shift (key code 16)
  /**
   * @param {boolean} active
   * @param {KeyboardEvent} evt
   */
  function handleShift(active, evt) {
    if (
      evt.keyCode === 16 &&
      Tools.toolRegistry.current &&
      Tools.toolRegistry.current.secondary &&
      Tools.toolRegistry.current.secondary.active !== active
    ) {
      Tools.toolRegistry.change(Tools.toolRegistry.current.name);
    }
  }
  window.addEventListener("keydown", handleShift.bind(null, true));
  window.addEventListener("keyup", handleShift.bind(null, false));
})();

/**
 * Takes ownership of data. Callers must not mutate it after sending.
 * @param {LiveBoardMessage} data
 */
function send(data) {
  Tools.messages.applyHooks(Tools.messages.hooks, data);
  return Tools.writes.sendBufferedWrite(data);
}

/**
 * Takes ownership of data. Callers must create a fresh message object and must
 * not mutate it after calling this function, because it may be queued and sent
 * asynchronously.
 * @param {LiveBoardMessage} data
 */
function drawAndSend(data) {
  const toolName = getRuntimeToolId(data.tool);
  if (!toolName) throw new Error(`Unknown tool code '${data.tool}'.`);
  const mountedTool = Tools.toolRegistry.mounted[toolName];
  if (!mountedTool) throw new Error(`Missing mounted tool '${data.tool}'.`);
  if (Tools.toolRegistry.shouldDisableTool(toolName)) return false;
  if (
    !Tools.connection.socket ||
    !Tools.connection.socket.connected ||
    Tools.replay.awaitingSnapshot ||
    Tools.writes.isWritePaused()
  ) {
    return false;
  }

  if (toolName !== "cursor") {
    data.clientMutationId = Tools.ids.generateUID("cm-");
  }
  const rollback = Tools.optimistic.captureRollback(data);

  // Optimistically render the drawing immediately
  mountedTool.draw(data, true);

  if (
    MessageCommon.requiresTurnstile(Tools.identity.boardName, toolName) &&
    Tools.config.serverConfig.TURNSTILE_SITE_KEY &&
    !Tools.turnstile.isValidated()
  ) {
    Tools.optimistic.trackMutation(data, rollback);
    Tools.turnstile.queueProtectedWrite(data);
    return true;
  }

  const sent = Tools.writes.send(data) !== false;
  if (sent) {
    Tools.optimistic.trackMutation(data, rollback);
  }
  return sent;
}

/**
 * Send a message to the corresponding tool.
 * @param {BoardMessage} message
 * @returns {void}
 */
function messageForTool(message) {
  const name = getRuntimeToolId(message.tool);
  const tool = name ? Tools.toolRegistry.mounted[name] : undefined;

  Tools.messages.applyHooks(Tools.messages.hooks, message);
  if (tool) {
    tool.draw(message, false);
  } else {
    ///We received a message destinated to a tool that we don't have
    //So we add it to the pending messages
    if (name)
      BoardMessages.queuePendingMessage(
        Tools.toolRegistry.pendingMessages,
        name,
        message,
      );
  }
}

/**
 * Call messageForTool recursively on the message and its children.
 * @param {BoardMessage} message
 * @returns {Promise<void>}
 */
function handleMessage(message) {
  pruneBufferedWritesForInvalidatingMessage(message);
  Tools.messages.messageForTool(message);
  if (BoardMessages.hasChildMessages(message)) {
    return Promise.resolve();
  }
  return Promise.resolve();
}

Tools.messages = {
  hooks: [],
  unreadCount: 0,
  applyHooks,
  messageForTool,
  newUnreadMessage,
};

function newUnreadMessage() {
  Tools.messages.unreadCount++;
  updateDocumentTitle();
}

window.addEventListener("focus", () => {
  Tools.messages.unreadCount = 0;
  updateDocumentTitle();
  if (Tools.writes.bufferedWrites.length > 0) {
    Tools.writes.flushBufferedWrites();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Tools.writes.bufferedWrites.length > 0) {
    Tools.writes.flushBufferedWrites();
  }
});

function updateDocumentTitle() {
  document.title =
    (Tools.messages.unreadCount ? `(${Tools.messages.unreadCount}) ` : "") +
    `${Tools.identity.boardName} | WBO`;
}

/** @param {BoardMessage} m */
function resizeCanvas(m) {
  // Compatibility hook name; root SVG and page size mutation is owned by viewport.
  Tools.viewportState.controller.ensureBoardExtentForBounds(
    getContentMessageBounds(m),
  );
}

/** @param {BoardMessage} m */
function updateUnreadCount(m) {
  const mutationType = getMutationType(m);
  if (
    document.hidden &&
    mutationType !== MutationType.APPEND &&
    mutationType !== MutationType.UPDATE
  ) {
    Tools.messages.newUnreadMessage();
  }
}

/** @param {BoardMessage} m */
function notifyToolsOfMessage(m) {
  Object.values(Tools.toolRegistry.mounted || {}).forEach((tool) => {
    tool?.onMessage?.(m);
  });
}

// List of hook functions that will be applied to messages before sending or drawing them
Tools.messages.hooks = [resizeCanvas, updateUnreadCount, notifyToolsOfMessage];

/**
 * @template T
 * @param {((value: T) => void)[]} hooks
 * @param {T} object
 * @returns {void}
 */
function applyHooks(hooks, object) {
  //Apply every hooks on the object
  hooks.forEach((hook) => {
    hook(object);
  });
}

// Utility functions

/**
 * @param {string | undefined} prefix
 * @param {string | undefined} suffix
 */
function generateUID(prefix, suffix) {
  let uid = Date.now().toString(36); //Create the uids in chronological order
  uid += Math.round(Math.random() * 36).toString(36); //Add a random character at the end
  if (prefix) uid = prefix + uid;
  if (suffix) uid = uid + suffix;
  return uid;
}

Tools.ids = { generateUID };

/**
 * @param {string} name
 * @param {{[key: string]: string | number | undefined} | undefined} attrs
 * @returns {SVGElement}
 */
function createSVGElement(name, attrs) {
  const dom = getAttachedBoardDom();
  if (!dom) {
    throw new Error("Board SVG is not attached.");
  }
  const elem = /** @type {SVGElement} */ (
    document.createElementNS(dom.svg.namespaceURI, name)
  );
  if (!attrs) return elem;
  Object.keys(attrs).forEach((key) => {
    elem.setAttributeNS(null, key, String(attrs[key]));
  });
  return elem;
}

/**
 * @param {HTMLElement} elem
 * @param {number} x
 * @param {number} y
 */
function positionElement(elem, x, y) {
  elem.style.top = `${y}px`;
  elem.style.left = `${x}px`;
}

const colorPresets = [
  { color: "#001f3f", key: "1" },
  { color: "#FF4136", key: "2" },
  { color: "#0074D9", key: "3" },
  { color: "#FF851B", key: "4" },
  { color: "#FFDC00", key: "5" },
  { color: "#3D9970", key: "6" },
  { color: "#91E99B", key: "7" },
  { color: "#90468b", key: "8" },
  { color: "#7FDBFF", key: "9" },
  { color: "#AAAAAA", key: "0" },
  { color: "#E65194" },
];
/** @param {string} color */
function setColor(color) {
  Tools.preferences.currentColor = color;
  if (Tools.preferences.colorChooser) {
    Tools.preferences.colorChooser.value = color;
  }
  Tools.preferences.colorChangeHandlers.forEach((handler) => {
    handler(color);
  });
}

function getColor() {
  return Tools.preferences.currentColor;
}

/**
 * @param {number | string | null | undefined} value
 * @returns {number}
 */
function setSize(value) {
  if (value !== null && value !== undefined) {
    Tools.preferences.currentSize = MessageCommon.clampSize(value);
  }
  const chooser = document.getElementById("chooseSize");
  if (chooser instanceof HTMLInputElement) {
    chooser.value = String(Tools.preferences.currentSize);
  }
  Tools.preferences.sizeChangeHandlers.forEach((handler) => {
    handler(Tools.preferences.currentSize);
  });
  return Tools.preferences.currentSize;
}

function getSize() {
  return Tools.preferences.currentSize;
}

function getOpacity() {
  return Tools.preferences.currentOpacity;
}

/** @type {SocketHeaders | null} */
let socketIOExtraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
  window.socketio_extra_headers,
);
if (!socketIOExtraHeaders) {
  try {
    const storedHeaders = sessionStorage.getItem("socketio_extra_headers");
    if (storedHeaders) {
      socketIOExtraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
        JSON.parse(storedHeaders),
      );
    }
  } catch (err) {
    logBoardEvent("warn", "boot.socket_headers_load_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
if (socketIOExtraHeaders) {
  window.socketio_extra_headers = socketIOExtraHeaders;
}
const colorIndex = (Math.random() * colorPresets.length) | 0;
const initialPreset = colorPresets[colorIndex] || colorPresets[0];
Tools.config = {
  serverConfig: /** @type {ServerConfig} */ (
    parseEmbeddedJson("configuration", {})
  ),
};
Tools.identity = {
  boardName: resolveBoardName(window.location.pathname),
  token: new URL(window.location.href).searchParams.get("token"),
};
Tools.connection.socketIOExtraHeaders = socketIOExtraHeaders;
const initialPreferences = {
  tool: "hand",
  color: initialPreset?.color || "#001f3f",
  size: DEFAULT_INITIAL_SIZE,
  opacity: DEFAULT_INITIAL_OPACITY,
};
Tools.preferences = {
  colorPresets,
  colorChooser: null,
  colorButtonsInitialized: false,
  currentColor: initialPreferences.color,
  currentSize: MessageCommon.clampSize(initialPreferences.size),
  currentOpacity: MessageCommon.clampOpacity(initialPreferences.opacity),
  initial: initialPreferences,
  colorChangeHandlers: [],
  sizeChangeHandlers: [],
  getColor,
  setColor,
  getSize,
  setSize,
  getOpacity,
};
Tools.setBoardState(
  parseEmbeddedJson("board-state", {
    readonly: false,
    canWrite: true,
  }),
);
Tools.presence.initConnectedUsersUI();
initializeShellControls();

/**
 What does a "tool" object look like?
 newtool = {
	  "name" : "SuperTool",
	  "listeners" : {
			"press" : function(x,y,evt){...},
			"move" : function(x,y,evt){...},
			"release" : function(x,y,evt){...},
	  },
	  "draw" : function(data, isLocal){
			//Print the data on the board SVG
	  },
	  "onstart" : function(oldTool){...},
	  "onquit" : function(newTool){...},
	  "stylesheet" : "style.css",
}
*/

(() => {
  let pos = { top: 0, scroll: 0 };
  const menu = getRequiredElement("menu");
  /** @param {MouseEvent} evt */
  function menu_mousedown(evt) {
    pos = {
      top: menu.scrollTop,
      scroll: evt.clientY,
    };
    menu.addEventListener("mousemove", menu_mousemove);
    document.addEventListener("mouseup", menu_mouseup);
  }
  /** @param {MouseEvent} evt */
  function menu_mousemove(evt) {
    const dy = evt.clientY - pos.scroll;
    menu.scrollTop = pos.top - dy;
  }
  function menu_mouseup() {
    menu.removeEventListener("mousemove", menu_mousemove);
    document.removeEventListener("mouseup", menu_mouseup);
  }
  menu.addEventListener("mousedown", menu_mousedown);
})();
