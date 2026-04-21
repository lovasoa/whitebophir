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
import {
  buildBoardSvgBaselineUrl,
  parseServedBaselineSvgText,
} from "./board_svg_baseline.js";
import {
  connection as BoardConnection,
  messages as BoardMessages,
  turnstile as BoardTurnstile,
} from "./board_transport.js";
import MessageCommon from "./message_common.js";
import { getMutationType, MutationType } from "./message_tool_metadata.js";
import {
  hasMessageId,
  hasMessageNewId,
  isTextUpdateMessage,
} from "./message_shape.js";
import Minitpl from "./minitpl.js";
import { createOptimisticJournal } from "./optimistic_journal.js";
import {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} from "./optimistic_mutation.js";
import RateLimitCommon from "./rate_limit_common.js";
import {
  getToolModuleImportPath,
  getToolRuntimeAssetPath,
} from "./tool_assets.js";

/** @typedef {import("../../types/app-runtime").AppBoardState} AppBoardState */
/** @typedef {import("../../types/app-runtime").AppTool} AppTool */
/** @typedef {import("../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../types/app-runtime").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime").BufferedWrite} BufferedWrite */
/** @typedef {import("../../types/app-runtime").BoardStatusView} BoardStatusView */
/** @typedef {import("../../types/app-runtime").ColorPreset} ColorPreset */
/** @typedef {import("../../types/app-runtime").ConfiguredRateLimitDefinition} ConfiguredRateLimitDefinition */
/** @typedef {import("../../types/app-runtime").ConnectedUser} ConnectedUser */
/** @typedef {import("../../types/app-runtime").PendingMessages} PendingMessages */
/** @typedef {import("../../types/app-runtime").PendingWrite} PendingWrite */
/** @typedef {import("../../types/app-runtime").RateLimitKind} RateLimitKind */
/** @typedef {import("../../types/app-runtime").ServerConfig} ServerConfig */
/** @typedef {import("../../types/app-runtime").CompiledToolListener} CompiledToolListener */
/** @typedef {import("../../types/app-runtime").CompiledToolListeners} CompiledToolListeners */
/** @typedef {import("../../types/app-runtime").MountedAppTool} MountedAppTool */
/** @typedef {import("../../types/app-runtime").ToolPointerListener} ToolPointerListener */
/** @typedef {import("../../types/app-runtime").ToolPointerListeners} ToolPointerListeners */
/** @typedef {import("../../types/app-runtime").ToolClass} ToolClass */
/** @typedef {import("../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {import("../../types/app-runtime").ToolRuntime} ToolRuntime */
/** @typedef {import("../../types/app-runtime").SocketHeaders} SocketHeaders */
/** @typedef {import("../../types/app-runtime").BoardConnectionState} BoardConnectionState */
/** @typedef {import("../../types/app-runtime").OptimisticJournalEntry} OptimisticJournalEntry */
/** @typedef {HTMLLIElement} ConnectedUserRow */
const Tools = /** @type {AppToolsState} */ ({});
window.Tools = Tools;
// Keep a bounded safety margin between the client-side local budget and the
// server's fixed window to absorb emit/receive skew. The buffer must be large
// enough that a queued write does not reconnect-loop under load by landing just
// before the server window resets.
const RATE_LIMIT_FLUSH_SAFETY_MIN_MS = 250;
const RATE_LIMIT_FLUSH_SAFETY_MAX_MS = 1500;
/** @type {RateLimitKind[]} */
const RATE_LIMIT_KINDS = ["general", "constructive", "destructive"];
const DEFAULT_BOARD_SCALE = 0.1;
const MIN_BOARD_SCALE = 0.01;
const MAX_BOARD_SCALE = 1;
const VIEWPORT_HASH_SCALE_DECIMALS = 2;
const RESIZE_CANVAS_MARGIN = 20000;
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
  Tools.board = boardElement;
  Tools.svg = canvasElement;
  Tools.drawingArea = baseline.drawingArea;
  Tools.authoritativeSeq = baseline.authoritativeSeq;
  Tools.svg.width.baseVal.value = Math.max(
    Tools.svg.width.baseVal.value,
    document.body.clientWidth,
  );
  Tools.svg.height.baseVal.value = Math.max(
    Tools.svg.height.baseVal.value,
    document.body.clientHeight,
  );
  normalizeServerRenderedElements();
  Tools.tryStartReplaySync();
}

/**
 * @param {unknown} value
 * @returns {value is ToolClass}
 */
