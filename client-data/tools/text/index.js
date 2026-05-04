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
  clampSize,
  getLocalGeometryBounds,
  resolveMaxBoardSize,
  truncateText,
} from "../../js/message_common.js";
import { VIEWPORT_LAYOUT_EVENT } from "../../js/board_viewport.js";
import { logFrontendEvent } from "../../js/frontend_logging.js";
import { MutationType } from "../../js/mutation_type.js";
import { TOOL_CODE_BY_ID } from "../tool-order.js";
/** @import { ToolBootContext, ToolRuntimeModules } from "../../../types/app-runtime" */
/** @typedef {(evt: Event | KeyboardEvent | FocusEvent) => void} TextChangeHandler */
/** @typedef {Omit<ReturnType<typeof createTextMessage>, "opacity"> & {opacity?: number}} TextCreateMessage */
/** @typedef {ReturnType<typeof updateTextMessage>} TextUpdateMessage */
/** @typedef {TextCreateMessage | TextUpdateMessage} TextMessage */
/** @typedef {{left: number, top: number, width: number, height: number, fontSize: number, caretColor: string}} EditorLayout */
/** @typedef {ReturnType<typeof createInitialState>} TextState */

function createInitialText() {
  return {
    x: 0,
    y: 0,
    size: 360,
    rawSize: 160,
    oldSize: 0,
    opacity: 1,
    color: "#000",
    id: "",
    sentText: "",
    lastSending: 0,
    timeout: /** @type {number | null} */ (null),
  };
}

/**
 * @param {ToolBootContext} ctx
 * @param {HTMLInputElement} input
 */
function createInitialState(ctx, input) {
  return {
    board: ctx.runtime.board,
    coordinates: ctx.runtime.coordinates,
    viewport: ctx.runtime.viewport,
    preferences: ctx.runtime.preferences,
    writes: ctx.runtime.writes,
    runtimeConfig: ctx.runtime.config,
    ids: ctx.runtime.ids,
    interaction: ctx.runtime.interaction,
    boardElement: ctx.runtime.board.board,
    input,
    curText: createInitialText(),
    active: false,
    layoutFrame: /** @type {number | null} */ (null),
    boundTextChangeHandler: /** @type {TextChangeHandler} */ (() => {}),
    boundViewportLayout: () => {},
    boundBlur: () => {},
  };
}

const TEXT_INPUT_BORDER_PX = 1;
const TEXT_INPUT_CARET_ROOM_PX = 3;
const TEXT_INPUT_HORIZONTAL_PADDING_PX = 2;
const TEXT_INPUT_EXTRA_WIDTH_PX =
  TEXT_INPUT_HORIZONTAL_PADDING_PX * 2 +
  TEXT_INPUT_BORDER_PX * 2 +
  TEXT_INPUT_CARET_ROOM_PX;
const TEXT_INPUT_MIN_WIDTH_PX = 12;

/**
 * @param {TextState} state
 * @returns {void}
 */
function normalizeCurrentTextPosition(state) {
  const maxBoardSize = resolveMaxBoardSize(
    state.runtimeConfig.serverConfig.MAX_BOARD_SIZE,
  );
  state.curText.x = state.coordinates.toBoardCoordinate(state.curText.x);
  const normalizedY = state.coordinates.toBoardCoordinate(state.curText.y);
  state.curText.y = Math.min(
    Math.max(normalizedY, state.curText.size),
    maxBoardSize,
  );
}

export const toolId = "text";
const toolCode = TOOL_CODE_BY_ID[toolId];
export const drawsOnBoard = true;
export const mouseCursor = "text";

/**
 * @param {unknown} data
 * @returns {data is TextMessage}
 */
function isTextMessage(data) {
  if (!data || typeof data !== "object") return false;
  const message = /** @type {Partial<TextMessage>} */ (data);
  if (message.tool !== toolCode) return false;
  if (message.type === MutationType.CREATE) {
    return (
      typeof message.id === "string" &&
      typeof message.color === "string" &&
      typeof message.size === "number" &&
      typeof message.x === "number" &&
      typeof message.y === "number"
    );
  }
  return (
    message.type === MutationType.UPDATE &&
    typeof message.id === "string" &&
    typeof message.txt === "string"
  );
}

