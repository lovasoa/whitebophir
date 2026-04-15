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

import BoardMessageReplay from "./board_message_replay.js";
import {
  drainPendingMessages,
  getRequiredElement,
  isBlockedToolName,
  normalizeBoardState,
  parseEmbeddedJson,
  resolveBoardName,
  shouldDisplayTool as shouldDisplayBoardTool,
  updateRecentBoards,
} from "./board_page_state.js";
import {
  connection as BoardConnection,
  messages as BoardMessages,
  turnstile as BoardTurnstile,
} from "./board_transport.js";
import MessageCommon from "./message_common.js";
import Minitpl from "./minitpl.js";
import RateLimitCommon from "./rate_limit_common.js";
import { getToolCatalogEntry } from "./tool_catalog.js";
import {
  getToolModuleImportPath,
  getToolRuntimeAssetPath,
} from "./tool_assets.js";

/** @typedef {import("../../types/app-runtime").AppBoardState} AppBoardState */
/** @typedef {import("../../types/app-runtime").AppTool} AppTool */
/** @typedef {import("../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../types/app-runtime").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime").BufferedWrite} BufferedWrite */
/** @typedef {import("../../types/app-runtime").ColorPreset} ColorPreset */
/** @typedef {import("../../types/app-runtime").PendingMessages} PendingMessages */
/** @typedef {import("../../types/app-runtime").PendingWrite} PendingWrite */
/** @typedef {import("../../types/app-runtime").RateLimitKind} RateLimitKind */
/** @typedef {import("../../types/app-runtime").ServerConfig} ServerConfig */
/** @typedef {import("../../types/app-runtime").CompiledToolListener} CompiledToolListener */
/** @typedef {import("../../types/app-runtime").ToolPalette} ToolPalette */
/** @typedef {import("../../types/app-runtime").ToolPointerListener} ToolPointerListener */
/** @typedef {import("../../types/app-runtime").ToolClass} ToolClass */
/** @typedef {import("../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {import("../../types/app-runtime").ToolRuntime} ToolRuntime */
/** @typedef {{board?: string, socketId: string, userId: string, name: string, color: string, size: number, lastTool: string, lastFocusX?: number, lastFocusY?: number, lastActivityAt?: number, pulseMs?: number, pulseUntil?: number, reported?: boolean, pulseTimeoutId?: ReturnType<typeof setTimeout> | null}} ConnectedUser */
/** @typedef {HTMLLIElement} ConnectedUserRow */
/** @typedef {{limit?: number, periodMs?: number, anonymousLimit?: number, overrides?: {[boardName: string]: {limit?: number, periodMs?: number}}}} RateLimitDefinition */
const Tools = /** @type {AppToolsState} */ ({});
window.Tools = Tools;
// Add extra slack between the client-side local budget and the server's
// fixed window so buffered writes do not flush too early on slow runners.
const RATE_LIMIT_FLUSH_SAFETY_MS = 1000;
/** @type {RateLimitKind[]} */
const RATE_LIMIT_KINDS = ["general", "constructive", "destructive"];

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
 * @param {string} toolName
 * @returns {{button: HTMLElement, primaryIcon: HTMLImageElement, secondaryIcon: HTMLImageElement | null, label: HTMLElement} | null}
 */
