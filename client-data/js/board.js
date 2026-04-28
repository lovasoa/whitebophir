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

import { AppTools } from "./app_tools.js";
import { optimisticPrunePlanForAuthoritativeMessage } from "./authoritative_mutation_effects.js";
import { updateDocumentTitle } from "./board_message_module.js";
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
import { AttachedBoardDomRuntimeModule } from "./board_runtime_core.js";
import {
  buildBoardSvgBaselineUrl,
  parseServedBaselineSvgText,
} from "./board_svg_baseline.js";
import { VIEWPORT_HASH_SCALE_DECIMALS } from "./board_viewport.js";
import { logFrontendEvent as logBoardEvent } from "./frontend_logging.js";
import "./intersect.js";
import { TOOL_BY_ID, TOOL_MODULES_BY_ID } from "../tools/index.js";
import {
  getToolIconPath,
  getToolStylesheetPath,
} from "../tools/tool-defaults.js";
import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { connection as BoardConnection } from "./board_transport.js";
import * as BoardTurnstile from "./board_turnstile.js";
import MessageCommon from "./message_common.js";
import { MutationType } from "./message_tool_metadata.js";
import {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} from "./optimistic_mutation.js";
import { SocketEvents } from "./socket_events.js";

/** @import { AppBoardState, AppInitialPreferences, AppToolsState, AuthoritativeBaseline, AuthoritativeReplayBatch, BoardConnectionState, BoardMessage, BoardStatusView, ClientTrackedMessage, ColorPreset, CompiledToolListener, CompiledToolListeners, ConnectedUser, ConnectedUserMap, HandChildMessage, IncomingBroadcast, LiveBoardMessage, MountedAppTool, MountedAppToolsState, PendingMessages, PendingWrite, RateLimitKind, ServerConfig, SocketHeaders, ToolBootContext, ToolModule, ToolPointerListener, ToolPointerListeners, ToolRuntimeState } from "../../types/app-runtime" */
/** @typedef {HTMLLIElement} ConnectedUserRow */
/** @typedef {{tool: import("../tools/tool-order.js").ToolCode, type?: unknown, id?: unknown, txt?: unknown, _children?: unknown, clientMutationId?: string, socket?: string, userId?: string, color?: string, size?: number | string}} RuntimeBoardMessage */
/** @type {AppToolsState} */
let Tools;

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
  Tools.dom = new AttachedBoardDomRuntimeModule(
    boardElement,
    canvasElement,
    baseline.drawingArea,
  );
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

export class ToolRegistryModule {
  constructor() {
    this.current =
      /** @type {import("../../types/app-runtime").MaybeMountedAppTool} */ (
        null
      );
    this.mounted =
      /** @type {import("../../types/app-runtime").MountedToolRegistry} */ ({});
    this.bootPromises =
      /** @type {import("../../types/app-runtime").ToolNameMap<import("../../types/app-runtime").MountedAppToolPromise>} */ ({});
    this.bootedNames = new Set();
    this.pendingMessages = /** @type {PendingMessages} */ ({});
  }

  /**
   * @param {ToolModule} toolModule
   * @param {ToolRuntimeState} toolState
   * @param {string} toolName
   */
  mountTool(toolModule, toolState, toolName) {
    const mountedTool = createMountedTool(toolModule, toolState, toolName);
    if (mountedTool.stylesheet) {
      addToolStylesheet(mountedTool.stylesheet);
    }
    if (this.isBlocked(mountedTool)) return null;

    if (toolName in this.mounted) {
      logBoardEvent("warn", "tool.mount_replaced", {
        toolName,
      });
    }

    this.mounted[toolName] = mountedTool;

    if (mountedTool.onSizeChange) {
      Tools.preferences.sizeChangeHandlers.push(mountedTool.onSizeChange);
    }

    const pending = drainPendingMessages(this.pendingMessages, toolName);
    if (pending.length > 0) {
      logBoardEvent("log", "tool.pending_replayed", {
        toolName,
        count: pending.length,
      });
      pending.forEach((/** @type {BoardMessage} */ msg) => {
        mountedTool.draw(msg, false);
      });
    }
    if (this.shouldDisplayTool(toolName)) {
      syncMountedToolButton(toolName);
    }
    this.syncToolDisabledState(toolName);
    if (mountedTool.alwaysOn === true) {
      this.addToolListeners(mountedTool);
    }
    normalizeServerRenderedElementsForTool(mountedTool);
    return mountedTool;
  }