/** @type {import("../shape_contract.js").ToolContract} */
const contract = {
  toolId,
  toolCode,
  payloadKind: "text",
  storedTagName: "text",
  updatableFields: /** @type {const} */ (["txt"]),
  liveMessageFields: /** @type {const} */ ({
    [MutationType.CREATE]: {
      id: "id",
      color: "color",
      size: "size",
      opacity: "opacity?",
      x: "coord",
      y: "coord",
    },
    [MutationType.UPDATE]: {
      id: "id",
      txt: "text",
    },
  }),
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x"));
    const y = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y"));
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "font-size"),
    );
    if (x === undefined || y === undefined || size === undefined) {
      return null;
    }
    const textLength = helpers.decodedTextLength(entry.content || "");
    return {
      id: helpers.id,
      tool: contract.toolId,
      paintOrder,
      data: helpers.decorateStoredItemData(
        {
          x,
          y,
          size,
          color: helpers.readStoredSvgAttribute(entry, "fill") || "#000000",
        },
        helpers.opacity,
        helpers.transform,
      ),
      textLength,
      localBounds: getLocalGeometryBounds({
        tool: toolId,
        x,
        y,
        size,
        textLength,
      }),
    };
  },
  parseStoredSvgItem(summary, entry, helpers) {
    return {
      id: summary.id,
      tool: contract.toolId,
      ...summary.data,
      txt: helpers.unescapeHtml(entry.content || ""),
    };
  },
  serializeStoredSvgItem(item, helpers) {
    const transform = helpers.renderTransformAttribute(item.transform);
    const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
    const color = helpers.escapeHtml(item.color || "#000000");
    const opacity =
      typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
    const textValue = String(item.txt || "");
    return (
      `<text id="${id}" x="${helpers.numberOrZero(item.x)}" y="${helpers.numberOrZero(item.y)}"` +
      ` font-size="${helpers.numberOrZero(item.size) | 0}" fill="${color}"${opacity}${transform}>` +
      `${helpers.escapeHtml(textValue)}</text>`
    );
  },
  renderBoardSvg(text, helpers) {
    const x = helpers.numberOrZero(text.x);
    const y = helpers.numberOrZero(text.y);
    return (
      "<text " +
      'id="' +
      helpers.htmlspecialchars(text.id || "t") +
      '" ' +
      'x="' +
      (x | 0) +
      '" ' +
      'y="' +
      (y | 0) +
      '" ' +
      'font-size="' +
      (helpers.numberOrZero(text.size) | 0) +
      '" ' +
      'fill="' +
      helpers.htmlspecialchars(text.color || "#000") +
      '" ' +
      helpers.renderTranslate(text) +
      ">" +
      helpers.htmlspecialchars(text.txt || "") +
      "</text>"
    );
  },
};

export { contract };
export const shortcut = "t";

/**
 * @param {EventTarget | null} target
 * @returns {target is SVGTextElement & {id: string}}
 */
function isExistingTextElement(target) {
  return target instanceof SVGTextElement;
}

/**
 * @param {TextState} state
 * @returns {(SVGTextElement & {id: string}) | null}
 */
function getActiveTextElement(state) {
  if (!state.curText.id) return null;
  const elem = state.board.svg.getElementById(state.curText.id);
  return elem instanceof SVGTextElement
    ? /** @type {SVGTextElement & {id: string}} */ (elem)
    : null;
}

/**
 * @param {HTMLInputElement} input
 * @param {EditorLayout} layout
 */