function getToolButtonParts(toolName) {
  const button = document.getElementById(`toolID-${toolName}`);
  if (!(button instanceof HTMLElement)) return null;
  const primaryIcon = /** @type {HTMLImageElement | null} */ (
    button.querySelector(".tool-icon")
  );
  const label = /** @type {HTMLElement | null} */ (
    button.querySelector(".tool-name")
  );
  if (!primaryIcon || !label) return null;
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
    if (typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }
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

Tools.server_config = /** @type {ServerConfig} */ (
  parseEmbeddedJson("configuration", {})
);
Tools.assetVersion = document.documentElement.dataset.version || "";

/**
 * @param {string} assetPath
 * @returns {string}
 */
Tools.versionAssetPath = function versionAssetPath(assetPath) {
  if (!Tools.assetVersion) return assetPath;
  const separator = assetPath.includes("?") ? "&" : "?";
  return `${assetPath}${separator}v=${encodeURIComponent(Tools.assetVersion)}`;
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
Tools.toolClasses = {};
Tools.bootedToolPromises = {};
Tools.bootedToolNames = new Set();
Tools.turnstileValidatedUntil = 0;
Tools.turnstileWidgetId = null;
Tools.turnstileRefreshTimeout = null;
Tools.turnstilePending = false;
Tools.turnstilePendingWrites = [];
Tools.bufferedWrites = [];
Tools.bufferedWriteTimer = null;
Tools.rateLimitedUntil = 0;
Tools.rateLimitNoticeTimer = null;
Tools.rateLimitNoticeMessage = "";
Tools.awaitingBoardSnapshot = true;
Tools.hasAuthoritativeBoardSnapshot = false;
Tools.snapshotRevision = 0;
Tools.preSnapshotMessages = [];
Tools.incomingBroadcastQueue = [];
Tools.processingIncomingBroadcast = false;
Tools.connectionState = "idle";
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

function getLoadingMessage() {
  return document.getElementById("loadingMessage");
}

function getBoardStatusIndicator() {
  return document.getElementById("boardStatusIndicator");
}

function getBoardStatusNotice() {
  return document.getElementById("boardStatusNotice");
}

/**
 * @param {unknown} value
 * @returns {RateLimitDefinition}
 */
function toRateLimitDefinition(value) {
  return value && typeof value === "object"
    ? /** @type {RateLimitDefinition} */ (value)
    : {};
}

Tools.showLoadingMessage = function showLoadingMessage() {
  const loadingEl = getLoadingMessage();
  if (loadingEl) loadingEl.classList.remove("hidden");
};

Tools.hideLoadingMessage = function hideLoadingMessage() {
  const loadingEl = getLoadingMessage();
  if (loadingEl) loadingEl.classList.add("hidden");
};

/**
 * @param {RateLimitKind} kind
 * @returns {RateLimitDefinition}
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
 * @param {{board: string, data: BoardMessage}} message
 * @returns {{general: number, constructive: number, destructive: number}}
 */
Tools.getBufferedWriteCosts = function getBufferedWriteCosts(message) {
  return {
    general: 1,
    constructive: RateLimitCommon.countConstructiveActions(message.data),
    destructive: RateLimitCommon.countDestructiveActions(message.data),
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

/**
 * @param {string} message
 * @param {number} retryAfterMs
 * @returns {void}
 */
Tools.showRateLimitNotice = function showRateLimitNotice(
  message,
  retryAfterMs,
) {
  const notice = getBoardStatusNotice();
  if (!notice) return;
  Tools.rateLimitNoticeMessage = message;
  notice.textContent = message;
  notice.classList.remove("board-status-notice-hidden");
  Tools.clearRateLimitNoticeTimer();
  if (retryAfterMs > 0) {
    Tools.rateLimitNoticeTimer = setTimeout(function hideRateLimitNotice() {
      Tools.syncWriteStatusIndicator();
      Tools.hideRateLimitNotice();
    }, retryAfterMs);
  }
};

Tools.hideRateLimitNotice = function hideRateLimitNotice() {
  Tools.clearRateLimitNoticeTimer();
  const notice = getBoardStatusNotice();
  if (!notice) return;
  notice.classList.add("board-status-notice-hidden");
  notice.textContent = "";
  Tools.syncWriteStatusIndicator();
};

Tools.syncWriteStatusIndicator = function syncWriteStatusIndicator() {
  const indicator = getBoardStatusIndicator();
  if (!indicator) return;
  const isPaused =
    Tools.connectionState !== "connected" || Tools.isWritePaused();
  indicator.classList.remove(
    "board-status-hidden",
    "board-status-buffering",
    "board-status-paused",
  );
  if (isPaused) {
    indicator.classList.add("board-status-paused");
    return;
  }
  if (Tools.bufferedWrites.length > 0) {
    indicator.classList.add("board-status-buffering");
    return;
  }
  indicator.classList.add("board-status-hidden");
};

Tools.clearBoardCursors = function clearBoardCursors() {
  const cursors = Tools.svg.getElementById("cursors");
  if (cursors) cursors.innerHTML = "";
};

Tools.resetBoardViewport = function resetBoardViewport() {
  if (Tools.drawingArea) Tools.drawingArea.innerHTML = "";
  Tools.clearBoardCursors();
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
    Math.max(0, waitMs + RATE_LIMIT_FLUSH_SAFETY_MS),
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
    Tools.updateCurrentConnectedUserFromActivity(bufferedWrite.message.data);
    if (Tools.socket) Tools.socket.emit("broadcast", bufferedWrite.message);
  }
  Tools.syncWriteStatusIndicator();
};

/**
 * @param {{board: string, data: BoardMessage}} message
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
 * @param {{board: string, data: BoardMessage}} message
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
    Tools.updateCurrentConnectedUserFromActivity(message.data);
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
  Tools.snapshotRevision = 0;
  Tools.preSnapshotMessages = [];
  Tools.incomingBroadcastQueue = [];
  Tools.processingIncomingBroadcast = false;
  Tools.discardBufferedWrites();
  Tools.turnstilePendingWrites = [];
  Tools.hideTurnstileOverlay();
  Object.values(Tools.connectedUsers || {}).forEach((user) => {
    if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  });
  Tools.connectedUsers = {};
  Tools.renderConnectedUsers();
  Tools.clearBoardCursors();
  if (Tools.hasAuthoritativeBoardSnapshot) {
    Tools.hideLoadingMessage();
  } else {
    Tools.showLoadingMessage();
  }
  Object.values(Tools.list || {}).forEach((tool) => {
    if (tool && typeof tool.onSocketDisconnect === "function") {
      tool.onSocketDisconnect();
    }
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
  if (processed) {
    Tools.updateConnectedUsersFromActivity(
      typeof msg.userId === "string" ? msg.userId : undefined,
      msg,
    );
  }
  if (!Tools.awaitingBoardSnapshot) {
    Tools.hideLoadingMessage();
  }
  Tools.syncWriteStatusIndicator();
}

/**
 * @param {BoardMessage} msg
 * @returns {Promise<boolean>}
 */
function processIncomingBroadcast(msg) {
  if (
    BoardMessageReplay.shouldBufferLiveMessage(msg, Tools.awaitingBoardSnapshot)
  ) {
    Tools.preSnapshotMessages.push(Tools.cloneMessage(msg));
    return Promise.resolve(false);
  }

  if (
    Tools.awaitingBoardSnapshot &&
    BoardMessageReplay.isSnapshotMessage(msg)
  ) {
    Tools.resetBoardViewport();
  }

  return handleMessage(msg).then(function afterMessageHandled() {
    if (
      Tools.awaitingBoardSnapshot &&
      BoardMessageReplay.isSnapshotMessage(msg)
    ) {
      Tools.hasAuthoritativeBoardSnapshot = true;
      Tools.snapshotRevision = BoardMessageReplay.normalizeRevision(
        msg.revision,
      );
      Tools.awaitingBoardSnapshot = false;
      Tools.flushBufferedWrites();
      Tools.incomingBroadcastQueue =
        BoardMessageReplay.filterBufferedMessagesAfterSnapshot(
          Tools.preSnapshotMessages,
          Tools.snapshotRevision,
        ).concat(Tools.incomingBroadcastQueue);
      Tools.preSnapshotMessages = [];
    }
    return true;
  });
}

function drainIncomingBroadcastQueue() {
  if (Tools.processingIncomingBroadcast) return;
  Tools.processingIncomingBroadcast = true;

  function drainNext() {
    const msg = Tools.incomingBroadcastQueue.shift();
    if (!msg) {
      Tools.processingIncomingBroadcast = false;
      return;
    }
    processIncomingBroadcast(msg)
      .then(function afterProcess(processed) {
        finalizeIncomingBroadcast(msg, processed);
      })
      .finally(drainNext);
  }

  drainNext();
}

/**
 * @param {BoardMessage} msg
 * @returns {void}
 */
function enqueueIncomingBroadcast(msg) {
  Tools.incomingBroadcastQueue.push(msg);
  drainIncomingBroadcastQueue();
}

Tools.scale = 1.0;
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
          Tools.socket.emit(
            "turnstile_token",
            token,
            (/** @type {unknown} */ result) => {
              const turnstileResult = Tools.normalizeTurnstileAck(result);
              Tools.turnstilePending = false;
              if (turnstileResult.success) {
                Tools.setTurnstileValidation(turnstileResult);
                Tools.hideTurnstileOverlay();
                Tools.flushTurnstilePendingWrites();
              } else {
                Tools.setTurnstileValidation(null);
                Tools.refreshTurnstile();
              }
            },
          );
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
    !MessageCommon.isDrawToolAllowedAtScale(Tools.scale || 1)
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
  const hasServerRenderedToolbar =
    document.querySelector("#tools > .tool[data-tool-name]") !== null;
  if (hasServerRenderedToolbar) {
    return getToolButton(toolName) !== null;
  }
  if (!getToolCatalogEntry(toolName)) return false;
  return shouldDisplayBoardTool(
    toolName,
    Tools.boardState,
    Tools.readOnlyToolNames,
  );
};

Tools.setBoardState(
  parseEmbeddedJson("board-state", {
    readonly: false,
    canWrite: true,
  }),
);

Tools.resolveBoardName = function getBoardNameFromLocation() {
  return resolveBoardName(window.location.pathname);
};

Tools.board = getRequiredElement("board");
Tools.svg = /** @type {SVGSVGElement} */ (
  /** @type {unknown} */ (getRequiredElement("canvas"))
);
Tools.drawingArea = Tools.svg.getElementById("drawingArea");

//Initialization
Tools.curTool = null;
Tools.drawingEvent = true;
Tools.showMarker = true;
Tools.showOtherCursors = true;
Tools.showMyCursor = true;

Tools.isIE = /MSIE|Trident/.test(window.navigator.userAgent);

Tools.socket = null;
Tools.hasConnectedOnce = false;
Tools.socketIOExtraHeaders = (function loadSocketIOExtraHeaders() {
  let extraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
    window.socketio_extra_headers,
  );
  if (extraHeaders) {
    window.socketio_extra_headers = extraHeaders;
    return extraHeaders;
  }
  try {
    const storedHeaders = sessionStorage.getItem("socketio_extra_headers");
    if (storedHeaders) {
      extraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
        JSON.parse(storedHeaders),
      );
      if (extraHeaders) {
        window.socketio_extra_headers = extraHeaders;
        return extraHeaders;
      }
    }
  } catch (err) {
    console.warn("Unable to load Socket.IO extra headers", err);
  }
  return null;
})();

