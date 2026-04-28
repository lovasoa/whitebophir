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
import * as BoardMessageReplay from "./board_message_replay.js";
import { parseEmbeddedJson, resolveBoardName } from "./board_page_state.js";
import {
  createInitialPreferences,
  DEFAULT_COLOR_PRESETS,
} from "./board_shell_module.js";
import { logFrontendEvent as logBoardEvent } from "./frontend_logging.js";
import "./intersect.js";
import { connection as BoardConnection } from "./board_transport.js";

/** @import { AppToolsState, ServerConfig, SocketHeaders } from "../../types/app-runtime" */
/** @type {AppToolsState} */
let Tools;

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
const colorPresets = DEFAULT_COLOR_PRESETS;
const initialPreferences = createInitialPreferences(colorPresets);
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
});
window.WBOApp = Tools;
Tools.shell.initializePageChrome();