function applyEditorLayout(input, layout) {
  input.size = 1;
  input.style.fontSize = `${layout.fontSize}px`;
  input.style.lineHeight = `${layout.fontSize}px`;
  input.style.height = `${Math.ceil(
    layout.height + TEXT_INPUT_BORDER_PX * 2,
  )}px`;
  input.style.width = `${Math.ceil(
    layout.width + TEXT_INPUT_EXTRA_WIDTH_PX,
  )}px`;
  input.style.left = `${
    layout.left - TEXT_INPUT_HORIZONTAL_PADDING_PX - TEXT_INPUT_BORDER_PX
  }px`;
  input.style.top = `${layout.top - TEXT_INPUT_BORDER_PX}px`;
  input.style.caretColor = layout.caretColor;
}

/**
 * Measures only the active edited SVG text. `getBoundingClientRect()` can
 * force layout, so this helper must stay confined to the one active text item
 * and only be called from the coalesced editor layout frame.
 *
 * @param {TextState} state
 * @param {SVGTextElement} textElement
 */
function syncSvgEditorLayout(state, textElement) {
  const rect = textElement.getBoundingClientRect();
  const boardRect = state.boardElement.getBoundingClientRect();
  const style = getComputedStyle(textElement);
  const fontSize = Math.max(
    1,
    rect.height || state.curText.size * state.viewport.getScale(),
  );
  applyEditorLayout(state.input, {
    left: rect.left - boardRect.left,
    top: rect.top - boardRect.top,
    width: Math.max(TEXT_INPUT_MIN_WIDTH_PX, rect.width),
    height: Math.max(fontSize, rect.height),
    fontSize,
    caretColor:
      style.getPropertyValue("fill") ||
      textElement.getAttribute("fill") ||
      state.curText.color ||
      "#000",
  });
}

/** @param {TextState} state */
function syncPendingEditorLayout(state) {
  const scale = state.viewport.getScale();
  const fontSize = Math.max(1, state.curText.size * scale);
  applyEditorLayout(state.input, {
    left: state.curText.x * scale,
    top: state.curText.y * scale - fontSize,
    width: TEXT_INPUT_MIN_WIDTH_PX,
    height: fontSize,
    fontSize,
    caretColor: state.curText.color || "#000",
  });
}

/** @param {TextState} state */
function syncEditorLayoutNow(state) {
  if (!state.active) return;
  const textElement = getActiveTextElement(state);
  if (textElement) syncSvgEditorLayout(state, textElement);
  else syncPendingEditorLayout(state);
}

/** @param {TextState} state */
function scheduleEditorLayout(state) {
  if (!state.active || state.layoutFrame !== null) return;
  state.layoutFrame = window.requestAnimationFrame(() => {
    state.layoutFrame = null;
    syncEditorLayoutNow(state);
  });
}

/** @param {TextState} state */
function blurEditor(state) {
  if (state.active) return;
  state.input.style.top = "-1000px";
}

/** @param {TextState} state */
function stopEdit(state) {
  state.input.removeEventListener("input", state.boundTextChangeHandler);
  state.input.removeEventListener("keyup", state.boundTextChangeHandler);
  state.input.removeEventListener("blur", state.boundTextChangeHandler);
  state.input.removeEventListener("blur", state.boundBlur);
  state.boardElement.removeEventListener(
    VIEWPORT_LAYOUT_EVENT,
    state.boundViewportLayout,
  );
  if (state.layoutFrame !== null) {
    window.cancelAnimationFrame(state.layoutFrame);
    state.layoutFrame = null;
  }
  if (state.curText.timeout !== null) {
    clearTimeout(state.curText.timeout);
    state.curText.timeout = null;
  }
  try {
    state.input.blur();
  } catch {
    /* Internet Explorer */
  }
  state.active = false;
  blurEditor(state);
  state.curText.id = "";
  state.curText.sentText = "";
  state.input.value = "";
}

/** @param {TextState} state */
function startEdit(state) {
  state.active = true;
  if (!state.input.parentNode) state.boardElement.appendChild(state.input);
  state.boardElement.addEventListener(
    VIEWPORT_LAYOUT_EVENT,
    state.boundViewportLayout,
  );
  syncEditorLayoutNow(state);
  state.input.focus();
  state.input.addEventListener("input", state.boundTextChangeHandler);
  state.input.addEventListener("keyup", state.boundTextChangeHandler);
  state.input.addEventListener("blur", state.boundTextChangeHandler);
  state.input.addEventListener("blur", state.boundBlur);
}