function generateUserSecret() {
  if (
    window.crypto &&
    typeof window.crypto.getRandomValues === "function" &&
    typeof Uint8Array === "function"
  ) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  return (
    Date.now().toString(16) +
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  );
}

Tools.userSecret = (function resolveUserSecret() {
  const key = "wbo-user-secret-v1";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = generateUserSecret();
    localStorage.setItem(key, created);
    return created;
  } catch (err) {
    return generateUserSecret();
  }
})();

Tools.getInitialSocketQuery = function getInitialSocketQuery() {
  return {
    userSecret: Tools.userSecret,
    tool: "Hand",
    color: getRequiredInput("chooseColor").value,
    size: getRequiredInput("chooseSize").value,
  };
};

Tools.connectedUsers = {};
Tools.connectedUsersPanelOpen = false;

function isCurrentSocketUser(/** @type {ConnectedUser} */ user) {
  return !!(
    Tools.socket &&
    typeof Tools.socket.id === "string" &&
    user.socketId === Tools.socket.id
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
 * @param {number | undefined} size
 * @returns {number}
 */
function getConnectedUserDotSize(size) {
  const userSize = Number(size);
  if (!Number.isFinite(userSize) || userSize <= 0) return 8;
  return Math.max(8, Math.min(18, 6 + userSize / 3));
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
  return (
    typeof user.lastFocusX === "number" &&
    Number.isFinite(user.lastFocusX) &&
    typeof user.lastFocusY === "number" &&
    Number.isFinite(user.lastFocusY)
  );
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
  if (child.type === "update") {
    return typeof child.id === "string" ? child.id : null;
  }
  if (child.type === "copy") {
    return typeof child.newid === "string" ? child.newid : null;
  }
  return null;
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

  if (message.tool === "Text" && message.type === "update") {
    return typeof message.id === "string"
      ? getRenderedElementCenterById(message.id)
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
  )},${scale.toFixed(1)}`;
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
    const connectedUser = Tools.connectedUsers[row.dataset.socketId];
    if (!connectedUser || isCurrentSocketUser(connectedUser)) return;
    connectedUser.reported = true;
    updateConnectedUserRow(row, connectedUser);
    Tools.socket.emit("report_user", {
      board: Tools.boardName,
      socketId: connectedUser.socketId,
    });
  });
  row.appendChild(report);

  updateConnectedUserRow(row, user);
  return row;
}

Tools.renderConnectedUsers = function renderConnectedUsers() {
  const list = getConnectedUsersList();
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

  const users = Object.values(Tools.connectedUsers).sort((left, right) =>
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
};

Tools.setConnectedUsersPanelOpen = function setConnectedUsersPanelOpen(
  /** @type {boolean} */ open,
) {
  Tools.connectedUsersPanelOpen = open;
  getConnectedUsersPanel().classList.toggle(
    "connected-users-panel-hidden",
    !open,
  );
  getConnectedUsersToggle().classList.toggle("curTool", open);
};

Tools.upsertConnectedUser = function upsertConnectedUser(
  /** @type {ConnectedUser} */ user,
) {
  Tools.connectedUsers[user.socketId] = Object.assign(
    {},
    Tools.connectedUsers[user.socketId] || {},
    user,
  );
  Tools.renderConnectedUsers();
};

Tools.removeConnectedUser = function removeConnectedUser(
  /** @type {string} */ socketId,
) {
  const user = Tools.connectedUsers[socketId];
  if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  delete Tools.connectedUsers[socketId];
  Tools.renderConnectedUsers();
};

Tools.updateConnectedUsersFromActivity =
  function updateConnectedUsersFromActivity(
    /** @type {string | undefined} */ userId,
    /** @type {BoardMessage} */ message,
  ) {
    // Presence has three layers:
    // - `socketId`: one live browser tab/socket connection. This is the most precise activity target.
    // - `userId`: derived from the persisted per-browser `userSecret`, so multiple tabs from one browser session can share it.
    // - displayed name: combines an IP-derived word with the `userId`, so it is human-readable but not a stable routing key.
    // When a live message includes `socket`, update that exact row only. Falling back to `userId` keeps older/non-live paths working.
    const messageSocketId =
      typeof message.socket === "string" ? message.socket : null;
    if (!userId && messageSocketId === null) return;
    let changed = false;
    const focusPoint = getMessageFocusPoint(message);
    const shouldPulse = message.tool !== "Cursor";
    Object.values(Tools.connectedUsers).forEach((user) => {
      if (messageSocketId !== null) {
        if (user.socketId !== messageSocketId) return;
      } else if (user.userId !== userId) {
        return;
      }
      if (shouldPulse) {
        markConnectedUserActivity(user);
        changed = true;
      }
      if (typeof message.color === "string") {
        user.color = message.color;
        changed = true;
      }
      if (message.size !== undefined) {
        user.size = Number(message.size) || user.size;
        changed = true;
      }
      if (typeof message.tool === "string" && message.tool !== "Cursor") {
        user.lastTool = message.tool;
        changed = true;
      }
      if (
        focusPoint &&
        (message.tool !== "Cursor" ||
          messageSocketId === null ||
          messageSocketId === user.socketId)
      ) {
        user.lastFocusX = focusPoint.x;
        user.lastFocusY = focusPoint.y;
        changed = true;
      }
    });
    if (changed) Tools.renderConnectedUsers();
  };

Tools.updateCurrentConnectedUserFromActivity =
  function updateCurrentConnectedUserFromActivity(
    /** @type {BoardMessage} */ message,
  ) {
    if (!Tools.socket || typeof Tools.socket.id !== "string") return;
    const current = Tools.connectedUsers[Tools.socket.id];
    if (!current) return;
    Tools.updateConnectedUsersFromActivity(
      current.userId,
      Object.assign({}, message, { socket: current.socketId }),
    );
  };

Tools.initConnectedUsersUI = function initConnectedUsersUI() {
  const toggle = getConnectedUsersToggle();
  const label = /** @type {HTMLElement | null} */ (
    toggle.querySelector(".tool-name")
  );
  toggle.title = Tools.i18n.t("users");
  toggle.setAttribute("aria-label", Tools.i18n.t("users"));
  if (label) label.textContent = Tools.i18n.t("users");
  toggle.addEventListener("click", () => {
    Tools.setConnectedUsersPanelOpen(!Tools.connectedUsersPanelOpen);
  });
  toggle.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      Tools.setConnectedUsersPanelOpen(!Tools.connectedUsersPanelOpen);
    }
  });
  Tools.renderConnectedUsers();
};

Tools.initConnectedUsersUI();

Tools.startConnection = () => {
  // Destroy socket if one already exists
  if (Tools.socket) {
    BoardConnection.closeSocket(Tools.socket);
    Tools.socket = null;
  }
  Tools.connectionState = "connecting";
  Object.values(Tools.connectedUsers).forEach((user) => {
    if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  });
  Tools.connectedUsers = {};
  Tools.renderConnectedUsers();

  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const socketParams = BoardConnection.buildSocketParams(
    window.location.pathname,
    Tools.socketIOExtraHeaders,
    params.get("token"),
    Tools.getInitialSocketQuery(),
  );

  const socket = io.connect("", socketParams);
  Tools.socket = socket;

  //Receive draw instructions from the server
  socket.on("connect", function onConnection() {
    Tools.connectionState = "connected";
    if (Tools.hasConnectedOnce && Tools.server_config.TURNSTILE_SITE_KEY) {
      Tools.setTurnstileValidation(null);
      BoardTurnstile.resetTurnstileWidget(
        typeof turnstile !== "undefined" ? turnstile : undefined,
        Tools.turnstileWidgetId,
      );
    }
    Tools.hasConnectedOnce = true;
    if (Tools.hasAuthoritativeBoardSnapshot) {
      Tools.hideLoadingMessage();
    } else {
      Tools.showLoadingMessage();
    }
    Tools.syncWriteStatusIndicator();
    if (Tools.socket) Tools.socket.emit("getboard", Tools.boardName);
  });
  socket.on("broadcast", (/** @type {BoardMessage} */ msg) => {
    enqueueIncomingBroadcast(msg);
  });
  socket.on("boardstate", Tools.setBoardState);
  socket.on(
    "user_joined",
    function onUserJoined(/** @type {ConnectedUser} */ user) {
      Tools.upsertConnectedUser(user);
    },
  );
  socket.on(
    "user_left",
    function onUserLeft(/** @type {{socketId?: string}} */ user) {
      if (typeof user.socketId !== "string") return;
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
  socket.on("disconnect", function onDisconnect() {
    Tools.connectionState = "disconnected";
    Tools.beginAuthoritativeResync();
  });
};
Tools.boardName = Tools.resolveBoardName();

Tools.token = (() => {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  return params.get("token");
})();

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
 * @returns {HTMLElement}
 */
function createToolButton(toolName) {
  const button = document.createElement("li");
  button.className = "tool";
  button.tabIndex = -1;
  button.id = `toolID-${toolName}`;

  const primaryIcon = document.createElement("img");
  primaryIcon.className = "tool-icon";
  primaryIcon.width = 35;
  primaryIcon.height = 35;
  primaryIcon.alt = "icon";
  button.appendChild(primaryIcon);

  const label = document.createElement("span");
  label.className = "tool-name";
  button.appendChild(label);

  const secondaryIcon = document.createElement("img");
  secondaryIcon.className = "tool-icon secondaryIcon";
  secondaryIcon.width = 35;
  secondaryIcon.height = 35;
  secondaryIcon.src = "data:,";
  secondaryIcon.alt = "";
  button.appendChild(secondaryIcon);

  const toolsList = document.getElementById("tools");
  if (!toolsList) {
    throw new Error("Missing tools list.");
  }
  toolsList.appendChild(button);
  bindToolButton(button, toolName);
  return button;
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
 * @param {AppTool} tool
 * @returns {void}
 */
function hydrateToolButton(toolName, tool) {
  const button =
    getToolButton(toolName) ||
    (Tools.shouldDisplayTool(toolName) ? createToolButton(toolName) : null);
  if (!button) return;
  bindToolButton(button, toolName);
  const parts = getRequiredToolButtonParts(toolName);
  parts.label.textContent = Tools.i18n.t(toolName);
  parts.primaryIcon.src = Tools.versionAssetPath(tool.icon);
  parts.primaryIcon.alt = Tools.i18n.t(toolName);
  button.classList.toggle("oneTouch", tool.oneTouch === true);
  button.classList.toggle("hasSecondary", !!tool.secondary);
  parts.primaryIcon.classList.toggle("primaryIcon", !!tool.secondary);
  button.title = tool.shortcut
    ? `${Tools.i18n.t(toolName)} (${Tools.i18n.t("keyboard shortcut")}: ${tool.shortcut})`
    : Tools.i18n.t(toolName);
  if (tool.secondary && parts.secondaryIcon) {
    parts.secondaryIcon.src = Tools.versionAssetPath(tool.secondary.icon);
    parts.secondaryIcon.alt = Tools.i18n.t(tool.secondary.name);
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

Tools.HTML = /** @type {ToolPalette} */ ({
  template: null,
  addShortcut: function addShortcut(key, callback) {
    window.addEventListener("keydown", (e) => {
      if (e.key === key && !isTextEntryTarget(e.target)) {
        callback();
      }
    });
  },
  addTool: function addTool(
    toolName,
    toolIcon,
    toolIconHTML,
    toolShortcut,
    oneTouch,
  ) {
    const tool = Tools.list[toolName];
    if (!tool) {
      throw new Error(`Tool not registered before rendering: ${toolName}`);
    }
    if (toolShortcut) {
      this.addShortcut(toolShortcut, () => {
        void Tools.activateTool(toolName);
        blurActiveElement();
      });
    }
    tool.icon = toolIcon;
    tool.iconHTML = toolIconHTML;
    tool.shortcut = toolShortcut || tool.shortcut;
    tool.oneTouch = oneTouch;
    hydrateToolButton(toolName, tool);
    Tools.syncToolDisabledState(toolName);
    return getToolButton(toolName);
  },
  changeTool: (oldToolName, newToolName) => {
    const oldTool = document.getElementById(`toolID-${oldToolName}`);
    const newTool = document.getElementById(`toolID-${newToolName}`);
    if (oldTool) oldTool.classList.remove("curTool");
    if (newTool) newTool.classList.add("curTool");
  },
  toggle: function toggle(toolName, name, icon) {
    const parts = getRequiredToolButtonParts(toolName);
    const secondaryIcon = parts.secondaryIcon;
    if (!secondaryIcon) {
      throw new Error(`Missing secondary icon for tool ${toolName}`);
    }

    const primaryIconSrc = parts.primaryIcon.src;
    const secondaryIconSrc = secondaryIcon.src;
    parts.primaryIcon.src = secondaryIconSrc;
    secondaryIcon.src = primaryIconSrc;
    parts.primaryIcon.src = Tools.versionAssetPath(icon);
    parts.label.textContent = Tools.i18n.t(name);
  },
  addStylesheet: function addStylesheet(href) {
    const versionedHref = Tools.versionAssetPath(href);
    const existing = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    ).find((link) => link.getAttribute("href") === versionedHref);
    if (existing) return existing;
    const link = document.createElement("link");
    link.href = versionedHref;
    link.rel = "stylesheet";
    link.type = "text/css";
    document.head.appendChild(link);
    return link;
  },
  colorPresetTemplate: new Minitpl("#colorPresetSel .colorPresetButton"),
  addColorButton: function addColorButton(button) {
    const setColor = Tools.setColor.bind(Tools, button.color);
    if (button.key) this.addShortcut(button.key, setColor);
    return this.colorPresetTemplate.add((/** @type {HTMLElement} */ elem) => {
      elem.addEventListener("click", setColor);
      elem.id = `color_${button.color.replace(/^#/, "")}`;
      elem.style.backgroundColor = button.color;
      if (button.key) {
        elem.title = `${Tools.i18n.t("keyboard shortcut")}: ${button.key}`;
      }
    });
  },
});

