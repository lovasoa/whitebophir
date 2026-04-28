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

import {
  getMutationType,
  MutationType,
} from "../../js/message_tool_metadata.js";
import { logFrontendEvent } from "../../js/frontend_logging.js";
import { ToolCodes } from "../tool-order.js";

/** @import { ToolBootContext } from "../../../types/app-runtime" */
/** @typedef {ReturnType<typeof createDeleteMessage>} EraserDeleteMessage */
/** @typedef {EraserDeleteMessage} EraserMessage */
/** @typedef {{preventDefault(): void, target: EventTarget | null, type?: string, touches?: TouchList}} EraserPointerEvent */
/** @typedef {ReturnType<typeof boot>} EraserState */

export const toolId = "eraser";
export const shortcut = "e";
export const mouseCursor = "crosshair";
export const showMarker = true;
export const liveMessageFields = /** @type {const} */ ({
  [MutationType.DELETE]: { id: "id" },
});

/**
 * @param {EventTarget | null} elem
 * @returns {elem is Element}
 */
function isElement(elem) {
  return !!(elem && typeof elem === "object" && "parentNode" in elem);
}

/**
 * @param {EventTarget | null} elem
 * @returns {elem is Element & {id: string}}
 */
function isErasableElement(elem) {
  return !!(isElement(elem) && typeof elem.id === "string" && elem.id !== "");
}

/**
 * @param {EraserState} state
 * @param {EventTarget | null} elem
 * @returns {boolean}
 */
function inDrawingArea(state, elem) {
  return isElement(elem) && state.board.drawingArea.contains(elem);
}

/**
 * @param {EraserPointerEvent} evt
 * @returns {EventTarget | null}
 */
function resolveTarget(evt) {
  let target = evt.target;
  if (evt.type === "touchmove" || evt.type === "touchstart") {
    const touch = evt.touches && evt.touches[0];
    if (touch) {
      target = document.elementFromPoint(touch.clientX, touch.clientY);
    }
  }
  return target;
}

/** @param {string} id */
function createDeleteMessage(id) {
  return {
    tool: ToolCodes.ERASER,
    type: MutationType.DELETE,
    id,
  };
}

/**
 * @param {EraserState} state
 * @param {number} x
 * @param {number} y
 * @param {EraserPointerEvent} evt
 */
export function press(state, x, y, evt) {
  void x;
  void y;
  evt.preventDefault();
  state.erasing = true;
  move(state, x, y, evt);
}

/**
 * @param {EraserState} state
 * @param {number} x
 * @param {number} y
 * @param {EraserPointerEvent} evt
 */
export function move(state, x, y, evt) {
  void x;
  void y;
  const target = resolveTarget(/** @type {EraserPointerEvent} */ (evt));
  if (
    state.erasing &&
    target !== null &&
    target !== state.board.svg &&
    target !== state.board.drawingArea &&
    isErasableElement(target) &&
    inDrawingArea(state, target)
  ) {
    state.writes.drawAndSend(createDeleteMessage(target.id));
  }
}

/** @param {EraserState} state */
export function release(state) {
  state.erasing = false;
}

/**
 * @param {EraserState} state
 * @param {EraserMessage | {type?: unknown, id?: string}} data
 */
export function draw(state, data) {
  if (getMutationType(data) !== MutationType.DELETE) {
    logFrontendEvent("error", "tool.eraser.draw_invalid_type", {
      mutationType: data?.type,
      message: data,
    });
    return;
  }
  if (!data.id) {
    logFrontendEvent("error", "tool.eraser.delete_missing_id", {
      message: data,
    });
    return;
  }
  const elem = state.board.svg.getElementById(data.id);
  if (elem === null) {
    logFrontendEvent("warn", "tool.eraser.delete_missing_target", {
      id: data.id,
    });
  } else {
    state.board.drawingArea.removeChild(elem);
  }
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  return {
    board: ctx.runtime.board,
    writes: ctx.runtime.writes,
    erasing: false,
  };
}
