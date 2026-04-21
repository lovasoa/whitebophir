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

import { MutationType } from "../../js/mutation_type.js";

/** @typedef {{type: number, id: string, token?: string | null}} ClearMessage */
/** @typedef {import("../../../types/app-runtime").MountedAppToolsState} MountedAppToolsState */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {{tools: MountedAppToolsState}} ClearState */

export const toolId = "clear";
export const shortcut = "c";
export const oneTouch = true;
export const requiresWritableBoard = true;
export const mouseCursor = "crosshair";
export const moderatorOnly = true;
export const liveMessageFields = { clear: {} };

/** @param {ClearState} state */
export function onstart(state) {
  /** @type {ClearMessage} */
  const msg = {
    type: MutationType.CLEAR,
    id: "",
    token: state.tools.token,
  };
  state.tools.drawAndSend(msg, toolId);
}

/** @param {ClearState} state */
export function draw(state) {
  state.tools.drawingArea.innerHTML = "";
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  return { tools: ctx.runtime.Tools };
}