/**
 * @param {TextState} state
 * @param {SVGTextElement & {id: string}} elem
 */
function editOldText(state, elem) {
  state.curText.id = elem.id;
  state.curText.sentText = elem.textContent || "";
  state.curText.size =
    Number(elem.getAttribute("font-size")) || state.curText.size;
  state.curText.opacity = Number(elem.getAttribute("opacity")) || 1;
  state.curText.color = elem.getAttribute("fill") || "#000";
  state.input.value = elem.textContent || "";
  startEdit(state);
}

/** @param {TextState} state */
function createTextMessage(state) {
  return {
    tool: toolCode,
    type: MutationType.CREATE,
    id: state.curText.id,
    color: state.curText.color,
    size: state.curText.size,
    opacity: state.curText.opacity,
    x: state.curText.x,
    y: state.curText.y,
  };
}

/** @param {TextState} state */
function updateTextMessage(state) {
  return {
    tool: toolCode,
    type: MutationType.UPDATE,
    id: state.curText.id,
    txt: truncateText(state.input.value),
  };
}

/**
 * @param {TextState} state
 * @param {Event | KeyboardEvent | FocusEvent} evt
 */
function textChangeHandler(state, evt) {
  if (evt instanceof KeyboardEvent && evt.key === "Enter") {
    state.curText.y += 1.5 * state.curText.size;
    normalizeCurrentTextPosition(state);
    stopEdit(state);
    startEdit(state);
    return;
  }
  if (evt instanceof KeyboardEvent && evt.key === "Escape") {
    stopEdit(state);
    return;
  }
  const nextText = truncateText(state.input.value);
  if (state.input.value !== nextText) state.input.value = nextText;
  if (state.curText.id === "" && nextText !== "") {
    state.curText.id = state.ids.generateUID("t");
    state.writes.drawAndSend(createTextMessage(state));
  }
  const activeTextElement = getActiveTextElement(state);
  if (activeTextElement) activeTextElement.textContent = nextText;
  scheduleEditorLayout(state);
  if (performance.now() - state.curText.lastSending <= 100) {
    if (state.curText.timeout !== null) clearTimeout(state.curText.timeout);
    state.curText.timeout = window.setTimeout(() => {
      textChangeHandler(state, evt);
    }, 500);
    return;
  }
  if (state.curText.id === "" || state.curText.sentText === nextText) return;
  state.writes.drawAndSend(updateTextMessage(state));
  state.curText.sentText = nextText;
  state.curText.lastSending = performance.now();
}

/**
 * @param {TextState} state
 * @param {string} id
 * @param {string} text
 */
function updateActiveEditorText(state, id, text) {
  if (!state.active || state.curText.id !== id) return;
  state.input.value = text;
  state.curText.sentText = text;
  scheduleEditorLayout(state);
}

/**
 * @param {{tool?: unknown, type?: unknown, id?: unknown, transform?: unknown, _children?: unknown}} message
 * @param {number} type
 * @param {string} activeId
 * @returns {boolean}
 */
function messageTargetsActiveText(message, type, activeId) {
  if (message.type === type && message.id === activeId) {
    return true;
  }
  if (!Array.isArray(message._children)) return false;
  for (const child of message._children) {
    if (!child || typeof child !== "object") continue;
    const record = /** @type {{type?: unknown, id?: unknown}} */ (child);
    if (record.type === type && record.id === activeId) return true;
  }
  return false;
}

/**
 * @param {TextState} state
 * @param {TextCreateMessage} fieldData
 * @returns {SVGElement}
 */