bindRenderedToolButtons();

Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

/**
 * @param {ToolClass} ToolClass
 * @returns {void}
 */
Tools.registerToolClass = function registerToolClass(ToolClass) {
  const toolName = ToolClass?.toolName;
  if (typeof toolName !== "string" || toolName === "") {
    throw new Error("Tool classes must expose a static toolName.");
  }
  Tools.toolClasses[toolName] = ToolClass;
};

/**
 * @param {string} toolName
 * @returns {Promise<ToolClass | null>}
 */
Tools.ensureToolClassLoaded = async function ensureToolClassLoaded(toolName) {
  const existing = Tools.toolClasses[toolName];
  if (existing) return existing;

  const namespace = /** @type {{default?: unknown}} */ (
    await import(Tools.versionAssetPath(getToolModuleImportPath(toolName)))
  );
  const ToolClass = namespace.default;
  if (typeof ToolClass !== "function") {
    throw new Error(`Missing default tool class export for ${toolName}.`);
  }
  if (ToolClass.toolName !== toolName) {
    throw new Error(
      `Tool module for ${toolName} exported ${String(ToolClass.toolName)}.`,
    );
  }
  Tools.registerToolClass(/** @type {ToolClass} */ (ToolClass));
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
      Tools.HTML.addShortcut(key, () => {
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
 * @returns {ToolPointerListeners}
 */
function deriveListeners(tool) {
  return {
    press:
      typeof tool.press === "function"
        ? tool.press.bind(tool)
        : tool.listeners?.press,
    move:
      typeof tool.move === "function"
        ? tool.move.bind(tool)
        : tool.listeners?.move,
    release:
      typeof tool.release === "function"
        ? tool.release.bind(tool)
        : tool.listeners?.release,
  };
}

/**
 * @param {AppTool} tool
 * @param {"onstart" | "onquit" | "onSocketDisconnect" | "onSizeChange"} key
 */
function bindToolMethod(tool, key) {
  const method = tool[key];
  if (typeof method !== "function") return;
  tool[key] = method.bind(tool);
}

/** @param {AppTool} tool */
function ensureToolDefaults(tool) {
  if (typeof tool.name !== "string") throw new Error("A tool must have a name");
  if (typeof tool.listeners !== "object") {
    tool.listeners = {};
  }
  if (typeof tool.onstart !== "function") {
    tool.onstart = () => {};
  }
  if (typeof tool.onquit !== "function") {
    tool.onquit = () => {};
  }
  if (typeof tool.onMessage !== "function") {
    tool.onMessage = () => {};
  }
  if (typeof tool.onSocketDisconnect !== "function") {
    tool.onSocketDisconnect = () => {};
  }
}

/** @param {AppTool} tool */
function compileToolListeners(tool) {
  const listeners = tool.listeners || {};
  const compiled = tool.compiledListeners || {};
  tool.compiledListeners = compiled;

  /**
   * @param {ToolPointerListener} listener
   * @returns {CompiledToolListener}
   */
  function compile(listener) {
    return function listen(evt) {
      const mouseEvent = /** @type {MouseEvent} */ (evt);
      const x = mouseEvent.pageX / Tools.getScale();
      const y = mouseEvent.pageY / Tools.getScale();
      return listener(x, y, mouseEvent, false);
    };
  }

  /**
   * @param {ToolPointerListener} listener
   * @returns {CompiledToolListener}
   */
  function compileTouch(listener) {
    return function touchListen(evt) {
      const touchEvent = /** @type {TouchEvent} */ (evt);
      if (touchEvent.changedTouches.length === 1) {
        const touch = touchEvent.changedTouches[0];
        if (!touch) return true;
        const x = touch.pageX / Tools.getScale();
        const y = touch.pageY / Tools.getScale();
        return listener(x, y, touchEvent, true);
      }
      return true;
    };
  }

  /**
   * @param {CompiledToolListener} f
   * @returns {CompiledToolListener}
   */
  function wrapUnsetHover(f) {
    return function unsetHover(evt) {
      blurActiveElement();
      return f(evt);
    };
  }

  if (listeners.press) {
    compiled.mousedown = wrapUnsetHover(compile(listeners.press));
    compiled.touchstart = wrapUnsetHover(compileTouch(listeners.press));
  }
  if (listeners.move) {
    compiled.mousemove = compile(listeners.move);
    compiled.touchmove = compileTouch(listeners.move);
  }
  if (listeners.release) {
    const release = compile(listeners.release);
    const releaseTouch = compileTouch(listeners.release);
    compiled.mouseup = release;
    if (!Tools.isIE) compiled.mouseleave = release;
    compiled.touchleave = releaseTouch;
    compiled.touchend = releaseTouch;
    compiled.touchcancel = releaseTouch;
  }
}

/**
 * @param {AppTool} tool
 * @returns {AppTool}
 */
Tools.mountTool = function mountTool(tool) {
  bindToolMethod(tool, "onstart");
  bindToolMethod(tool, "onquit");
  bindToolMethod(tool, "onSocketDisconnect");
  bindToolMethod(tool, "onSizeChange");
  if (!tool.listeners) {
    tool.listeners = deriveListeners(tool);
  }
  if (tool.stylesheet) {
    Tools.HTML.addStylesheet(tool.stylesheet);
  }
  Tools.register(tool);
  if (Tools.shouldDisplayTool(tool.name) || getToolButton(tool.name)) {
    Tools.HTML.addTool(
      tool.name,
      tool.icon,
      tool.iconHTML,
      tool.shortcut || "",
      tool.oneTouch,
    );
  }
  Tools.syncToolDisabledState(tool.name);
  if (tool.alwaysOn === true) {
    Tools.addToolListeners(tool);
  }
  return tool;
};

/**
 * @param {string} toolName
 * @returns {Promise<AppTool | null>}
 */
Tools.bootTool = async function bootTool(toolName) {
  const existingTool = Tools.list[toolName];
  if (existingTool) return existingTool;
  const inFlight = Tools.bootedToolPromises[toolName];
  if (inFlight) return inFlight;

  const promise = Tools.ensureToolClassLoaded(toolName).then(
    async function onToolClassLoaded(ToolClass) {
      if (!ToolClass || typeof ToolClass.boot !== "function") return null;
      const bootedTool = await ToolClass.boot(createToolBootContext(toolName));
      if (!bootedTool) return null;
      return Tools.mountTool(bootedTool);
    },
  );

  Tools.bootedToolPromises[toolName] = promise;
  try {
    return await promise;
  } finally {
    delete Tools.bootedToolPromises[toolName];
  }
};

/**
 * @param {string} toolName
 * @returns {Promise<AppTool | null>}
 */
Tools.ensureToolBooted = function ensureToolBooted(toolName) {
  return Tools.bootTool(toolName);
};

/**
 * @param {string} toolName
 * @returns {Promise<boolean>}
 */
Tools.activateTool = async function activateTool(toolName) {
  if (!Tools.shouldDisplayTool(toolName)) return false;
  const tool = await Tools.ensureToolBooted(toolName);
  if (!tool || !Tools.canUseTool(toolName)) return false;
  return Tools.change(toolName) !== false;
};

/** @param {AppTool} tool */
Tools.isBlocked = function toolIsBanned(tool) {
  return isBlockedToolName(tool.name, Tools.server_config.BLOCKED_TOOLS || []);
};

/**
 * Register a new tool, without touching the User Interface
 */
/** @param {AppTool} newTool */
Tools.register = function registerTool(newTool) {
  if (Tools.isBlocked(newTool)) return;

  if (newTool.name in Tools.list) {
    console.log(
      `Tools.register: The tool '${newTool.name}' is already in the list. Updating it...`,
    );
  }

  ensureToolDefaults(newTool);
  compileToolListeners(newTool);

  //Add the tool to the list
  Tools.list[newTool.name] = newTool;

  // Register the change handlers
  if (newTool.onSizeChange) Tools.sizeChangeHandlers.push(newTool.onSizeChange);

  //There may be pending messages for the tool
  const pending = drainPendingMessages(Tools.pendingMessages, newTool.name);
  if (pending.length > 0) {
    console.log("Drawing pending messages for '%s'.", newTool.name);
    pending.forEach((/** @type {BoardMessage} */ msg) => {
      //Transmit the message to the tool (precising that it comes from the network)
      newTool.draw(msg, false);
    });
  }
};

/** @param {string} toolName */
Tools.change = (toolName) => {
  const newTool = Tools.list[toolName];
  const oldTool = Tools.curTool;
  if (!newTool)
    throw new Error("Trying to select a tool that has never been added!");
  if (Tools.shouldDisableTool(toolName)) return false;
  if (newTool === oldTool) {
    if (newTool.secondary) {
      newTool.secondary.active = !newTool.secondary.active;
      const props = newTool.secondary.active ? newTool.secondary : newTool;
      Tools.HTML.toggle(newTool.name, props.name, props.icon);
      if (newTool.secondary.switch) newTool.secondary.switch();
    }
    return;
  }
  if (!newTool.oneTouch) {
    //Update the GUI
    const curToolName = Tools.curTool ? Tools.curTool.name : "";
    try {
      Tools.HTML.changeTool(curToolName, toolName);
    } catch (e) {
      console.error(`Unable to update the GUI with the new tool. ${e}`);
    }
    Tools.svg.style.cursor = newTool.mouseCursor || "auto";
    Tools.board.title = Tools.i18n.t(newTool.helpText || "");

    //There is not necessarily already a curTool
    if (Tools.curTool !== null) {
      //It's useless to do anything if the new tool is already selected
      if (newTool === Tools.curTool) return;

      //Remove the old event listeners
      Tools.removeToolListeners(Tools.curTool);

      //Call the callbacks of the old tool
      Tools.curTool.onquit && Tools.curTool.onquit(newTool);
    }

    //Add the new event listeners
    Tools.addToolListeners(newTool);
    Tools.curTool = newTool;
  }

  //Call the start callback of the new tool
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
  const message = {
    board: Tools.boardName,
    data: outboundData,
  };
  return Tools.sendBufferedWrite(message);
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

  // Optimistically render the drawing immediately
  tool.draw(data, true);

  if (
    MessageCommon.requiresTurnstile(Tools.boardName, tool.name) &&
    Tools.server_config.TURNSTILE_SITE_KEY &&
    !Tools.isTurnstileValidated()
  ) {
    Tools.queueProtectedWrite(data, tool);
    return true;
  }

  return Tools.send(data, tool.name) !== false;
};

//Object containing the messages that have been received before the corresponding tool
//is loaded. keys : the name of the tool, values : array of messages for this tool
Tools.pendingMessages = {};

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
});

function updateDocumentTitle() {
  document.title =
    (Tools.unreadMessagesCount ? `(${Tools.unreadMessagesCount}) ` : "") +
    `${Tools.boardName} | WBO`;
}

(() => {
  // Scroll and hash handling
  /** @type {ReturnType<typeof setTimeout> | null} */
  let scrollTimeout = null;
  let lastStateUpdate = Date.now();

  window.addEventListener("scroll", function onScroll() {
    const scale = Tools.getScale();
    const x = document.documentElement.scrollLeft / scale;
    const y = document.documentElement.scrollTop / scale;

    if (scrollTimeout !== null) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function updateHistory() {
      const hash = `#${x | 0},${y | 0},${Tools.getScale().toFixed(1)}`;
      if (
        Date.now() - lastStateUpdate > 5000 &&
        hash !== window.location.hash
      ) {
        window.history.pushState({}, "", hash);
        lastStateUpdate = Date.now();
      } else {
        window.history.replaceState({}, "", hash);
      }
    }, 100);
  });

  function setScrollFromHash() {
    const coords = window.location.hash.slice(1).split(",");
    const x = Number(coords[0]) || 0;
    const y = Number(coords[1]) || 0;
    const scale = Number.parseFloat(coords[2] || "");
    resizeCanvas({ x: x, y: y });
    Tools.setScale(scale);
    window.scrollTo(x * scale, y * scale);
  }

  window.addEventListener("hashchange", setScrollFromHash, false);
  window.addEventListener("popstate", setScrollFromHash, false);
  window.addEventListener("DOMContentLoaded", setScrollFromHash, false);
})();

