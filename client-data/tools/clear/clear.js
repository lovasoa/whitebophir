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
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

export default class ClearTool {
  static toolName = "Clear";

  /**
   * @param {ClearToolRegistry} tools
   */
  constructor(tools) {
    this.tools = tools;
    this.name = "Clear";
    this.shortcut = "c";
    this.icon = "tools/clear/clear.svg";
    this.oneTouch = true;
    this.mouseCursor = "crosshair";
  }

  onstart() {
    /** @type {ClearMessage} */
    const msg = {
      type: "clear",
      id: "",
      token: this.tools.token,
    };
    const clearTool = this.tools.list.Clear;
    if (!clearTool) {
      throw new Error("Clear: tool is not registered.");
    }
    this.tools.drawAndSend(msg, clearTool);
  }

  draw() {
    if (!this.tools.drawingArea) {
      throw new Error("Clear: Missing drawing area.");
    }
    this.tools.drawingArea.innerHTML = "";
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<ClearTool>}
   */
  static async boot(ctx) {
    return new ClearTool(ctx.runtime.Tools);
  }
}

/** @param {ClearToolRegistry} tools */
export function registerClearTool(tools) {
  const tool = new ClearTool(tools);
  tools.add(tool);
  return tool;
}