function createTextField(state, fieldData) {
  const elem = state.board.createSVGElement("text");
  elem.id = fieldData.id;
  elem.setAttribute("x", String(fieldData.x || 0));
  elem.setAttribute("y", String(fieldData.y || 0));
  elem.setAttribute("font-size", String(fieldData.size || 0));
  elem.setAttribute("fill", fieldData.color || "#000");
  elem.setAttribute(
    "opacity",
    String(Math.max(0.1, Math.min(1, Number(fieldData.opacity) || 1))),
  );
  state.board.drawingArea.appendChild(elem);
  return elem;
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  const input = document.createElement("input");
  input.id = "textToolInput";
  input.type = "text";
  input.setAttribute("autocomplete", "off");
  const state = createInitialState(ctx, input);
  state.boundTextChangeHandler = (evt) => textChangeHandler(state, evt);
  state.boundViewportLayout = () => scheduleEditorLayout(state);
  state.boundBlur = () => blurEditor(state);
  return state;
}

/**
 * @param {TextState} state
 * @param {unknown} data
 * @param {boolean} isLocal
 */
export function draw(state, data, isLocal) {
  state.interaction.drawingEvent = true;
  if (!isTextMessage(data)) {
    logFrontendEvent("error", "tool.text.draw_invalid_type", {
      mutationType: /** @type {{type?: unknown}} */ (data)?.type,
      message: data,
    });
    return;
  }
  if (data.type === MutationType.CREATE) {
    createTextField(state, data);
    return;
  }
  if (data.type === MutationType.UPDATE) {
    const textField = document.getElementById(data.id);
    if (!textField || String(textField.tagName).toLowerCase() !== "text") {
      logFrontendEvent("warn", "tool.text.update_missing_target", {
        id: data.id,
      });
      return;
    }
    textField.textContent = data.txt;
    if (!isLocal) updateActiveEditorText(state, data.id, data.txt);
    return;
  }
}

/**
 * @param {TextState} state
 * @param {{tool?: unknown, type?: unknown, id?: unknown, txt?: unknown, transform?: unknown, _children?: unknown}} message
 */
export function onMessage(state, message) {
  if (!state.active) return;
  const activeId = state.curText.id;
  if (
    message.type === MutationType.CLEAR ||
    messageTargetsActiveText(message, MutationType.DELETE, activeId)
  ) {
    stopEdit(state);
    return;
  }
  if (
    message.tool === toolCode &&
    message.type === MutationType.UPDATE &&
    message.id === activeId &&
    typeof message.txt === "string"
  ) {
    updateActiveEditorText(state, activeId, message.txt);
    return;
  }
  if (
    message.tool === TOOL_CODE_BY_ID.hand &&
    messageTargetsActiveText(message, MutationType.UPDATE, activeId)
  ) {
    scheduleEditorLayout(state);
  }
}

/**
 * @param {TextState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 * @param {boolean} isTouchEvent
 */
export function press(state, x, y, evt, isTouchEvent) {
  void isTouchEvent;
  if (evt.target === state.input) return;
  if (isExistingTextElement(evt.target)) {
    editOldText(state, evt.target);
    evt.preventDefault();
    return;
  }
  state.curText.rawSize = state.preferences.getSize();
  state.curText.size = clampSize(Math.round(state.curText.rawSize * 1.5 + 120));
  state.curText.opacity = state.preferences.getOpacity();
  state.curText.color = state.preferences.getColor();
  state.curText.x = x;
  state.curText.y = y + state.curText.size / 2;
  normalizeCurrentTextPosition(state);
  stopEdit(state);
  startEdit(state);
  evt.preventDefault();
}

/** @param {TextState} state */
export function onstart(state) {
  state.curText.oldSize = state.preferences.getSize();
  state.preferences.setSize(state.curText.rawSize);
}

/** @param {TextState} state */
export function onquit(state) {
  stopEdit(state);
  state.preferences.setSize(state.curText.oldSize);
}

/**
 * @param {TextState} state
 * @param {{id?: string}} message
 */
export function onMutationRejected(state, message) {
  if (message.id === state.curText.id) {
    stopEdit(state);
  }
}