/** @param {BoardMessage} m */
function resizeCanvas(m) {
  //Enlarge the canvas whenever something is drawn near its border
  const x = Number(m.x) | 0;
  const y = Number(m.y) | 0;
  const MAX_BOARD_SIZE = Tools.server_config.MAX_BOARD_SIZE || 65536; // Maximum value for any x or y on the board
  if (x > Tools.svg.width.baseVal.value - 2000) {
    Tools.svg.width.baseVal.value = Math.min(x + 2000, MAX_BOARD_SIZE);
  }
  if (y > Tools.svg.height.baseVal.value - 2000) {
    Tools.svg.height.baseVal.value = Math.min(y + 2000, MAX_BOARD_SIZE);
  }
}

/** @param {BoardMessage} m */
function updateUnreadCount(m) {
  if (
    document.hidden &&
    ["child", "update"].indexOf(typeof m.type === "string" ? m.type : "") === -1
  ) {
    Tools.newUnreadMessage();
  }
}

/** @param {BoardMessage} m */
function notifyToolsOfMessage(m) {
  Object.values(Tools.list || {}).forEach((tool) => {
    if (tool && typeof tool.onMessage === "function") tool.onMessage(m);
  });
}

// List of hook functions that will be applied to messages before sending or drawing them
Tools.messageHooks = [resizeCanvas, updateUnreadCount, notifyToolsOfMessage];

