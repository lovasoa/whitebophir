/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2020  Ophir LOJKINE
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

/** @typedef {{type: "clear", id: string, token?: string | null}} ClearMessage */
/** @typedef {{list: {[name: string]: any}, drawAndSend: (message: ClearMessage, tool: any) => void, token?: string | null, drawingArea: HTMLElement | null, add: (tool: any) => void}} ClearToolRegistry */

/** @param {ClearToolRegistry} tools */
function clearBoard(tools) {
  /** @type {ClearMessage} */
  const msg = {
    type: "clear",
    id: "",
    token: tools.token,
  };
  const clearTool = tools.list.Clear;
  if (!clearTool) {
    throw new Error("Clear: tool is not registered.");
  }
  tools.drawAndSend(msg, clearTool);
}

/** @param {ClearToolRegistry} tools */
function draw(tools) {
  if (!tools.drawingArea) {
    throw new Error("Clear: Missing drawing area.");
  }
  tools.drawingArea.innerHTML = "";
}

/** @param {ClearToolRegistry} tools */
export function registerClearTool(tools) {
  tools.add({
    //The new tool
    name: "Clear",
    shortcut: "c",
    listeners: {},
    icon: "tools/clear/clear.svg",
    oneTouch: true,
    onstart: () => {
      clearBoard(tools);
    },
    draw: () => {
      draw(tools);
    },
    mouseCursor: "crosshair",
  });
}