function isToolClass(value) {
  return !!(
    value &&
    typeof value === "function" &&
    "toolName" in value &&
    typeof value.toolName === "string" &&
    "boot" in value &&
    typeof value.boot === "function"
  );
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

Tools.server_config = /** @type {ServerConfig} */ ({});
Tools.assetVersion = document.documentElement.dataset.version || "";

/**
 * @param {unknown} value
 * @returns {number}
 */
Tools.toBoardCoordinate = function toBoardCoordinate(value) {
  return MessageCommon.clampCoord(value, Tools.server_config.MAX_BOARD_SIZE);
};

/**
 * @param {unknown} value
 * @returns {number}
 */
Tools.pageCoordinateToBoard = function pageCoordinateToBoard(value) {
  const screenCoordinate = Number(value);
  if (!Number.isFinite(screenCoordinate)) return 0;
  return Tools.toBoardCoordinate(screenCoordinate / Tools.getScale());
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
Tools.versionAssetPath = function versionAssetPath(assetPath) {
  const normalizedPath = normalizeBoardAssetPath(assetPath);
  if (!Tools.assetVersion) return normalizedPath;
  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `${normalizedPath}${separator}v=${encodeURIComponent(Tools.assetVersion)}`;
};

/**
 * @param {string} toolName
 * @param {string} assetFile
 * @returns {string}
 */
Tools.getToolAssetUrl = function getToolAssetUrl(toolName, assetFile) {
  return Tools.versionAssetPath(getToolRuntimeAssetPath(toolName, assetFile));
};

Tools.readOnlyToolNames = new Set(["Hand", "Grid", "Download", "Zoom"]);
Tools.toolClasses = /** @type {AppToolsState["toolClasses"]} */ ({});
Tools.bootedToolPromises =
  /** @type {AppToolsState["bootedToolPromises"]} */ ({});
Tools.bootedToolNames = new Set();
Tools.turnstileValidatedUntil = 0;
Tools.turnstileWidgetId = null;
Tools.turnstileRefreshTimeout = null;
Tools.turnstilePending = false;
Tools.turnstilePendingWrites = [];
Tools.bufferedWrites = [];
Tools.bufferedWriteTimer = null;
Tools.writeReadyWaiters = /** @type {Array<() => void>} */ ([]);
Tools.rateLimitedUntil = 0;
Tools.rateLimitNoticeTimer = null;
Tools.rateLimitNoticeMessage = "";
Tools.awaitingBoardSnapshot = true;
Tools.awaitingSyncReplay = false;
Tools.hasAuthoritativeBoardSnapshot = false;
Tools.authoritativeSeq = 0;
Tools.optimisticJournal = createOptimisticJournal();
Tools.preSnapshotMessages = [];
Tools.incomingBroadcastQueue = [];
Tools.processingIncomingBroadcast = false;
Tools.connectionState = /** @type {BoardConnectionState} */ ("idle");
Tools.localRateLimitStates = {
  general: RateLimitCommon.createRateLimitState(Date.now()),
  constructive: RateLimitCommon.createRateLimitState(Date.now()),
  destructive: RateLimitCommon.createRateLimitState(Date.now()),
};

/** @param {BoardMessage} message */
Tools.cloneMessage = function cloneMessage(message) {
  if (typeof structuredClone === "function") return structuredClone(message);
  return /** @type {BoardMessage} */ (JSON.parse(JSON.stringify(message)));
};

function initializeShellControls() {
  const colorChooser = getRequiredInput("chooseColor");
  const sizeChooser = getRequiredInput("chooseSize");
  const opacityChooser = getRequiredInput("chooseOpacity");
  const opacityIndicator = getRequiredElement("opacityIndicator");
  const opacityIndicatorFill =
    document.getElementById("opacityIndicatorFill") || opacityIndicator;

  Tools.color_chooser = colorChooser;
  colorChooser.value = Tools.currentColor;
  colorChooser.onchange = colorChooser.oninput = () => {
    Tools.setColor(colorChooser.value);
  };

  sizeChooser.value = String(Tools.currentSize);
  sizeChooser.onchange = sizeChooser.oninput = () => {
    Tools.setSize(sizeChooser.value);
  };

  const updateOpacity = () => {
    Tools.currentOpacity = MessageCommon.clampOpacity(opacityChooser.value);
    opacityChooser.value = String(Tools.currentOpacity);
    opacityIndicatorFill.setAttribute("opacity", String(Tools.currentOpacity));
  };
  Tools.colorChangeHandlers.push(
    /** @param {string} color */ (color) => {
      opacityIndicatorFill.setAttribute("fill", color);
    },
  );
  opacityChooser.value = String(Tools.currentOpacity);
  updateOpacity();
  opacityChooser.onchange = opacityChooser.oninput = updateOpacity;

  if (!Tools.colorButtonsInitialized) {
    Tools.colorButtonsInitialized = true;
    Tools.colorPresets.forEach(addColorButton);
  }
  Tools.setColor(Tools.currentColor);
  Tools.setSize(Tools.currentSize);
}

function getBoardStatusElements() {
  return {
    indicator: document.getElementById("boardStatusIndicator"),
    title: document.getElementById("boardStatusTitle"),
    notice: document.getElementById("boardStatusNotice"),
  };
}

/**
 * @param {RateLimitKind} kind
 * @returns {ConfiguredRateLimitDefinition}
 */
Tools.getRateLimitDefinition = function getRateLimitDefinition(kind) {
  const configured = Tools.server_config.RATE_LIMITS || {};
  if (configured && configured[kind]) return configured[kind];

  return {
    limit: 0,
    anonymousLimit: 0,
    periodMs: 0,
  };
};

/**
 * @param {RateLimitKind} kind
 * @returns {{limit: number, periodMs: number}}
 */
Tools.getEffectiveRateLimit = function getEffectiveRateLimit(kind) {
  return RateLimitCommon.getEffectiveRateLimitDefinition(
    Tools.getRateLimitDefinition(kind),
    Tools.boardName,
  );
};

/**
 * @param {BoardMessage} message
 * @returns {{general: number, constructive: number, destructive: number}}
 */
Tools.getBufferedWriteCosts = function getBufferedWriteCosts(message) {
  return {
    general: 1,
    constructive: RateLimitCommon.countConstructiveActions(message),
    destructive: RateLimitCommon.countDestructiveActions(message),
  };
};

Tools.clearBufferedWriteTimer = function clearBufferedWriteTimer() {
  if (Tools.bufferedWriteTimer) {
    clearTimeout(Tools.bufferedWriteTimer);
    Tools.bufferedWriteTimer = null;
  }
};

Tools.clearRateLimitNoticeTimer = function clearRateLimitNoticeTimer() {
  if (Tools.rateLimitNoticeTimer) {
    clearTimeout(Tools.rateLimitNoticeTimer);
    Tools.rateLimitNoticeTimer = null;
  }
};

/**
 * @param {number} [now]
 * @returns {boolean}
 */
Tools.isWritePaused = function isWritePaused(now) {
  return Tools.rateLimitedUntil > (now || Date.now());
};

Tools.canBufferWrites = function canBufferWrites() {
  return !!(
    Tools.socket &&
    Tools.socket.connected &&
    !Tools.awaitingBoardSnapshot &&
    !Tools.isWritePaused()
  );
};

Tools.whenBoardWritable = function whenBoardWritable() {
  if (Tools.canBufferWrites()) return Promise.resolve();
  return new Promise(
    /** @param {(value?: void | PromiseLike<void>) => void} resolve */ (
      resolve,
    ) => {
      Tools.writeReadyWaiters.push(() => resolve());
    },
  );
};

/**
 * @param {string} message
 * @param {number} retryAfterMs
 * @returns {void}
 */
Tools.showRateLimitNotice = function showRateLimitNotice(
  message,
  retryAfterMs,
) {
  Tools.rateLimitNoticeMessage = message;
  Tools.syncWriteStatusIndicator();
  Tools.clearRateLimitNoticeTimer();
  if (retryAfterMs > 0) {
    Tools.rateLimitNoticeTimer = setTimeout(function hideRateLimitNotice() {
      Tools.hideRateLimitNotice();
    }, retryAfterMs);
  }
};

Tools.hideRateLimitNotice = function hideRateLimitNotice() {
  Tools.clearRateLimitNoticeTimer();
  Tools.rateLimitNoticeMessage = "";
  Tools.syncWriteStatusIndicator();
};

/** @returns {BoardStatusView} */
Tools.getBoardStatusView = function getBoardStatusView() {
  if (Tools.rateLimitNoticeMessage) {
    return {
      hidden: false,
      state: "paused",
      title: Tools.i18n.t("slow_down_briefly"),
      detail: Tools.rateLimitNoticeMessage,
    };
  }
  if (Tools.connectionState !== "connected" || Tools.awaitingBoardSnapshot) {
    return {
      hidden: false,
      state: "reconnecting",
      title: Tools.i18n.t("loading"),
      detail: "",
    };
  }
  if (Tools.bufferedWrites.length > 0) {
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
};

Tools.syncWriteStatusIndicator = function syncWriteStatusIndicator() {
  if (Tools.canBufferWrites() && Tools.writeReadyWaiters.length > 0) {
    const waiters = Tools.writeReadyWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }
  const { indicator, title, notice } = getBoardStatusElements();
  if (!indicator || !title || !notice) return;

  const view = Tools.getBoardStatusView();
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
};

Tools.clearBoardCursors = function clearBoardCursors() {
  if (!Tools.svg) return;
  const cursors = Tools.svg.getElementById("cursors");
  if (cursors) cursors.innerHTML = "";
};

Tools.resetBoardViewport = function resetBoardViewport() {
  if (Tools.drawingArea) Tools.drawingArea.innerHTML = "";
  Tools.clearBoardCursors();
};

Tools.restoreLocalCursor = function restoreLocalCursor() {
  const cursorTool = Tools.list.Cursor;
  if (!cursorTool) return;
  const message =
    "message" in cursorTool && cursorTool.message
      ? /** @type {BoardMessage} */ (cursorTool.message)
      : null;
  if (!message) return;
  cursorTool.draw(message, true);
};

/**
 * @param {BoardMessage} message
 * @returns {{kind: "drawing-area", markup: string} | {kind: "items", snapshots: Array<{id: string, outerHTML: string | null, nextSiblingId: string | null}>}}
 */
Tools.captureOptimisticRollback = function captureOptimisticRollback(message) {
  if (getMutationType(message) === MutationType.CLEAR) {
    return {
      kind: "drawing-area",
      markup: Tools.drawingArea?.innerHTML || "",
    };
  }
  return {
    kind: "items",
    snapshots: collectOptimisticAffectedIds(message).map((itemId) => {
      const svg = Tools.svg;
      if (!svg) {
        return {
          id: itemId,
          outerHTML: null,
          nextSiblingId: null,
        };
      }
      const current = svg.getElementById(itemId);
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
};

/**
 * @param {BoardMessage} message
 * @returns {string[]}
 */
Tools.collectOptimisticDependencyMutationIds =
  function collectOptimisticDependencyMutationIds(message) {
    return Tools.optimisticJournal.dependencyMutationIdsForItemIds(
      collectOptimisticDependencyIds(message),
    );
  };

/**
 * @param {BoardMessage} message
 * @param {{kind: "drawing-area", markup: string} | {kind: "items", snapshots: Array<{id: string, outerHTML: string | null, nextSiblingId: string | null}>}} rollback
 * @returns {void}
 */
Tools.trackOptimisticMutation = function trackOptimisticMutation(
  message,
  rollback,
) {
  if (typeof message.clientMutationId !== "string" || !message.clientMutationId)
    return;
  Tools.optimisticJournal.append({
    clientMutationId: message.clientMutationId,
    affectedIds: collectOptimisticAffectedIds(message),
    dependsOn: Tools.collectOptimisticDependencyMutationIds(message),
    dependencyItemIds: collectOptimisticDependencyIds(message),
    rollback,
    message,
  });
};

/**
 * @param {OptimisticJournalEntry[]} rejected
 * @returns {void}
 */
Tools.applyRejectedOptimisticEntries = function applyRejectedOptimisticEntries(
  rejected,
) {
  if (!Array.isArray(rejected) || rejected.length === 0) return;
  rejected
    .slice()
    .reverse()
    .forEach((entry) => {
      Tools.restoreOptimisticRollback(entry.rollback);
    });
  Tools.restoreLocalCursor();
};

/**
 * @param {{kind: "drawing-area", markup: string} | {kind: "items", snapshots: Array<{id: string, outerHTML: string | null, nextSiblingId: string | null}>}} rollback
 * @returns {void}
 */
Tools.restoreOptimisticRollback = function restoreOptimisticRollback(rollback) {
  if (!Tools.drawingArea) return;
  if (rollback.kind === "drawing-area") {
    Tools.drawingArea.innerHTML = rollback.markup;
    return;
  }
  rollback.snapshots.forEach((snapshot) => {
    const svg = Tools.svg;
    if (!svg) return;
    const current = svg.getElementById(snapshot.id);
    if (snapshot.outerHTML === null) {
      current?.remove();
      return;
    }
    if (current) {
      current.outerHTML = snapshot.outerHTML;
      return;
    }
    const nextSibling = snapshot.nextSiblingId
      ? svg.getElementById(snapshot.nextSiblingId)
      : null;
    if (nextSibling?.parentElement === Tools.drawingArea) {
      nextSibling.insertAdjacentHTML("beforebegin", snapshot.outerHTML);
    } else {
      const drawingArea = Tools.drawingArea;
      if (!drawingArea) return;
      drawingArea.insertAdjacentHTML("beforeend", snapshot.outerHTML);
    }
  });
};

/**
 * @param {string} clientMutationId
 * @returns {void}
 */
Tools.promoteOptimisticMutation = function promoteOptimisticMutation(
  clientMutationId,
) {
  if (Tools.optimisticJournal.promote(clientMutationId).length === 0) return;
};

/**
 * @param {string} clientMutationId
 * @returns {void}
 */
Tools.rejectOptimisticMutation = function rejectOptimisticMutation(
  clientMutationId,
) {
  Tools.applyRejectedOptimisticEntries(
    Tools.optimisticJournal.reject(clientMutationId),
  );
};

/**
 * @param {BoardMessage} message
 * @returns {void}
 */
Tools.pruneOptimisticMutationsForAuthoritativeMessage =
  function pruneOptimisticMutationsForAuthoritativeMessage(message) {
    const prunePlan = optimisticPrunePlanForAuthoritativeMessage(message);
    if (prunePlan.reset) {
      Tools.applyRejectedOptimisticEntries(Tools.optimisticJournal.reset());
      return;
    }
    if (prunePlan.invalidatedIds.length === 0) {
      return;
    }
    Tools.applyRejectedOptimisticEntries(
      Tools.optimisticJournal.rejectByInvalidatedIds(prunePlan.invalidatedIds),
    );
  };

Tools.applyAuthoritativeBaseline =
  /**
   * @param {import("../../types/app-runtime").AuthoritativeBaseline} baseline
   */
  function applyAuthoritativeBaseline(baseline) {
    const svg = Tools.svg;
    if (!svg) return;
    Tools.hasAuthoritativeBoardSnapshot = true;
    Tools.authoritativeSeq = baseline.seq;
    Tools.optimisticJournal.reset();
    svg.setAttribute("data-wbo-seq", String(baseline.seq));
    svg.setAttribute("data-wbo-readonly", baseline.readonly ? "true" : "false");
    if (Tools.drawingArea) {
      Tools.drawingArea.innerHTML = baseline.drawingAreaMarkup;
      normalizeServerRenderedElements();
    }
  };

/**
 * @param {AppTool} tool
 * @returns {void}
 */
function normalizeServerRenderedElementsForTool(tool) {
  if (!Tools.drawingArea) return;
  const selector = tool.serverRenderedElementSelector;
  const normalizeElement = tool.normalizeServerRenderedElement;
  if (!selector || typeof normalizeElement !== "function") return;

  Tools.drawingArea.querySelectorAll(selector).forEach((element) => {
    if (element instanceof SVGElement) {
      normalizeElement.call(tool, element);
    }
  });
}

function normalizeServerRenderedElements() {
  Object.values(Tools.list).forEach((tool) => {
    normalizeServerRenderedElementsForTool(tool);
  });
}

Tools.refreshAuthoritativeBaseline =
  async function refreshAuthoritativeBaseline() {
    const response = await fetch(
      buildBoardSvgBaselineUrl(
        window.location.pathname,
        window.location.search,
      ),
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "image/svg+xml" },
      },
    );
    if (!response.ok) {
      throw new Error(`Baseline fetch failed with HTTP ${response.status}`);
    }
    const baseline = parseServedBaselineSvgText(
      await response.text(),
      new DOMParser(),
    );
    Tools.applyAuthoritativeBaseline(baseline);
  };

/**
 * @param {RateLimitKind} kind
 * @param {number} [now]
 * @returns {void}
 */
Tools.resetLocalRateLimitState = function resetLocalRateLimitState(kind, now) {
  Tools.localRateLimitStates[kind] = RateLimitCommon.createRateLimitState(
    now || Date.now(),
  );
};

/** @param {number} [now] */
Tools.resetAllLocalRateLimitStates = function resetAllLocalRateLimitStates(
  now,
) {
  Tools.resetLocalRateLimitState("general", now);
  Tools.resetLocalRateLimitState("constructive", now);
  Tools.resetLocalRateLimitState("destructive", now);
};

/**
 * @param {BufferedWrite} bufferedWrite
 * @param {number} now
 * @returns {boolean}
 */
Tools.canEmitBufferedWrite = function canEmitBufferedWrite(bufferedWrite, now) {
  return RATE_LIMIT_KINDS.every((kind) => {
    const cost = bufferedWrite.costs[kind];
    if (!(cost > 0)) return true;
    const definition = Tools.getEffectiveRateLimit(kind);
    if (!(definition.periodMs > 0) || !(definition.limit >= 0)) return true;
    return RateLimitCommon.canConsumeFixedWindowRateLimit(
      Tools.localRateLimitStates[kind],
      cost,
      definition.limit,
      definition.periodMs,
      now,
    );
  });
};

/**
 * @param {BufferedWrite} bufferedWrite
 * @param {number} now
 * @returns {void}
 */
Tools.consumeBufferedWriteBudget = function consumeBufferedWriteBudget(
  bufferedWrite,
  now,
) {
  RATE_LIMIT_KINDS.forEach((kind) => {
    const cost = bufferedWrite.costs[kind];
    if (!(cost > 0)) return;
    const definition = Tools.getEffectiveRateLimit(kind);
    if (!(definition.periodMs > 0)) return;
    Tools.localRateLimitStates[kind] =
      RateLimitCommon.consumeFixedWindowRateLimit(
        Tools.localRateLimitStates[kind],
        cost,
        definition.periodMs,
        now,
      );
  });
};

/**
 * @param {BufferedWrite} bufferedWrite
 * @param {number} now
 * @returns {number}
 */
Tools.getBufferedWriteWaitMs = function getBufferedWriteWaitMs(
  bufferedWrite,
  now,
) {
  return RATE_LIMIT_KINDS.reduce((waitMs, kind) => {
    const cost = bufferedWrite.costs[kind];
    if (!(cost > 0)) return waitMs;
    const definition = Tools.getEffectiveRateLimit(kind);
    if (!(definition.periodMs > 0)) return waitMs;
    if (
      RateLimitCommon.canConsumeFixedWindowRateLimit(
        Tools.localRateLimitStates[kind],
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
        Tools.localRateLimitStates[kind],
        definition.periodMs,
        now,
      ),
    );
  }, 0);
};

/**
 * @param {number} waitMs
 * @returns {number}
 */
Tools.getBufferedWriteFlushSafetyMs = function getBufferedWriteFlushSafetyMs(
  waitMs,
) {
  return Math.min(
    RATE_LIMIT_FLUSH_SAFETY_MAX_MS,
    Math.max(RATE_LIMIT_FLUSH_SAFETY_MIN_MS, Math.ceil(Math.max(0, waitMs))),
  );
};

/** @returns {void} */
Tools.scheduleBufferedWriteFlush = function scheduleBufferedWriteFlush() {
  Tools.clearBufferedWriteTimer();
  if (!Tools.bufferedWrites.length || !Tools.canBufferWrites()) {
    Tools.syncWriteStatusIndicator();
    return;
  }
  const nextWrite = Tools.bufferedWrites[0];
  if (!nextWrite) return;
  const now = Date.now();
  const waitMs = Tools.getBufferedWriteWaitMs(nextWrite, now);
  Tools.bufferedWriteTimer = setTimeout(
    function flushBufferedWrites() {
      Tools.flushBufferedWrites();
    },
    Math.max(0, waitMs + Tools.getBufferedWriteFlushSafetyMs(waitMs)),
  );
  Tools.syncWriteStatusIndicator();
};

/** @returns {void} */
Tools.flushBufferedWrites = function flushBufferedWrites() {
  Tools.clearBufferedWriteTimer();
  if (!Tools.canBufferWrites()) {
    Tools.syncWriteStatusIndicator();
    return;
  }
  while (Tools.bufferedWrites.length > 0) {
    const bufferedWrite = Tools.bufferedWrites[0];
    if (!bufferedWrite) break;
    const now = Date.now();
    if (!Tools.canEmitBufferedWrite(bufferedWrite, now)) {
      Tools.scheduleBufferedWriteFlush();
      return;
    }
    Tools.bufferedWrites.shift();
    Tools.consumeBufferedWriteBudget(bufferedWrite, now);
    Tools.updateCurrentConnectedUserFromActivity(bufferedWrite.message);
    if (Tools.socket) Tools.socket.emit("broadcast", bufferedWrite.message);
  }
  Tools.syncWriteStatusIndicator();
};

/**
 * @param {BoardMessage} message
 * @returns {void}
 */
Tools.enqueueBufferedWrite = function enqueueBufferedWrite(message) {
  Tools.bufferedWrites.push({
    message: message,
    costs: Tools.getBufferedWriteCosts(message),
  });
  Tools.scheduleBufferedWriteFlush();
};

/**
 * @param {BoardMessage} message
 * @returns {boolean}
 */
Tools.sendBufferedWrite = function sendBufferedWrite(message) {
  /** @type {BufferedWrite} */
  const bufferedWrite = {
    message: message,
    costs: Tools.getBufferedWriteCosts(message),
  };
  if (!Tools.canBufferWrites()) {
    return false;
  }
  const now = Date.now();
  if (
    Tools.bufferedWrites.length === 0 &&
    Tools.canEmitBufferedWrite(bufferedWrite, now)
  ) {
    Tools.consumeBufferedWriteBudget(bufferedWrite, now);
    Tools.updateCurrentConnectedUserFromActivity(message);
    if (Tools.socket) Tools.socket.emit("broadcast", message);
    Tools.syncWriteStatusIndicator();
    return true;
  }
  Tools.bufferedWrites.push(bufferedWrite);
  Tools.scheduleBufferedWriteFlush();
  return true;
};

Tools.discardBufferedWrites = function discardBufferedWrites() {
  Tools.bufferedWrites = [];
  Tools.clearBufferedWriteTimer();
  Tools.syncWriteStatusIndicator();
};

Tools.beginAuthoritativeResync = function beginAuthoritativeResync() {
  Tools.awaitingBoardSnapshot = true;
  Tools.awaitingSyncReplay = true;
  Tools.optimisticJournal.reset();
  Tools.preSnapshotMessages = [];
  Tools.incomingBroadcastQueue = [];
  Tools.processingIncomingBroadcast = false;
  Tools.discardBufferedWrites();
  Tools.turnstilePendingWrites = [];
  Tools.hideTurnstileOverlay();
  Object.values(getConnectedUsers()).forEach((user) => {
    if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  });
  Tools.connectedUsers = /** @type {AppToolsState["connectedUsers"]} */ ({});
  Tools.renderConnectedUsers();
  Tools.clearBoardCursors();
  Object.values(Tools.list || {}).forEach((tool) => {
    if (tool) tool.onSocketDisconnect();
  });
  Tools.syncWriteStatusIndicator();
};

/**
 * @param {BoardMessage} data
 * @param {AppTool} tool
 */
Tools.queueProtectedWrite = function queueProtectedWrite(data, tool) {
  Tools.turnstilePendingWrites.push({
    data: Tools.cloneMessage(data),
    toolName: tool.name,
  });
  Tools.showTurnstileWidget();
};

Tools.flushTurnstilePendingWrites = function flushTurnstilePendingWrites() {
  const pendingWrites = Tools.turnstilePendingWrites;
  Tools.turnstilePendingWrites = [];
  pendingWrites.forEach(function replayPendingWrite(write) {
    const pendingWrite = /** @type {PendingWrite} */ (write);
    if (!pendingWrite.toolName || !pendingWrite.data) return;
    const tool = Tools.list[pendingWrite.toolName];
    if (!tool) return;
    Tools.send(pendingWrite.data, pendingWrite.toolName);
  });
};

/**
 * @param {BoardMessage} msg
 * @param {boolean} processed
 * @returns {void}
 */
function finalizeIncomingBroadcast(msg, processed) {
  const activityMessage = /** @type {BoardMessage} */ (
    BoardMessageReplay.unwrapReplayMessage(msg)
  );
  if (processed) {
    Tools.updateConnectedUsersFromActivity(
      activityMessage.userId,
      activityMessage,
    );
  }
  Tools.syncWriteStatusIndicator();
}

/**
 * @param {BoardMessage} msg
 * @returns {Promise<boolean>}
 */
async function processIncomingBroadcast(msg) {
  const isPersistentEnvelope = BoardMessageReplay.isPersistentEnvelope(msg);
  if (isPersistentEnvelope) {
    const seqDisposition = BoardMessageReplay.classifyPersistentEnvelopeSeq(
      msg.seq,
      Tools.authoritativeSeq,
    );
    if (seqDisposition === "stale") {
      return false;
    }
    if (seqDisposition !== "next") {
      console.warn("Persistent replay gap detected", {
        authoritativeSeq: Tools.authoritativeSeq,
        incomingSeq: msg.seq,
      });
      Tools.beginAuthoritativeResync();
      Tools.startConnection();
      return false;
    }
  }
  if (
    BoardMessageReplay.shouldBufferLiveMessage(msg, Tools.awaitingBoardSnapshot)
  ) {
    Tools.preSnapshotMessages.push(Tools.cloneMessage(msg));
    return false;
  }
  const replayMessage = /** @type {BoardMessage} */ (
    BoardMessageReplay.unwrapReplayMessage(msg)
  );
  const isOwnSeqEnvelope =
    isPersistentEnvelope && replayMessage.socket === Tools.socket?.id;
  if (
    isOwnSeqEnvelope &&
    typeof replayMessage.clientMutationId === "string" &&
    replayMessage.clientMutationId
  ) {
    Tools.promoteOptimisticMutation(replayMessage.clientMutationId);
  }
  if (isPersistentEnvelope && !isOwnSeqEnvelope) {
    Tools.pruneOptimisticMutationsForAuthoritativeMessage(replayMessage);
  }
  if (!isOwnSeqEnvelope) {
    await handleMessage(replayMessage);
  }
  if (isPersistentEnvelope) {
    Tools.authoritativeSeq = BoardMessageReplay.normalizeSeq(msg.seq);
  }
  return true;
}

async function drainIncomingBroadcastQueue() {
  if (Tools.processingIncomingBroadcast) return;
  Tools.processingIncomingBroadcast = true;
  try {
    while (true) {
      const msg = Tools.incomingBroadcastQueue.shift();
      if (!msg) return;
      const processed = await processIncomingBroadcast(msg);
      finalizeIncomingBroadcast(msg, processed);
    }
  } finally {
    Tools.processingIncomingBroadcast = false;
    if (Tools.incomingBroadcastQueue.length > 0) {
      void drainIncomingBroadcastQueue();
    }
  }
}

/**
 * @param {BoardMessage} msg
 * @returns {void}
 */
function enqueueIncomingBroadcast(msg) {
  Tools.incomingBroadcastQueue.push(msg);
  void drainIncomingBroadcastQueue();
}

Tools.scale = DEFAULT_BOARD_SCALE;
Tools.drawToolsAllowed = null;

if (Tools.server_config.TURNSTILE_SITE_KEY) {
  const script = document.createElement("script");
  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

Tools.isTurnstileValidated = function isTurnstileValidated() {
  return Tools.turnstileValidatedUntil > Date.now();
};

Tools.clearTurnstileRefreshTimeout = function clearTurnstileRefreshTimeout() {
  if (Tools.turnstileRefreshTimeout) {
    clearTimeout(Tools.turnstileRefreshTimeout);
    Tools.turnstileRefreshTimeout = null;
  }
};

/** @param {number} validationWindowMs */
Tools.scheduleTurnstileRefresh = function scheduleTurnstileRefresh(
  validationWindowMs,
) {
  if (!Tools.server_config.TURNSTILE_SITE_KEY || !(validationWindowMs > 0))
    return;
  Tools.clearTurnstileRefreshTimeout();
  const refreshDelay = Math.floor(validationWindowMs * 0.8);
  if (!(refreshDelay > 0)) return;
  Tools.turnstileRefreshTimeout = setTimeout(function refreshTurnstileToken() {
    Tools.refreshTurnstile();
  }, refreshDelay);
};

/** @param {unknown} result */
Tools.setTurnstileValidation = function setTurnstileValidation(result) {
  Tools.clearTurnstileRefreshTimeout();
  const ack = Tools.normalizeTurnstileAck(result);
  if (ack.success !== true) {
    Tools.turnstileValidatedUntil = 0;
    return;
  }

  const validation = BoardTurnstile.computeTurnstileValidation(
    ack,
    Number(Tools.server_config.TURNSTILE_VALIDATION_WINDOW_MS),
  );
  const validationWindowMs = validation.validationWindowMs;
  Tools.turnstileValidatedUntil = validation.validatedUntil;

  if (validationWindowMs > 0) {
    Tools.scheduleTurnstileRefresh(validationWindowMs);
  }
};

/** @param {unknown} result */
Tools.normalizeTurnstileAck = function normalizeTurnstileAck(result) {
  return BoardTurnstile.normalizeTurnstileAck(
    result,
    Number(Tools.server_config.TURNSTILE_VALIDATION_WINDOW_MS),
  );
};

Tools.ensureTurnstileElements = function ensureTurnstileElements() {
  let overlay = document.getElementById("turnstile-overlay");
  let widget = document.getElementById("turnstile-widget");
  if (overlay && widget) return { overlay: overlay };

  overlay = document.createElement("div");
  overlay.id = "turnstile-overlay";
  overlay.classList.add("turnstile-overlay-hidden");

  const modal = document.createElement("div");
  modal.id = "turnstile-modal";

  widget = document.createElement("div");
  widget.id = "turnstile-widget";
  modal.appendChild(widget);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  return { overlay: overlay };
};

Tools.showTurnstileOverlayTimeout = null;
const TURNSTILE_ACK_TIMEOUT_MS = 10_000;

/** @param {number} delay */
Tools.showTurnstileOverlay = function showTurnstileOverlay(delay) {
  const elements = Tools.ensureTurnstileElements();
  if (delay > 0) {
    Tools.showTurnstileOverlayTimeout = setTimeout(() => {
      elements.overlay.classList.remove("turnstile-overlay-hidden");
    }, delay);
  } else {
    elements.overlay.classList.remove("turnstile-overlay-hidden");
  }
};

Tools.hideTurnstileOverlay = function hideTurnstileOverlay() {
  if (Tools.showTurnstileOverlayTimeout) {
    clearTimeout(Tools.showTurnstileOverlayTimeout);
    Tools.showTurnstileOverlayTimeout = null;
  }
  const overlay = document.getElementById("turnstile-overlay");
  if (overlay) overlay.classList.add("turnstile-overlay-hidden");
};

/** @param {unknown} errorCode */
function handleTurnstileError(errorCode) {
  alert(`Turnstile verification failed: ${errorCode}`);
  location.reload();
}

/**
 * @param {string} token
 * @returns {Promise<unknown>}
 */
function emitTurnstileToken(token) {
  return new Promise((resolve, reject) => {
    const socket = Tools.socket;
    if (!socket) {
      reject(new Error("Socket unavailable while submitting Turnstile token."));
      return;
    }
    const timeoutId = setTimeout(() => {
      reject(new Error("Timed out waiting for Turnstile acknowledgement."));
    }, TURNSTILE_ACK_TIMEOUT_MS);

    try {
      socket.emit("turnstile_token", token, (/** @type {unknown} */ result) => {
        clearTimeout(timeoutId);
        resolve(result);
      });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

/**
 * @param {string} token
 * @returns {Promise<void>}
 */
async function submitTurnstileToken(token) {
  try {
    const result = await emitTurnstileToken(token);
    const turnstileResult = Tools.normalizeTurnstileAck(result);
    Tools.turnstilePending = false;
    if (turnstileResult.success) {
      Tools.setTurnstileValidation(turnstileResult);
      Tools.hideTurnstileOverlay();
      Tools.flushTurnstilePendingWrites();
      return;
    }
  } catch (error) {
    Tools.turnstilePending = false;
    Tools.setTurnstileValidation(null);
    console.error("Turnstile submission error:", error);
    Tools.refreshTurnstile();
    return;
  }

  Tools.setTurnstileValidation(null);
  Tools.refreshTurnstile();
}

Tools.refreshTurnstile = function refreshTurnstile() {
  if (!Tools.server_config.TURNSTILE_SITE_KEY) return;
  Tools.ensureTurnstileElements();

  if (typeof turnstile !== "undefined") {
    if (Tools.turnstilePending) return;

    if (Tools.turnstileWidgetId === null) {
      Tools.turnstilePending = true;
      Tools.turnstileWidgetId = turnstile.render("#turnstile-widget", {
        sitekey: Tools.server_config.TURNSTILE_SITE_KEY,
        appearance: "interaction-only",
        theme: "light",
        "refresh-expired": "manual",
        /** @param {string} token */
        callback: (token) => {
          if (!Tools.socket) return;
          void submitTurnstileToken(token);
        },
        "before-interactive-callback": () => {
          Tools.showTurnstileOverlay(500);
        },
        "after-interactive-callback": () => {
          if (Tools.isTurnstileValidated()) Tools.hideTurnstileOverlay();
        },
        "error-callback": (/** @type {unknown} */ err) => {
          Tools.turnstilePending = false;
          Tools.setTurnstileValidation(null);
          console.error("Turnstile error:", err);
          handleTurnstileError(err);
        },
        "timeout-callback": () => {
          Tools.turnstilePending = false;
          Tools.setTurnstileValidation(null);
          Tools.refreshTurnstile();
        },
        "expired-callback": () => {
          Tools.turnstilePending = false;
          Tools.refreshTurnstile();
        },
      });
      return;
    }

    Tools.turnstilePending = true;
    turnstile.reset(Tools.turnstileWidgetId);
  } else {
    console.error("Error loading Turnstile. Refreshing the page.");
    location.reload();
  }
};

/** @param {string} toolName */
Tools.shouldDisableTool = function shouldDisableTool(toolName) {
  return (
    MessageCommon.isDrawTool(toolName) &&
    !MessageCommon.isDrawToolAllowedAtScale(Tools.scale || DEFAULT_BOARD_SCALE)
  );
};

/** @param {string} toolName */
Tools.canUseTool = function canUseTool(toolName) {
  return (
    Tools.shouldDisplayTool(toolName) && !Tools.shouldDisableTool(toolName)
  );
};

/** @param {string} toolName */
Tools.syncToolDisabledState = function syncToolDisabledState(toolName) {
  const toolElem = document.getElementById(`toolID-${toolName}`);
  if (!toolElem) return;
  const disabled = Tools.shouldDisableTool(toolName);
  toolElem.classList.toggle("disabledTool", disabled);
  toolElem.setAttribute("aria-disabled", disabled ? "true" : "false");
};

/** @param {boolean} force */
Tools.syncDrawToolAvailability = function syncDrawToolAvailability(force) {
  const drawToolsAllowed = MessageCommon.isDrawToolAllowedAtScale(Tools.scale);
  if (!force && drawToolsAllowed === Tools.drawToolsAllowed) return;
  Tools.drawToolsAllowed = drawToolsAllowed;

  Object.keys(Tools.list || {}).forEach((toolName) => {
    Tools.syncToolDisabledState(toolName);
  });

  if (
    !drawToolsAllowed &&
    Tools.curTool &&
    MessageCommon.isDrawTool(Tools.curTool.name) &&
    Tools.list.Hand
  ) {
    Tools.change("Hand");
  }
};

Tools.showTurnstileWidget = function showTurnstileWidget() {
  Tools.refreshTurnstile();
};

/** @param {unknown} state */
Tools.setBoardState = function setBoardState(state) {
  Tools.boardState = /** @type {AppBoardState} */ (normalizeBoardState(state));
  Tools.readOnly = Tools.boardState.readonly;
  Tools.canWrite = Tools.boardState.canWrite;

  const hideEditingTools = Tools.readOnly && !Tools.canWrite;
  const settings = document.getElementById("settings");
  if (settings) settings.style.display = hideEditingTools ? "none" : "";

  Object.keys(Tools.list || {}).forEach((toolName) => {
    const toolElem = document.getElementById(`toolID-${toolName}`);
    if (!toolElem) return;
    toolElem.style.display = Tools.shouldDisplayTool(toolName) ? "" : "none";
  });

  Tools.syncDrawToolAvailability(true);

  if (
    hideEditingTools &&
    Tools.curTool &&
    !Tools.shouldDisplayTool(Tools.curTool.name) &&
    Tools.list.Hand
  ) {
    Tools.change("Hand");
  }
};

/** @param {string} toolName */
Tools.shouldDisplayTool = function shouldDisplayTool(toolName) {
  return getToolButton(toolName) !== null;
};

Tools.board = null;
Tools.svg = null;
Tools.drawingArea = null;

//Initialization
Tools.curTool = null;
document.documentElement.dataset.activeToolSecondary = "false";
Tools.drawingEvent = true;
Tools.showMarker = true;
Tools.showOtherCursors = true;
Tools.showMyCursor = true;

Tools.isIE = /MSIE|Trident/.test(window.navigator.userAgent);

Tools.socket = null;
Tools.hasConnectedOnce = false;

Tools.connectedUsers = /** @type {AppToolsState["connectedUsers"]} */ ({});
Tools.connectedUsersPanelOpen = false;

function isCurrentSocketUser(/** @type {ConnectedUser} */ user) {
  return !!(Tools.socket?.id && user.socketId === Tools.socket.id);
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
    Tools.connectedUsers
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
  return Tools.i18n.t(user.lastTool || "Hand");
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
 * @param {string} elementId
 * @returns {{x: number, y: number} | null}
 */
function getRenderedElementCenterById(elementId) {
  const element = document.getElementById(elementId);
  if (!(element instanceof SVGGraphicsElement)) return null;
  return getBoundsCenter(getRenderedElementBounds(element));
}

/**
 * @param {BoardMessage} child
 * @returns {string | null}
 */
function getHandChildTargetId(child) {
  switch (getMutationType(child)) {
    case MutationType.UPDATE:
      return hasMessageId(child) ? child.id : null;
    case MutationType.COPY:
      return hasMessageNewId(child) ? child.newid : null;
    default:
      return null;
  }
}

/**
 * @param {BoardMessage[]} children
 * @returns {{x: number, y: number} | null}
 */
function getHandBatchFocusPoint(children) {
  /** @type {{minX: number, minY: number, maxX: number, maxY: number} | null} */
  let bounds = null;
  children.forEach((child) => {
    const targetId = getHandChildTargetId(child);
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
    if (message.tool === "Hand" && Array.isArray(message._children)) {
      return getHandBatchFocusPoint(message._children);
    }
    return null;
  }

  if (message.tool === "Cursor" || message.tool === "Pencil") {
    const pointX = toFiniteCoordinate(message.x);
    const pointY = toFiniteCoordinate(message.y);
    if (pointX !== null && pointY !== null) {
      return { x: pointX, y: pointY };
    }
  }

  if (isTextUpdateMessage(message)) {
    return getRenderedElementCenterById(message.id);
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
  user.pulseTimeoutId = setTimeout(() => {
    if (user.pulseUntil && user.pulseUntil <= Date.now()) {
      user.pulseUntil = 0;
      user.pulseTimeoutId = null;
      Tools.renderConnectedUsers();
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
  const scale = Tools.getScale();
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
    if (!Tools.socket || !row.dataset.socketId) return;
    const connectedUser = getConnectedUsers()[row.dataset.socketId];
    if (!connectedUser || isCurrentSocketUser(connectedUser)) return;
    connectedUser.reported = true;
    updateConnectedUserRow(row, connectedUser);
    Tools.socket.emit("report_user", {
      socketId: connectedUser.socketId,
    });
  });
  row.appendChild(report);

  updateConnectedUserRow(row, user);
  return row;
}

Tools.renderConnectedUsers = function renderConnectedUsers() {
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
  if (users.length === 0 && Tools.connectedUsersPanelOpen) {
    Tools.setConnectedUsersPanelOpen(false);
  }
  syncConnectedUsersToggleLabel();
};

Tools.setConnectedUsersPanelOpen = function setConnectedUsersPanelOpen(
  /** @type {boolean} */ open,
) {
  const shouldOpen = open && getConnectedUsersCount() > 0;
  const panel = getConnectedUsersPanel();
  const toggle = getConnectedUsersToggle();
  Tools.connectedUsersPanelOpen = shouldOpen;
  panel.classList.toggle("connected-users-panel-hidden", !shouldOpen);
  toggle.classList.toggle("board-presence-toggle-open", shouldOpen);
  toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
};

Tools.upsertConnectedUser = function upsertConnectedUser(
  /** @type {ConnectedUser} */ user,
) {
  getConnectedUsers()[user.socketId] = Object.assign(
    {},
    getConnectedUsers()[user.socketId] || {},
    user,
  );
  Tools.renderConnectedUsers();
};

Tools.removeConnectedUser = function removeConnectedUser(
  /** @type {string} */ socketId,
) {
  const user = getConnectedUsers()[socketId];
  if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  delete getConnectedUsers()[socketId];
  Tools.renderConnectedUsers();
};

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
 * @param {BoardMessage} message
 * @param {{x: number, y: number} | null} focusPoint
 * @param {string | null} messageSocketId
 * @param {ConnectedUser} user
 * @returns {boolean}
 */
function shouldUpdateConnectedUserFocus(
  message,
  focusPoint,
  messageSocketId,
  user,
) {
  return Boolean(
    focusPoint &&
      (message.tool !== "Cursor" ||
        messageSocketId === null ||
        messageSocketId === user.socketId),
  );
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

  if (message.tool !== "Cursor") {
    markConnectedUserActivity(user);
    changed = true;
  }
  if (message.color !== undefined) {
    user.color = message.color;
    changed = true;
  }
  if (message.size !== undefined) {
    user.size = Number(message.size) || user.size;
    changed = true;
  }
  if (message.tool && message.tool !== "Cursor") {
    user.lastTool = message.tool;
    changed = true;
  }
  if (
    shouldUpdateConnectedUserFocus(message, focusPoint, messageSocketId, user)
  ) {
    user.lastFocusX = /** @type {{x: number, y: number}} */ (focusPoint).x;
    user.lastFocusY = /** @type {{x: number, y: number}} */ (focusPoint).y;
    changed = true;
  }
  return changed;
}

Tools.updateConnectedUsersFromActivity =
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
        applyConnectedUserActivity(
          user,
          message,
          focusPoint,
          messageSocketId,
        ) || changed;
    });
    if (changed) Tools.renderConnectedUsers();
  };

Tools.updateCurrentConnectedUserFromActivity =
  function updateCurrentConnectedUserFromActivity(
    /** @type {BoardMessage} */ message,
  ) {
    if (!Tools.socket?.id) return;
    const current = getConnectedUsers()[Tools.socket.id];
    if (!current) return;
    Tools.updateConnectedUsersFromActivity(
      current.userId,
      Object.assign({}, message, { socket: current.socketId }),
    );
  };

Tools.initConnectedUsersUI = function initConnectedUsersUI() {
  const toggle = document.getElementById("connectedUsersToggle");
  const panel = document.getElementById("connectedUsersPanel");
  if (!(toggle instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
    return;
  }
  Tools.connectedUsersPanelOpen =
    toggle.getAttribute("aria-expanded") === "true";
  syncConnectedUsersToggleLabel();
  if (toggle.dataset.connectedUsersUiBound !== "true") {
    toggle.dataset.connectedUsersUiBound = "true";
    toggle.addEventListener("click", () => {
      Tools.setConnectedUsersPanelOpen(!Tools.connectedUsersPanelOpen);
    });
    toggle.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (
          !panel.matches(":hover") &&
          !panel.contains(document.activeElement) &&
          document.activeElement !== toggle
        ) {
          Tools.setConnectedUsersPanelOpen(false);
        }
      }, 0);
    });
    panel.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        Tools.setConnectedUsersPanelOpen(false);
        toggle.focus();
      }
    });
  }
  Tools.renderConnectedUsers();
};

Tools.tryStartReplaySync = function tryStartReplaySync() {
  if (
    !Tools.pendingReplaySync ||
    !Tools.socket?.connected ||
    !Tools.board ||
    !Tools.svg ||
    !Tools.drawingArea
  ) {
    return;
  }
  const refreshBaseline = Tools.pendingReplaySync === "refresh";
  Tools.pendingReplaySync = false;
  void (async function startSeqReplay() {
    if (refreshBaseline) {
      try {
        await Tools.refreshAuthoritativeBaseline();
      } catch (error) {
        console.error("Failed to refresh authoritative SVG baseline", error);
      }
    }
    Tools.socket?.emit("sync_request", {
      baselineSeq: Tools.authoritativeSeq,
    });
  })();
};

Tools.startConnection = () => {
  // Destroy socket if one already exists
  if (Tools.socket) {
    BoardConnection.closeSocket(Tools.socket);
    Tools.socket = null;
  }
  Tools.connectionState = "connecting";
  Object.values(getConnectedUsers()).forEach((user) => {
    if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  });
  Tools.connectedUsers = /** @type {AppToolsState["connectedUsers"]} */ ({});
  Tools.renderConnectedUsers();

  const socketParams = BoardConnection.buildSocketParams(
    window.location.pathname,
    Tools.socketIOExtraHeaders,
    Tools.token,
    Tools.boardName,
    {
      sync: "seq",
      tool: Tools.initialPrefs?.tool || "Hand",
      color: Tools.getColor(),
      size: String(Tools.getSize()),
    },
  );

  const socket = io.connect("", socketParams);
  Tools.socket = socket;

  //Receive draw instructions from the server
  socket.on("connect", function onConnection() {
    const hadConnectedBefore = Tools.hasConnectedOnce;
    Tools.connectionState = "connected";
    if (hadConnectedBefore && Tools.server_config.TURNSTILE_SITE_KEY) {
      Tools.setTurnstileValidation(null);
      BoardTurnstile.resetTurnstileWidget(
        typeof turnstile !== "undefined" ? turnstile : undefined,
        Tools.turnstileWidgetId,
      );
    }
    Tools.hasConnectedOnce = true;
    Tools.awaitingBoardSnapshot = true;
    Tools.awaitingSyncReplay = true;
    Tools.pendingReplaySync = hadConnectedBefore ? "refresh" : "ready";
    Tools.tryStartReplaySync();
    Tools.syncWriteStatusIndicator();
  });
  socket.on("broadcast", (/** @type {BoardMessage} */ msg) => {
    enqueueIncomingBroadcast(msg);
  });
  socket.on("boardstate", Tools.setBoardState);
  socket.on(
    "mutation_rejected",
    function onMutationRejected(
      /** @type {{clientMutationId?: unknown} | undefined} */ payload,
    ) {
      if (typeof payload?.clientMutationId !== "string") return;
      Tools.rejectOptimisticMutation(payload.clientMutationId);
    },
  );
  socket.on("sync_replay_start", function onSyncReplayStart() {
    Tools.awaitingBoardSnapshot = true;
    Tools.awaitingSyncReplay = true;
  });
  socket.on(
    "sync_replay_end",
    function onSyncReplayEnd(
      /** @type {{toInclusiveSeq?: unknown} | undefined} */ payload,
    ) {
      Tools.hasAuthoritativeBoardSnapshot = true;
      Tools.authoritativeSeq = BoardMessageReplay.normalizeSeq(
        payload?.toInclusiveSeq,
      );
      Tools.awaitingBoardSnapshot = false;
      Tools.awaitingSyncReplay = false;
      Tools.flushBufferedWrites();
      Tools.incomingBroadcastQueue =
        BoardMessageReplay.filterBufferedMessagesAfterSeqReplay(
          Tools.preSnapshotMessages,
          Tools.authoritativeSeq,
        ).concat(Tools.incomingBroadcastQueue);
      Tools.preSnapshotMessages = [];
      Tools.restoreLocalCursor();
      Tools.syncWriteStatusIndicator();
    },
  );
  socket.on(
    "resync_required",
    function onResyncRequired(
      /** @type {{latestSeq?: unknown, minReplayableSeq?: unknown} | undefined} */ payload,
    ) {
      console.warn("Server requested authoritative resync", {
        authoritativeSeq: Tools.authoritativeSeq,
        latestSeq: BoardMessageReplay.normalizeSeq(payload?.latestSeq),
        minReplayableSeq: BoardMessageReplay.normalizeSeq(
          payload?.minReplayableSeq,
        ),
      });
      Tools.beginAuthoritativeResync();
      Tools.startConnection();
    },
  );
  socket.on(
    "user_joined",
    function onUserJoined(/** @type {ConnectedUser} */ user) {
      Tools.upsertConnectedUser(user);
    },
  );
  socket.on(
    "user_left",
    function onUserLeft(/** @type {{socketId?: string}} */ user) {
      if (!user.socketId) return;
      Tools.removeConnectedUser(user.socketId);
    },
  );
  socket.on(
    "rate-limited",
    function onRateLimited(
      /** @type {{retryAfterMs?: number} | null | undefined} */ payload,
    ) {
      const retryAfterMs =
        payload && typeof payload.retryAfterMs === "number"
          ? payload.retryAfterMs
          : 60 * 1000;
      Tools.rateLimitedUntil = Date.now() + Math.max(0, retryAfterMs);
      Tools.showRateLimitNotice(
        Tools.i18n.t("rate_limit_disconnect_message"),
        retryAfterMs,
      );
      Tools.syncWriteStatusIndicator();
    },
  );
  socket.on("disconnect", function onDisconnect(/** @type {string} */ reason) {
    if (socket !== Tools.socket) return;
    Tools.connectionState = "disconnected";
    Tools.beginAuthoritativeResync();
    if (reason === "io server disconnect") {
      socket.connect();
    }
  });
  if (typeof socket.connect === "function") {
    socket.connect();
  }
};
function saveBoardNametoLocalStorage() {
  const boardName = Tools.boardName;
  const key = "recent-boards";
  let recentBoards;
  try {
    const storedBoards = localStorage.getItem(key);
    recentBoards = storedBoards ? JSON.parse(storedBoards) : [];
  } catch (e) {
    // On localstorage or json error, reset board list
    recentBoards = [];
    console.log("Board history loading error", e);
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
  button.dataset.toolName = toolName;
  button.dataset.toolBound = "true";
  button.setAttribute("aria-label", toolName);
  button.addEventListener("click", () => {
    void Tools.activateTool(toolName);
  });
  button.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      void Tools.activateTool(toolName);
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
  parts.primaryIcon.src = Tools.versionAssetPath(tool.icon);
  parts.primaryIcon.alt = "";
  button.classList.toggle("oneTouch", tool.oneTouch === true);
  button.classList.toggle("hasSecondary", !!tool.secondary);
  parts.primaryIcon.classList.toggle("primaryIcon", !!tool.secondary);
  button.title = tool.shortcut
    ? `${translatedToolName} (${Tools.i18n.t("keyboard shortcut")}: ${tool.shortcut})`
    : translatedToolName;
  if (tool.secondary && parts.secondaryIcon) {
    parts.secondaryIcon.src = Tools.versionAssetPath(tool.secondary.icon);
    parts.secondaryIcon.alt = "";
    button.title += ` [${Tools.i18n.t("click_to_toggle")}]`;
  } else if (parts.secondaryIcon) {
    parts.secondaryIcon.src = "data:,";
    parts.secondaryIcon.alt = "";
  }
}

function bindRenderedToolButtons() {
  document
    .querySelectorAll("#tools > .tool[data-tool-name]")
    .forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const toolName = element.dataset.toolName;
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
 * @param {string} toolIcon
 * @param {string} toolShortcut
 * @param {boolean | undefined} oneTouch
 * @returns {HTMLElement | null}
 */
function syncMountedToolButton(toolName, toolIcon, toolShortcut, oneTouch) {
  const tool = Tools.list[toolName];
  if (!tool) {
    throw new Error(`Tool not registered before rendering: ${toolName}`);
  }
  if (toolShortcut) {
    addToolShortcut(toolShortcut, () => {
      void Tools.activateTool(toolName);
      blurActiveElement();
    });
  }
  tool.icon = toolIcon;
  tool.shortcut = toolShortcut || tool.shortcut;
  tool.oneTouch = oneTouch;
  syncToolButton(toolName, tool);
  Tools.syncToolDisabledState(toolName);
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
  parts.primaryIcon.src = Tools.versionAssetPath(icon);
  parts.label.textContent = Tools.i18n.t(name);
}

/**
 * @param {string} href
 * @returns {HTMLLinkElement}
 */
function addToolStylesheet(href) {
  const versionedHref = Tools.versionAssetPath(href);
  const existing = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  ).find((link) => link.getAttribute("href") === versionedHref);
  if (existing instanceof HTMLLinkElement) return existing;
  const link = document.createElement("link");
  link.href = versionedHref;
  link.rel = "stylesheet";
  link.type = "text/css";
  document.head.appendChild(link);
  return link;
}

const colorPresetTemplate = new Minitpl("#colorPresetSel .colorPresetButton");

/**
 * @param {ColorPreset} button
 * @returns {unknown}
 */
function addColorButton(button) {
  const setColor = Tools.setColor.bind(Tools, button.color);
  if (button.key) addToolShortcut(button.key, setColor);
  return colorPresetTemplate.add((elem) => {
    if (!(elem instanceof HTMLElement)) return;
    elem.addEventListener("click", setColor);
    elem.id = `color_${button.color.replace(/^#/, "")}`;
    elem.style.backgroundColor = button.color;
    if (button.key) {
      elem.title = `${Tools.i18n.t("keyboard shortcut")}: ${button.key}`;
    }
  });
}

bindRenderedToolButtons();

Tools.list = /** @type {AppToolsState["list"]} */ ({});

/**
 * @param {string} toolName
 * @returns {Promise<ToolClass>}
 */
Tools.ensureToolClassLoaded = async function ensureToolClassLoaded(toolName) {
  const existing = Tools.toolClasses[toolName];
  if (existing) return existing;

  const namespace = /** @type {{default?: unknown}} */ (
    await import(Tools.versionAssetPath(getToolModuleImportPath(toolName)))
  );
  if (!isToolClass(namespace.default)) {
    throw new Error(`Missing default tool class export for ${toolName}.`);
  }
  const ToolClass = namespace.default;
  if (ToolClass.toolName !== toolName) {
    throw new Error(
      `Tool module for ${toolName} exported ${String(ToolClass.toolName)}.`,
    );
  }
  Tools.toolClasses[toolName] = ToolClass;
  return ToolClass;
};

/**
 * @param {string} toolName
 * @returns {ToolBootContext}
 */
function createToolBootContext(toolName) {
  /** @type {ToolRuntime} */
  const runtime = {
    Tools: Tools,
    activateTool: (name) => {
      void Tools.activateTool(name);
    },
    getButton: (name) => getToolButton(name),
    registerShortcut: (name, key) => {
      addToolShortcut(key, () => {
        void Tools.activateTool(name);
      });
    },
  };
  return {
    toolName: toolName,
    runtime: runtime,
    button: getToolButton(toolName),
    version: Tools.assetVersion,
    assetUrl: (assetFile) => Tools.getToolAssetUrl(toolName, assetFile),
  };
}

/**
 * @param {AppTool} tool
 * @returns {MountedAppTool}
 */
function prepareMountedTool(tool) {
  if (!tool.name) throw new Error("A tool must have a name");
  tool.listeners = {
    press: tool.press ? tool.press.bind(tool) : tool.listeners?.press,
    move: tool.move ? tool.move.bind(tool) : tool.listeners?.move,
    release: tool.release ? tool.release.bind(tool) : tool.listeners?.release,
  };
  tool.onstart = tool.onstart ? tool.onstart.bind(tool) : () => {};
  tool.onquit = tool.onquit ? tool.onquit.bind(tool) : () => {};
  tool.onMessage = tool.onMessage || (() => {});
  tool.onSocketDisconnect = tool.onSocketDisconnect
    ? tool.onSocketDisconnect.bind(tool)
    : () => {};
  if (tool.onSizeChange) {
    tool.onSizeChange = tool.onSizeChange.bind(tool);
  }

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
        const touch = touchEvent.changedTouches[0];
        if (!touch) return true;
        return listener(
          Tools.pageCoordinateToBoard(touch.pageX),
          Tools.pageCoordinateToBoard(touch.pageY),
          touchEvent,
          true,
        );
      }
      const mouseEvent = /** @type {MouseEvent} */ (evt);
      return listener(
        Tools.pageCoordinateToBoard(mouseEvent.pageX),
        Tools.pageCoordinateToBoard(mouseEvent.pageY),
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
    if (!Tools.isIE) compiled.mouseleave = compiled.mouseup;
    const touchRelease = compilePointerListener(tool.listeners.release, true);
    compiled.touchleave = touchRelease;
    compiled.touchend = touchRelease;
    compiled.touchcancel = touchRelease;
  }
  tool.compiledListeners = compiled;
  return /** @type {MountedAppTool} */ (tool);
}

/**
 * @param {AppTool} tool
 * @returns {MountedAppTool | null}
 */
Tools.mountTool = function mountTool(tool) {
  const mountedTool = prepareMountedTool(tool);
  if (tool.stylesheet) {
    addToolStylesheet(tool.stylesheet);
  }
  if (Tools.isBlocked(tool)) return null;

  if (tool.name in Tools.list) {
    console.log(
      `Tools.mountTool: The tool '${tool.name}' is already in the list. Updating it...`,
    );
  }

  Tools.list[tool.name] = mountedTool;

  if (mountedTool.onSizeChange) {
    Tools.sizeChangeHandlers.push(mountedTool.onSizeChange);
  }

  const pending = drainPendingMessages(Tools.pendingMessages, tool.name);
  if (pending.length > 0) {
    console.log("Drawing pending messages for '%s'.", tool.name);
    pending.forEach((/** @type {BoardMessage} */ msg) => {
      mountedTool.draw(msg, false);
    });
  }
  if (Tools.shouldDisplayTool(tool.name)) {
    syncMountedToolButton(
      tool.name,
      tool.icon,
      tool.shortcut || "",
      tool.oneTouch,
    );
  }
  Tools.syncToolDisabledState(tool.name);
  if (mountedTool.alwaysOn === true) {
    Tools.addToolListeners(mountedTool);
  }
  normalizeServerRenderedElementsForTool(mountedTool);
  return mountedTool;
};

/**
 * @param {string} toolName
 * @returns {Promise<AppTool | null>}
 */
async function bootToolPromise(toolName) {
  const ToolClass = await Tools.ensureToolClassLoaded(toolName);
  const bootedTool = await ToolClass.boot(createToolBootContext(toolName));
  if (!bootedTool) return null;
  return Tools.mountTool(bootedTool);
}

/**
 * @param {string} toolName
 * @returns {Promise<AppTool | null>}
 */
Tools.bootTool = async function bootTool(toolName) {
  const existingTool = Tools.list[toolName];
  if (existingTool) return existingTool;
  const inFlight = Tools.bootedToolPromises[toolName];
  if (inFlight) return inFlight;

  const promise = bootToolPromise(toolName);
  Tools.bootedToolPromises[toolName] = promise;
  try {
    return await promise;
  } finally {
    delete Tools.bootedToolPromises[toolName];
  }
};

/**
 * @param {string} toolName
 * @returns {Promise<boolean>}
 */
Tools.activateTool = async function activateTool(toolName) {
  if (!Tools.shouldDisplayTool(toolName)) return false;
  const tool = await Tools.bootTool(toolName);
  if (!tool || !Tools.canUseTool(toolName)) return false;
  if (tool.requiresWritableBoard === true && !Tools.canBufferWrites()) {
    await Tools.whenBoardWritable();
    if (!Tools.canUseTool(toolName)) return false;
  }
  return Tools.change(toolName) !== false;
};

/** @param {AppTool} tool */
Tools.isBlocked = function toolIsBanned(tool) {
  return isBlockedToolName(tool.name, Tools.server_config.BLOCKED_TOOLS || []);
};

/** @param {MountedAppTool} newTool */
function toggleSecondaryTool(newTool) {
  if (!newTool.secondary) return;
  newTool.secondary.active = !newTool.secondary.active;
  const props = newTool.secondary.active ? newTool.secondary : newTool;
  toggleToolButtonMode(newTool.name, props.name, props.icon);
  if (newTool.secondary.switch) newTool.secondary.switch();
  syncActiveToolState();
}

/**
 * @param {string} toolName
 * @param {MountedAppTool} newTool
 * @returns {void}
 */
function updateCurrentToolChrome(toolName, newTool) {
  const svg = Tools.svg;
  const board = Tools.board;
  if (!svg || !board) return;
  const curToolName = Tools.curTool ? Tools.curTool.name : "";
  try {
    changeActiveToolButton(curToolName, toolName);
  } catch (e) {
    console.error(`Unable to update the GUI with the new tool. ${e}`);
  }
  svg.style.cursor = newTool.mouseCursor || "auto";
  board.title = Tools.i18n.t(newTool.helpText || "");
}

/** @param {MountedAppTool} newTool */
function replaceCurrentTool(newTool) {
  const currentTool = Tools.curTool;
  if (currentTool !== null) {
    Tools.removeToolListeners(currentTool);
    currentTool.onquit && currentTool.onquit(newTool);
  }
  Tools.addToolListeners(newTool);
  Tools.curTool = newTool;
  syncActiveToolState();
}

function syncActiveToolState() {
  const currentTool = Tools.curTool;
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

/** @param {string} toolName */
Tools.change = (toolName) => {
  const newTool = Tools.list[toolName];
  const oldTool = Tools.curTool;
  if (!newTool)
    throw new Error("Trying to select a tool that has never been added!");
  if (Tools.shouldDisableTool(toolName)) return false;
  if (newTool === oldTool) {
    toggleSecondaryTool(newTool);
    return;
  }
  if (!newTool.oneTouch) {
    updateCurrentToolChrome(toolName, newTool);
    replaceCurrentTool(newTool);
  }

  if (newTool.onstart) newTool.onstart(oldTool);
  return true;
};

/** @param {AppTool} tool */
Tools.addToolListeners = function addToolListeners(tool) {
  if (!tool.compiledListeners) return;
  for (const event in tool.compiledListeners) {
    const listener = tool.compiledListeners[event];
    if (!listener) continue;
    const target = listener.target || Tools.board;
    if (!target) continue;
    target.addEventListener(event, listener, { passive: false });
  }
};

/** @param {AppTool} tool */
Tools.removeToolListeners = function removeToolListeners(tool) {
  if (!tool.compiledListeners) return;
  for (const event in tool.compiledListeners) {
    const listener = tool.compiledListeners[event];
    if (!listener) continue;
    const target = listener.target || Tools.board;
    if (!target) continue;
    target.removeEventListener(event, listener);
    // also attempt to remove with capture = true in IE
    if (Tools.isIE) target.removeEventListener(event, listener, true);
  }
};

(() => {
  // Handle secondary tool switch with shift (key code 16)
  /**
   * @param {boolean} active
   * @param {KeyboardEvent} evt
   */
  function handleShift(active, evt) {
    if (
      evt.keyCode === 16 &&
      Tools.curTool &&
      Tools.curTool.secondary &&
      Tools.curTool.secondary.active !== active
    ) {
      Tools.change(Tools.curTool.name);
    }
  }
  window.addEventListener("keydown", handleShift.bind(null, true));
  window.addEventListener("keyup", handleShift.bind(null, false));
})();

/**
 * @param {BoardMessage} data
 * @param {string | undefined} toolName
 */
Tools.send = (data, toolName) => {
  if (!toolName) {
    if (!Tools.curTool) throw new Error("No current tool selected");
    toolName = Tools.curTool.name;
  }
  const outboundData = Tools.cloneMessage(data);
  outboundData.tool = toolName;
  Tools.applyHooks(Tools.messageHooks, outboundData);
  return Tools.sendBufferedWrite(outboundData);
};

/**
 * @param {BoardMessage} data
 * @param {AppTool | null | undefined} tool
 */
Tools.drawAndSend = (data, tool) => {
  if (tool == null) tool = Tools.curTool;
  if (!tool) throw new Error("No active tool available");
  if (tool && Tools.shouldDisableTool(tool.name)) return false;
  if (
    !Tools.socket ||
    !Tools.socket.connected ||
    Tools.awaitingBoardSnapshot ||
    Tools.isWritePaused()
  ) {
    return false;
  }

  const outboundData = Tools.cloneMessage(data);
  if (tool.name !== "Cursor") {
    outboundData.clientMutationId = Tools.generateUID("cm-");
  }
  const rollback = Tools.captureOptimisticRollback(outboundData);

  // Optimistically render the drawing immediately
  tool.draw(outboundData, true);

  if (
    MessageCommon.requiresTurnstile(Tools.boardName, tool.name) &&
    Tools.server_config.TURNSTILE_SITE_KEY &&
    !Tools.isTurnstileValidated()
  ) {
    Tools.trackOptimisticMutation(outboundData, rollback);
    Tools.queueProtectedWrite(outboundData, tool);
    return true;
  }

  const sent = Tools.send(outboundData, tool.name) !== false;
  if (sent) {
    Tools.trackOptimisticMutation(outboundData, rollback);
  }
  return sent;
};

//Object containing the messages that have been received before the corresponding tool
//is loaded. keys : the name of the tool, values : array of messages for this tool
Tools.pendingMessages = /** @type {PendingMessages} */ ({});

/**
 * Send a message to the corresponding tool.
 * @param {BoardMessage} message
 * @returns {void}
 */
function messageForTool(message) {
  const name = message.tool;
  const tool = name ? Tools.list[name] : undefined;

  if (tool) {
    Tools.applyHooks(Tools.messageHooks, message);
    tool.draw(message, false);
  } else {
    ///We received a message destinated to a tool that we don't have
    //So we add it to the pending messages
    if (name)
      BoardMessages.queuePendingMessage(Tools.pendingMessages, name, message);
  }

  if (message.tool !== "Hand" && message.transform != null) {
    //this message has special info for the mover
    messageForTool({
      tool: "Hand",
      type: "update",
      transform: message.transform,
      id: message.id,
    });
  }
}
Tools.messageForTool = messageForTool;

/**
 * Call messageForTool recursively on the message and its children.
 * @param {BoardMessage} message
 * @returns {Promise<void>}
 */
function handleMessage(message) {
  //Check if the message is in the expected format
  if (!message.tool && !message._children) {
    console.error("Received a badly formatted message (no tool). ", message);
  }
  if (message.tool) messageForTool(message);
  if (
    BoardMessages.hasChildMessages(message) &&
    BoardMessageReplay.shouldReplayChildrenIndividually(message)
  )
    return BoardMessages.batchCall(
      childMessageHandler(message),
      message._children,
    );
  if (BoardMessages.hasChildMessages(message)) {
    return Promise.resolve();
  }
  if (message._children) {
    console.error(
      "Received a badly formatted message (_children must be an array). ",
      message,
    );
    return Promise.resolve();
  }
  return Promise.resolve();
}

/**
 * Takes a parent message, and returns a function that will handle a single child message.
 * @param {BoardMessage} parent
 * @returns {(child: BoardMessage) => Promise<void>}
 */
function childMessageHandler(parent) {
  return function handleChild(child) {
    return handleMessage(
      BoardMessageReplay.prepareReplayChild(
        parent,
        child,
        BoardMessages.normalizeChildMessage,
      ),
    );
  };
}

Tools.unreadMessagesCount = 0;
Tools.newUnreadMessage = () => {
  Tools.unreadMessagesCount++;
  updateDocumentTitle();
};

window.addEventListener("focus", () => {
  Tools.unreadMessagesCount = 0;
  updateDocumentTitle();
  if (Tools.bufferedWrites.length > 0) {
    Tools.flushBufferedWrites();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Tools.bufferedWrites.length > 0) {
    Tools.flushBufferedWrites();
  }
});

function updateDocumentTitle() {
  document.title =
    (Tools.unreadMessagesCount ? `(${Tools.unreadMessagesCount}) ` : "") +
    `${Tools.boardName} | WBO`;
}

/** @type {ReturnType<typeof setTimeout> | null} */
let viewportHashScrollTimeout = null;
let lastViewportHashStateUpdate = Date.now();
let viewportHashObserversInstalled = false;

function syncViewportHashFromScroll() {
  const scale = Tools.getScale();
  const x = document.documentElement.scrollLeft / scale;
  const y = document.documentElement.scrollTop / scale;

  if (viewportHashScrollTimeout !== null) {
    clearTimeout(viewportHashScrollTimeout);
  }
  viewportHashScrollTimeout = setTimeout(function updateViewportHistory() {
    const hash = `#${x | 0},${y | 0},${Tools.getScale().toFixed(VIEWPORT_HASH_SCALE_DECIMALS)}`;
    if (
      Date.now() - lastViewportHashStateUpdate > 5000 &&
      hash !== window.location.hash
    ) {
      window.history.pushState({}, "", hash);
      lastViewportHashStateUpdate = Date.now();
    } else {
      window.history.replaceState({}, "", hash);
    }
  }, 100);
}

Tools.applyViewportFromHash = function applyViewportFromHash() {
  const coords = window.location.hash.slice(1).split(",");
  const x = Tools.toBoardCoordinate(coords[0]);
  const y = Tools.toBoardCoordinate(coords[1]);
  const scale = Number.parseFloat(coords[2] || "");
  resizeCanvas({ x: x, y: y });
  const appliedScale = Tools.setScale(scale);
  window.scrollTo(x * appliedScale, y * appliedScale);
};

Tools.installViewportHashObservers = function installViewportHashObservers() {
  if (viewportHashObserversInstalled) return;
  viewportHashObserversInstalled = true;
  window.addEventListener("scroll", syncViewportHashFromScroll);
  window.addEventListener("hashchange", Tools.applyViewportFromHash, false);
  window.addEventListener("popstate", Tools.applyViewportFromHash, false);
};

/** @param {BoardMessage} m */
function resizeCanvas(m) {
  if (!Tools.svg) return;
  //Enlarge the canvas whenever something is drawn near its border
  const x = Number(m.x) | 0;
  const y = Number(m.y) | 0;
  const MAX_BOARD_SIZE = Tools.server_config.MAX_BOARD_SIZE || 655360; // Maximum value for any x or y on the board
  if (x > Tools.svg.width.baseVal.value - RESIZE_CANVAS_MARGIN) {
    Tools.svg.width.baseVal.value = Math.min(
      x + RESIZE_CANVAS_MARGIN,
      MAX_BOARD_SIZE,
    );
  }
  if (y > Tools.svg.height.baseVal.value - RESIZE_CANVAS_MARGIN) {
    Tools.svg.height.baseVal.value = Math.min(
      y + RESIZE_CANVAS_MARGIN,
      MAX_BOARD_SIZE,
    );
  }
}

/** @param {BoardMessage} m */
function updateUnreadCount(m) {
  const mutationType = getMutationType(m);
  if (
    document.hidden &&
    mutationType !== MutationType.APPEND &&
    mutationType !== MutationType.UPDATE
  ) {
    Tools.newUnreadMessage();
  }
}

/** @param {BoardMessage} m */
function notifyToolsOfMessage(m) {
  Object.values(Tools.list || {}).forEach((tool) => {
    if (tool) tool.onMessage(m);
  });
}

// List of hook functions that will be applied to messages before sending or drawing them
Tools.messageHooks = [resizeCanvas, updateUnreadCount, notifyToolsOfMessage];

/** @type {ReturnType<typeof setTimeout> | null} */
let scaleTimeout = null;
/** @param {number} scale */
Tools.setScale = function setScale(scale) {
  if (!Tools.svg) {
    Tools.scale = scale;
    return scale;
  }
  const fullScale =
    Math.max(window.innerWidth, window.innerHeight) /
    (Number(Tools.server_config.MAX_BOARD_SIZE) || 655360);
  const minScale = Math.max(MIN_BOARD_SCALE, fullScale);
  const maxScale = MAX_BOARD_SCALE;
  if (Number.isNaN(scale)) scale = DEFAULT_BOARD_SCALE;
  scale = Math.max(minScale, Math.min(maxScale, scale));
  const svg = Tools.svg;
  if (!svg) {
    Tools.scale = scale;
    return scale;
  }
  svg.style.willChange = "transform";
  svg.style.transform = `scale(${scale})`;
  if (scaleTimeout !== null) clearTimeout(scaleTimeout);
  scaleTimeout = setTimeout(() => {
    if (Tools.svg) Tools.svg.style.willChange = "auto";
  }, 1000);
  Tools.scale = scale;
  Tools.syncDrawToolAvailability(false);
  return scale;
};
Tools.getScale = function getScale() {
  return Tools.scale;
};

/**
 * @template T
 * @param {((value: T) => void)[]} hooks
 * @param {T} object
 * @returns {void}
 */
Tools.applyHooks = function applyHooks(hooks, object) {
  //Apply every hooks on the object
  hooks.forEach((hook) => {
    hook(object);
  });
};

// Utility functions

/**
 * @param {string | undefined} prefix
 * @param {string | undefined} suffix
 */
Tools.generateUID = function generateUID(prefix, suffix) {
  let uid = Date.now().toString(36); //Create the uids in chronological order
  uid += Math.round(Math.random() * 36).toString(36); //Add a random character at the end
  if (prefix) uid = prefix + uid;
  if (suffix) uid = uid + suffix;
  return uid;
};

/**
 * @param {string} name
 * @param {{[key: string]: string | number | undefined} | undefined} attrs
 * @returns {SVGElement}
 */
Tools.createSVGElement = function createSVGElement(name, attrs) {
  if (!Tools.svg) {
    throw new Error("Board SVG is not attached.");
  }
  const elem = /** @type {SVGElement} */ (
    document.createElementNS(Tools.svg.namespaceURI, name)
  );
  if (!attrs) return elem;
  Object.keys(attrs).forEach((key) => {
    elem.setAttributeNS(null, key, String(attrs[key]));
  });
  return elem;
};

/**
 * @param {HTMLElement} elem
 * @param {number} x
 * @param {number} y
 */
Tools.positionElement = function positionElement(elem, x, y) {
  elem.style.top = `${y}px`;
  elem.style.left = `${x}px`;
};

Tools.colorPresets = [
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
Tools.color_chooser = null;
Tools.colorChangeHandlers =
  /** @type {AppToolsState["colorChangeHandlers"]} */ ([]);
Tools.sizeChangeHandlers = [];

/** @param {string} color */
Tools.setColor = function setColor(color) {
  Tools.currentColor = color;
  if (Tools.color_chooser) {
    Tools.color_chooser.value = color;
  }
  Tools.colorChangeHandlers.forEach((handler) => {
    handler(color);
  });
};

Tools.getColor = function getColor() {
  return Tools.currentColor;
};

/**
 * @param {number | string | null | undefined} value
 * @returns {number}
 */
Tools.setSize = function setSize(value) {
  if (value !== null && value !== undefined) {
    Tools.currentSize = MessageCommon.clampSize(value);
  }
  const chooser = document.getElementById("chooseSize");
  if (chooser instanceof HTMLInputElement) {
    chooser.value = String(Tools.currentSize);
  }
  Tools.sizeChangeHandlers.forEach((handler) => {
    handler(Tools.currentSize);
  });
  return Tools.currentSize;
};

Tools.getSize = function getSize() {
  return Tools.currentSize;
};

Tools.getOpacity = function getOpacity() {
  return Tools.currentOpacity;
};

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
    console.warn("Unable to load Socket.IO extra headers", err);
  }
}
if (socketIOExtraHeaders) {
  window.socketio_extra_headers = socketIOExtraHeaders;
}
const colorIndex = (Math.random() * Tools.colorPresets.length) | 0;
const initialPreset = Tools.colorPresets[colorIndex] || Tools.colorPresets[0];
Tools.server_config = /** @type {ServerConfig} */ (
  parseEmbeddedJson("configuration", {})
);
Tools.boardName = resolveBoardName(window.location.pathname);
Tools.token = new URL(window.location.href).searchParams.get("token");
Tools.socketIOExtraHeaders = socketIOExtraHeaders;
Tools.pendingReplaySync = false;
Tools.initialPrefs = {
  tool: "Hand",
  color: initialPreset?.color || "#001f3f",
  size: DEFAULT_INITIAL_SIZE,
  opacity: DEFAULT_INITIAL_OPACITY,
};
Tools.currentColor = Tools.initialPrefs.color;
Tools.currentSize = MessageCommon.clampSize(Tools.initialPrefs.size);
Tools.currentOpacity = MessageCommon.clampOpacity(Tools.initialPrefs.opacity);
Tools.setBoardState(
  parseEmbeddedJson("board-state", {
    readonly: false,
    canWrite: true,
  }),
);
Tools.initConnectedUsersUI();
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
			//Print the data on Tools.svg
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