/** @type {ReturnType<typeof setTimeout> | null} */
let scaleTimeout = null;
/** @param {number} scale */
Tools.setScale = function setScale(scale) {
  const fullScale =
    Math.max(window.innerWidth, window.innerHeight) /
    (Number(Tools.server_config.MAX_BOARD_SIZE) || 65536);
  const minScale = Math.max(0.1, fullScale);
  const maxScale = 10;
  if (Number.isNaN(scale)) scale = 1;
  scale = Math.max(minScale, Math.min(maxScale, scale));
  Tools.svg.style.willChange = "transform";
  Tools.svg.style.transform = `scale(${scale})`;
  if (scaleTimeout !== null) clearTimeout(scaleTimeout);
  scaleTimeout = setTimeout(() => {
    Tools.svg.style.willChange = "auto";
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
 * @param {{[key: string]: string | number} | undefined} attrs
 * @returns {SVGElement}
 */
Tools.createSVGElement = function createSVGElement(name, attrs) {
  const elem = /** @type {SVGElement} */ (
    document.createElementNS(Tools.svg.namespaceURI, name)
  );
  if (!attrs || typeof attrs !== "object") return elem;
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

Tools.color_chooser = getRequiredInput("chooseColor");

/** @param {string} color */
Tools.setColor = function setColor(color) {
  Tools.color_chooser.value = color;
};

Tools.getColor = (function color() {
  const colorIndex = (Math.random() * Tools.colorPresets.length) | 0;
  const initialPreset = Tools.colorPresets[colorIndex] ||
    Tools.colorPresets[0] || { color: "#001f3f" };
  const initialColor = initialPreset.color;
  Tools.setColor(initialColor);
  return () => Tools.color_chooser.value;
})();

Tools.colorPresets.forEach(Tools.HTML.addColorButton.bind(Tools.HTML));

Tools.sizeChangeHandlers = [];
Tools.setSize = (function size() {
  const chooser = getRequiredInput("chooseSize");

  function update() {
    const size = MessageCommon.clampSize(chooser.value);
    chooser.value = String(size);
    Tools.sizeChangeHandlers.forEach((handler) => {
      handler(size);
    });
  }
  update();

  chooser.onchange = chooser.oninput = update;
  /**
   * @param {number | string | null | undefined} value
   * @returns {number}
   */
  return (value) => {
    if (value !== null && value !== undefined) {
      chooser.value = String(value);
      update();
    }
    return parseInt(chooser.value, 10);
  };
})();

Tools.getSize = () => Tools.setSize();

Tools.getOpacity = (function opacity() {
  const chooser = getRequiredInput("chooseOpacity");
  const opacityIndicator = getRequiredElement("opacityIndicator");

  function update() {
    chooser.value = String(MessageCommon.clampOpacity(chooser.value));
    opacityIndicator.setAttribute("opacity", chooser.value);
  }
  update();

  chooser.onchange = chooser.oninput = update;
  return () => MessageCommon.clampOpacity(chooser.value);
})();

//Scale the canvas on load
Tools.svg.width.baseVal.value = document.body.clientWidth;
Tools.svg.height.baseVal.value = document.body.clientHeight;

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
  /** @param {MouseEvent} evt */
  function menu_mouseup(evt) {
    menu.removeEventListener("mousemove", menu_mousemove);
    document.removeEventListener("mouseup", menu_mouseup);
  }
  menu.addEventListener("mousedown", menu_mousedown);
})();
