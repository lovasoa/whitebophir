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
  getRequiredElement,
  normalizeBoardState,
  parseEmbeddedJson,
  resolveBoardName,
  updateRecentBoards,
} from "./board_page_state.js";
import { addToolShortcut } from "./board_tool_registry_module.js";
import { logFrontendEvent as logBoardEvent } from "./frontend_logging.js";
import "./intersect.js";
import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { connection as BoardConnection } from "./board_transport.js";
import MessageCommon from "./message_common.js";
import {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} from "./optimistic_mutation.js";

/** @import { AppToolsState, AuthoritativeReplayBatch, BoardMessage, ClientTrackedMessage, ColorPreset, IncomingBroadcast, PendingWrite, ServerConfig, SocketHeaders } from "../../types/app-runtime" */
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
  const dom = Tools.attachDom(
    boardElement,
    canvasElement,
    baseline.drawingArea,
  );
  Tools.replay.authoritativeSeq = baseline.authoritativeSeq;
  dom.svg.width.baseVal.value = Math.max(
    dom.svg.width.baseVal.value,
    document.body.clientWidth,
  );
  dom.svg.height.baseVal.value = Math.max(
    dom.svg.height.baseVal.value,
    document.body.clientHeight,
  );
  Tools.toolRegistry.normalizeServerRenderedElements();
  Tools.toolRegistry.syncActiveToolInputPolicy();
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
  enqueueIncomingBroadcast,
});
window.WBOApp = Tools;
Tools.toolRegistry.bindRenderedToolButtons();
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