  /** @param {string} toolName */
  async bootTool(toolName) {
    const existingTool = this.mounted[toolName];
    if (existingTool) return existingTool;
    const inFlight = this.bootPromises[toolName];
    if (inFlight) return inFlight;

    const promise = bootToolPromise(toolName);
    this.bootPromises[toolName] = promise;
    try {
      return await promise;
    } finally {
      delete this.bootPromises[toolName];
    }
  }

  /** @param {string} toolName */
  async activateTool(toolName) {
    if (!this.shouldDisplayTool(toolName)) return false;
    const tool = await this.bootTool(toolName);
    if (!tool || !this.canUseTool(toolName)) return false;
    if (
      tool.requiresWritableBoard === true &&
      !Tools.writes.canBufferWrites()
    ) {
      await Tools.writes.whenBoardWritable();
      if (!this.canUseTool(toolName)) return false;
    }
    return this.change(toolName) !== false;
  }

  /** @param {MountedAppTool} tool */
  addToolListeners(tool) {
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
  removeToolListeners(tool) {
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

  syncActiveToolInputPolicy() {
    Tools.viewportState.controller.setTouchPolicy(
      this.current?.getTouchPolicy?.() || "app-gesture",
    );
  }

  /** @param {string} toolName */
  shouldDisableTool(toolName) {
    return (
      MessageCommon.isDrawTool(toolName) &&
      !MessageCommon.isDrawToolAllowedAtScale(Tools.viewportState.scale)
    );
  }

  /** @param {string} toolName */
  shouldDisplayTool(toolName) {
    return getToolButton(toolName) !== null;
  }

  /** @param {string} toolName */
  canUseTool(toolName) {
    return (
      this.shouldDisplayTool(toolName) && !this.shouldDisableTool(toolName)
    );
  }

  /** @param {string} toolName */
  syncToolDisabledState(toolName) {
    const toolElem = document.getElementById(`toolID-${toolName}`);
    if (!toolElem) return;
    const disabled = this.shouldDisableTool(toolName);
    toolElem.classList.toggle("disabledTool", disabled);
    toolElem.setAttribute("aria-disabled", disabled ? "true" : "false");
  }

  /** @param {boolean} force */
  syncDrawToolAvailability(force) {
    const drawToolsAllowed = MessageCommon.isDrawToolAllowedAtScale(
      Tools.viewportState.scale,
    );
    if (!force && drawToolsAllowed === Tools.viewportState.drawToolsAllowed) {
      return;
    }
    Tools.viewportState.drawToolsAllowed = drawToolsAllowed;

    Object.keys(this.mounted || {}).forEach((toolName) => {
      this.syncToolDisabledState(toolName);
    });

    if (
      !drawToolsAllowed &&
      this.current &&
      MessageCommon.isDrawTool(this.current.name) &&
      this.mounted.hand
    ) {
      this.change("hand");
    }
  }

  /** @param {MountedAppTool} tool */
  isBlocked(tool) {
    return isBlockedToolName(
      tool.name,
      Tools.config.serverConfig.BLOCKED_TOOLS || [],
    );
  }

  /** @param {string} toolName */
  change(toolName) {
    const newTool = this.mounted[toolName];
    const oldTool = this.current;
    if (!newTool)
      throw new Error("Trying to select a tool that has never been added!");
    if (this.shouldDisableTool(toolName)) return false;
    if (newTool === oldTool) {
      toggleSecondaryTool(newTool);
      return;
    }
    if (!newTool.oneTouch) {
      updateCurrentToolChrome(toolName, newTool);
      replaceCurrentTool(newTool);
    }

    if (newTool.onstart) newTool.onstart(oldTool);
    this.syncActiveToolInputPolicy();
    return true;
  }
}

export class ReplayModule {
  constructor() {
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
    const dom = getAttachedBoardDom();
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
    normalizeServerRenderedElements();
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

export class ConnectionModule {
  constructor() {
    this.socket = null;
    this.state = /** @type {BoardConnectionState} */ ("idle");
    this.hasConnectedOnce = false;
    this.socketIOExtraHeaders = /** @type {SocketHeaders | null} */ (null);
  }

  start() {
    const reusableSocket =
      this.socket && !this.socket.connected ? this.socket : null;
    if (this.socket && !reusableSocket) {
      BoardConnection.closeSocket(this.socket);
      this.socket = null;
    }
    this.state = "connecting";
    Tools.replay.awaitingSnapshot = true;
    Tools.presence.clearConnectedUsers();

    void (async () => {
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
        this.socketIOExtraHeaders,
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
        reusableSocket.connect();
        return;
      }

      const socket = io.connect("", socketParams);
      this.socket = socket;

      //Receive draw instructions from the server
      socket.on(SocketEvents.CONNECT, function onConnection() {
        const hadConnectedBefore = Tools.connection.hasConnectedOnce;
        Tools.connection.state = "connected";
        logBoardEvent(
          "log",
          hadConnectedBefore ? "socket.reconnected" : "socket.connected",
        );
        if (
          hadConnectedBefore &&
          Tools.config.serverConfig.TURNSTILE_SITE_KEY
        ) {
          Tools.turnstile.setValidation(null);
          BoardTurnstile.resetTurnstileWidget(
            BoardTurnstile.getTurnstileApi(),
            Tools.turnstile.widgetId,
          );
        }
        Tools.connection.hasConnectedOnce = true;
        Tools.status.syncWriteStatusIndicator();
      });
      socket.on(SocketEvents.BROADCAST, (msg) => {
        enqueueIncomingBroadcast(msg);
      });
      socket.on(SocketEvents.BOARDSTATE, (boardState) => {
        Tools.access.applyBoardState(boardState);
      });
      socket.on(
        SocketEvents.MUTATION_REJECTED,
        function onMutationRejected(payload) {
          if (payload.clientMutationId) {
            Tools.optimistic.rejectMutation(
              payload.clientMutationId,
              payload.reason,
            );
          }
          Tools.status.showUnknownMutationError(payload.reason);
        },
      );
      socket.on(SocketEvents.CONNECT_ERROR, function onConnectError(error) {
        if (socket !== Tools.connection.socket) return;
        const data = error.data;
        const reason = data?.reason || error.message || "connect_error";
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
      });
      socket.on(SocketEvents.USER_JOINED, function onUserJoined(user) {
        Tools.presence.upsertConnectedUser(user);
      });
      socket.on(SocketEvents.USER_LEFT, function onUserLeft(user) {
        Tools.presence.removeConnectedUser(user.socketId);
      });
      socket.on(SocketEvents.RATE_LIMITED, function onRateLimited(payload) {
        const retryAfterMs = payload.retryAfterMs;
        Tools.writes.serverRateLimitedUntil =
          Date.now() + Math.max(0, retryAfterMs);
        Tools.status.showRateLimitNotice(
          Tools.i18n.t("rate_limit_disconnect_message"),
          retryAfterMs,
        );
        Tools.status.syncWriteStatusIndicator();
      });
      socket.on(SocketEvents.DISCONNECT, function onDisconnect(reason) {
        if (socket !== Tools.connection.socket) return;
        if (reason === "io client disconnect") return;
        Tools.connection.state = "disconnected";
        logBoardEvent("warn", "socket.disconnected", { reason });
        Tools.replay.beginAuthoritativeResync();
        scheduleSocketReconnect();
      });
      socket.connect();
    })();
  }
}

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

/** @param {number} [delayMs] */
function scheduleSocketReconnect(delayMs = 250) {
  window.setTimeout(() => Tools.connection.start(), Math.max(0, delayMs));
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
  if (!selector || !normalizeElement) return;

  dom.drawingArea
    .querySelectorAll(selector)
    .forEach((/** @type {Element} */ element) => {
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

/**
 * @param {BoardMessage} message
 * @param {Set<string>} invalidatedIds
 * @returns {boolean}
 */
function messageReferencesInvalidatedId(message, invalidatedIds) {
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

/**
 * Takes ownership of data. Callers must not mutate it after queueing.
 * @param {ClientTrackedMessage} data
 */
function queueProtectedWrite(data) {
  const hadPendingWrites = Tools.turnstile.pendingWrites.length > 0;
  Tools.turnstile.pendingWrites.push({ data });
  if (hadPendingWrites) return;
  const toolName = TOOL_ID_BY_CODE[data.tool];
  logBoardEvent("log", "turnstile.write_queued", {
    toolName,
    clientMutationId: data.clientMutationId,
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
function completeAuthoritativeReplay(replayedToSeq) {
  Tools.replay.hasAuthoritativeSnapshot = true;
  Tools.replay.authoritativeSeq = replayedToSeq;
  Tools.replay.awaitingSnapshot = false;
  Tools.replay.refreshBaselineBeforeConnect = false;
  Tools.writes.flushBufferedWrites();
  Tools.replay.incomingBroadcastQueue =
    BoardMessageReplay.filterBufferedMessagesAfterSeqReplay(
      Tools.replay.preSnapshotMessages,
      Tools.replay.authoritativeSeq,
    ).concat(Tools.replay.incomingBroadcastQueue);
  Tools.replay.preSnapshotMessages = [];
  Tools.status.syncWriteStatusIndicator();
}

/**
 * @param {AuthoritativeReplayBatch} batch
 * @returns {Promise<boolean>}
 */
async function processAuthoritativeReplayBatch({ fromSeq, seq, _children }) {
  if (
    fromSeq !== Tools.replay.authoritativeSeq ||
    seq < fromSeq ||
    _children.length !== seq - fromSeq
  ) {
    logBoardEvent("warn", "replay.batch_gap", {
      authoritativeSeq: Tools.replay.authoritativeSeq,
      fromSeq,
      toSeq: seq,
      childCount: _children.length,
    });
    Tools.replay.beginAuthoritativeResync();
    Tools.connection.start();
    return false;
  }

  for (const [index, child] of _children.entries()) {
    await handleMessage(child);
    Tools.replay.authoritativeSeq = fromSeq + index + 1;
  }
  completeAuthoritativeReplay(seq);
  return true;
}

/**
 * @param {IncomingBroadcast} msg
 * @returns {Promise<boolean>}
 */
async function processIncomingBroadcast(msg) {
  if (BoardMessageReplay.isAuthoritativeReplayBatch(msg)) {
    return processAuthoritativeReplayBatch(msg);
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
      Tools.connection.start();
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
    await handleMessage(replayMessage);
  }
  if (isSequencedBroadcast) {
    Tools.replay.authoritativeSeq = msg.seq;
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

//Initialization
document.documentElement.dataset.activeToolSecondary = "false";
export class PresenceModule {
  constructor() {
    this.users = /** @type {ConnectedUserMap} */ ({});
    this.panelOpen = false;
  }

  clearConnectedUsers() {
    Object.values(this.users).forEach((user) => {
      if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
    });
    this.users = /** @type {ConnectedUserMap} */ ({});
    this.renderConnectedUsers();
  }

  renderConnectedUsers() {
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
        rowsBySocketId[child.dataset.socketId] =
          /** @type {ConnectedUserRow} */ (child);
      }
    });

    const users = Object.values(this.users).sort((left, right) =>
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
    if (users.length === 0 && this.panelOpen) {
      this.setConnectedUsersPanelOpen(false);
    }
    syncConnectedUsersToggleLabel();
  }

  /** @param {boolean} open */
  setConnectedUsersPanelOpen(open) {
    const shouldOpen = open && getConnectedUsersCount() > 0;
    const panel = getConnectedUsersPanel();
    const toggle = getConnectedUsersToggle();
    this.panelOpen = shouldOpen;
    panel.classList.toggle("connected-users-panel-hidden", !shouldOpen);
    toggle.classList.toggle("board-presence-toggle-open", shouldOpen);
    toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  }

  /** @param {ConnectedUser} user */
  upsertConnectedUser(user) {
    this.users[user.socketId] = Object.assign(
      {},
      this.users[user.socketId] || {},
      user,
    );
    this.renderConnectedUsers();
  }

  /** @param {string} socketId */
  removeConnectedUser(socketId) {
    const user = this.users[socketId];
    if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
    delete this.users[socketId];
    this.renderConnectedUsers();
  }

  /**
   * @param {string | undefined} userId
   * @param {BoardMessage} message
   */
  updateConnectedUsersFromActivity(userId, message) {
    // Presence has three layers:
    // - `socketId`: one live browser tab/socket connection. This is the most precise activity target.
    // - `userId`: derived server-side from the shared user-secret cookie, so multiple tabs from one browser profile can share it.
    // - displayed name: combines an IP-derived word with the `userId`, so it is human-readable but not a stable routing key.
    // When a live message includes `socket`, update that exact row only. Falling back to `userId` keeps older/non-live paths working.
    const messageSocketId = message.socket || null;
    if (!userId && messageSocketId === null) return;
    let changed = false;
    const focusPoint = getMessageFocusPoint(message);
    Object.values(this.users).forEach((user) => {
      if (!connectedUserMatchesActivity(user, userId, messageSocketId)) return;
      changed =
        applyConnectedUserActivity(
          user,
          message,
          focusPoint,
          messageSocketId,
        ) || changed;
    });
    if (changed) this.renderConnectedUsers();
  }

  /** @param {BoardMessage} message */
  updateCurrentConnectedUserFromActivity(message) {
    if (!Tools.connection.socket?.id) return;
    const current = this.users[Tools.connection.socket.id];
    if (!current) return;
    this.updateConnectedUsersFromActivity(
      current.userId,
      Object.assign({}, message, { socket: current.socketId }),
    );
  }

  initConnectedUsersUI() {
    const toggle = document.getElementById("connectedUsersToggle");
    const panel = document.getElementById("connectedUsersPanel");
    if (!(toggle instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      return;
    }
    this.panelOpen = toggle.getAttribute("aria-expanded") === "true";
    syncConnectedUsersToggleLabel();
    if (toggle.dataset.connectedUsersUiBound !== "true") {
      toggle.dataset.connectedUsersUiBound = "true";
      toggle.addEventListener("click", () => {
        this.setConnectedUsersPanelOpen(!this.panelOpen);
      });
      toggle.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (
            !panel.matches(":hover") &&
            !panel.contains(document.activeElement) &&
            document.activeElement !== toggle
          ) {
            this.setConnectedUsersPanelOpen(false);
          }
        }, 0);
      });
      panel.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape") {
          evt.preventDefault();
          this.setConnectedUsersPanelOpen(false);
          toggle.focus();
        }
      });
    }
    this.renderConnectedUsers();
  }
}

function isCurrentSocketUser(/** @type {ConnectedUser} */ user) {
  return !!(
    Tools.connection.socket?.id && user.socketId === Tools.connection.socket.id
  );
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
      child.type === MutationType.UPDATE
        ? child.id
        : child.type === MutationType.COPY
          ? child.newid
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
  if ("_children" in message) {
    return getBatchFocusPoint(message._children);
  }

  if ("x" in message) {
    return { x: message.x, y: message.y };
  }

  if (message.type === MutationType.UPDATE && "id" in message) {
    const element = document.getElementById(message.id);
    return element instanceof SVGGraphicsElement
      ? getBoundsCenter(getRenderedElementBounds(element))
      : null;
  }

  return getBoundsCenter(MessageCommon.getEffectiveGeometryBounds(message));
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
  const runtimeToolId = TOOL_ID_BY_CODE[message.tool];
  const isCursorMessage = runtimeToolId === "cursor";

  if (!isCursorMessage) {
    markConnectedUserActivity(user);
    changed = true;
  }
  if ("color" in message) {
    user.color = message.color;
    changed = true;
  }
  if ("size" in message) {
    user.size = message.size || user.size;
    changed = true;
  }
  if (!isCursorMessage) {
    user.lastTool = runtimeToolId;
    changed = true;
  }
  if (
    focusPoint &&
    (!isCursorMessage ||
      messageSocketId === null ||
      messageSocketId === user.socketId)
  ) {
    user.lastFocusX = /** @type {{x: number, y: number}} */ (focusPoint).x;
    user.lastFocusY = /** @type {{x: number, y: number}} */ (focusPoint).y;
    changed = true;
  }
  return changed;
}

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
  const setColor = () => Tools.preferences.setColor(button.color);
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
  if (!isRegisteredToolId(toolName)) {
    throw new Error(`Unknown tool module: ${toolName}.`);
  }
  return /** @type {ToolModule} */ (TOOL_MODULES_BY_ID[toolName]);
}

/**
 * @param {string} toolName
 * @returns {toolName is keyof typeof TOOL_MODULES_BY_ID}
 */
function isRegisteredToolId(toolName) {
  return Object.hasOwn(TOOL_MODULES_BY_ID, toolName);
}

/**
 * @param {MountedAppToolsState} mountedTools
 */
export function createToolRuntimeModules(mountedTools) {
  return {
    board: mountedTools.dom,
    coordinates: mountedTools.coordinates,
    viewport: mountedTools.viewportState.controller,
    writes: {
      /** @param {RuntimeBoardMessage} message */
      drawAndSend(message) {
        return mountedTools.writes.drawAndSend(message);
      },
      /** @param {RuntimeBoardMessage} message */
      send(message) {
        return mountedTools.writes.send(message);
      },
      canBufferWrites() {
        return mountedTools.writes.canBufferWrites();
      },
      whenBoardWritable() {
        return mountedTools.writes.whenBoardWritable();
      },
    },
    identity: mountedTools.identity,
    preferences: {
      getColor() {
        return mountedTools.preferences.getColor();
      },
      getSize() {
        return mountedTools.preferences.getSize();
      },
      /** @param {number | string | null | undefined} size */
      setSize(size) {
        return mountedTools.preferences.setSize(size);
      },
      getOpacity() {
        return mountedTools.preferences.getOpacity();
      },
    },
    rateLimits: {
      /** @param {RateLimitKind} kind */
      getEffectiveRateLimit(kind) {
        return mountedTools.rateLimits.getEffectiveRateLimit(kind);
      },
    },
    toolRegistry: {
      get current() {
        return mountedTools.toolRegistry.current;
      },
      /** @param {string} toolName */
      change(toolName) {
        return mountedTools.toolRegistry.change(toolName);
      },
    },
    interaction: {
      get drawingEvent() {
        return mountedTools.interaction.drawingEvent;
      },
      set drawingEvent(value) {
        mountedTools.interaction.drawingEvent = value;
      },
      get showMarker() {
        return mountedTools.interaction.showMarker;
      },
      set showMarker(value) {
        mountedTools.interaction.showMarker = value;
      },
      get showMyCursor() {
        return mountedTools.interaction.showMyCursor;
      },
      set showMyCursor(value) {
        mountedTools.interaction.showMyCursor = value;
      },
    },
    config: mountedTools.config,
    ids: mountedTools.ids,
    messages: {
      /** @param {RuntimeBoardMessage} message */
      messageForTool(message) {
        return mountedTools.messages.messageForTool(
          /** @type {BoardMessage} */ (/** @type {unknown} */ (message)),
        );
      },
    },
    permissions: {
      get canWrite() {
        return mountedTools.access.canWrite;
      },
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
    assetUrl(assetFile) {
      return mountedTools.assets.getToolAssetUrl(toolName, assetFile);
    },
  };
}

/**
 * @param {ToolModule} toolModule
 * @param {ToolRuntimeState} toolState
 * @param {string} toolName
 * @returns {MountedAppTool}
 */
function createMountedTool(toolModule, toolState, toolName) {
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
  const toolDefinition = TOOL_BY_ID[toolName];
  /** @type {MountedAppTool} */
  const tool = {
    name: toolName,
    shortcut: toolModule.shortcut,
    icon: "",
    draw: (message, isLocal) => draw(toolState, message, isLocal),
    normalizeServerRenderedElement: normalizeServerRenderedElement
      ? (element) => normalizeServerRenderedElement(toolState, element)
      : undefined,
    serverRenderedElementSelector: toolModule.serverRenderedElementSelector,
    press: press
      ? (x, y, evt, isTouchEvent) => press(toolState, x, y, evt, isTouchEvent)
      : undefined,
    move: move
      ? (x, y, evt, isTouchEvent) => move(toolState, x, y, evt, isTouchEvent)
      : undefined,
    release: release
      ? (x, y, evt, isTouchEvent) => release(toolState, x, y, evt, isTouchEvent)
      : undefined,
    onMessage: onMessage
      ? (message) => onMessage(toolState, message)
      : () => {},
    listeners: {},
    compiledListeners: {},
    onstart: onstart ? (oldTool) => onstart(toolState, oldTool) : () => {},
    onquit: onquit ? (newTool) => onquit(toolState, newTool) : () => {},
    onSocketDisconnect: onSocketDisconnect
      ? () => onSocketDisconnect(toolState)
      : () => {},
    onMutationRejected: onMutationRejected
      ? (message, reason) => onMutationRejected(toolState, message, reason)
      : undefined,
    stylesheet: undefined,
    oneTouch: toolModule.oneTouch,
    alwaysOn: toolModule.alwaysOn,
    mouseCursor: toolModule.mouseCursor ?? toolState.mouseCursor,
    helpText: toolModule.helpText,
    secondary: toolState.secondary ?? toolModule.secondary ?? null,
    onSizeChange: onSizeChange
      ? (size) => onSizeChange(toolState, size)
      : undefined,
    getTouchPolicy: getTouchPolicy
      ? () => getTouchPolicy(toolState)
      : undefined,
    showMarker: toolModule.showMarker,
    requiresWritableBoard: toolModule.requiresWritableBoard,
    touchListenerOptions,
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
 * @param {string} toolName
 * @returns {Promise<MountedAppTool | null>}
 */
async function bootToolPromise(toolName) {
  const toolModule = await loadToolModule(toolName);
  const toolState = /** @type {ToolRuntimeState} */ (
    await toolModule.boot(createToolBootContext(toolName))
  );
  return Tools.toolRegistry.mountTool(toolModule, toolState, toolName);
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
 * Call messageForTool recursively on the message and its children.
 * @param {BoardMessage} message
 * @returns {Promise<void>}
 */
function handleMessage(message) {
  pruneBufferedWritesForInvalidatingMessage(message);
  Tools.messages.messageForTool(message);
  return Promise.resolve();
}

window.addEventListener("focus", () => {
  Tools.messages.unreadCount = 0;
  updateDocumentTitle(Tools.messages, Tools.identity);
  if (Tools.writes.bufferedWrites.length > 0) {
    Tools.writes.flushBufferedWrites();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Tools.writes.bufferedWrites.length > 0) {
    Tools.writes.flushBufferedWrites();
  }
});

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
const initialPreferences = {
  tool: "hand",
  color: initialPreset?.color || "#001f3f",
  size: DEFAULT_INITIAL_SIZE,
  opacity: DEFAULT_INITIAL_OPACITY,
};
Tools = new AppTools({
  translations: /** @type {{[key: string]: string}} */ (
    parseEmbeddedJson("translations", {})
  ),
  serverConfig: /** @type {ServerConfig} */ (
    parseEmbeddedJson("configuration", {})
  ),
  boardName: resolveBoardName(window.location.pathname),
  token: new URL(window.location.href).searchParams.get("token"),
  socketIOExtraHeaders,
  colorPresets,
  initialPreferences,
  logBoardEvent,
  queueProtectedWrite,
  flushPendingWrites,
  createToolRegistry: () => new ToolRegistryModule(),
  createReplayModule: () => new ReplayModule(),
  createConnectionModule: () => new ConnectionModule(),
  createPresenceModule: () => new PresenceModule(),
});
window.WBOApp = Tools;
Tools.access.applyBoardState(
  normalizeBoardState(
    parseEmbeddedJson("board-state", {
      readonly: false,
      canWrite: true,
    }),
  ),
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
