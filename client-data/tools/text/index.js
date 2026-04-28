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
import { logFrontendEvent } from "../../js/frontend_logging.js";
import { MutationType } from "../../js/mutation_type.js";
import { ToolCodes } from "../tool-order.js";
/** @import { ToolBootContext, ToolRuntimeModules } from "../../../types/app-runtime" */
/** @typedef {{x: number, y: number, size: number, rawSize: number, oldSize: number, opacity: number, color: string, id: string, sentText: string, lastSending: number, timeout: number | null}} CurrentTextState */
/** @typedef {Omit<ReturnType<typeof createTextMessage>, "opacity"> & {opacity?: number}} TextCreateMessage */
/** @typedef {ReturnType<typeof updateTextMessage>} TextUpdateMessage */
/** @typedef {TextCreateMessage | TextUpdateMessage} TextMessage */
/** @typedef {{board: ToolRuntimeModules["board"], viewport: ToolRuntimeModules["viewport"], preferences: ToolRuntimeModules["preferences"], writes: ToolRuntimeModules["writes"], runtimeConfig: ToolRuntimeModules["config"], ids: ToolRuntimeModules["ids"], interaction: ToolRuntimeModules["interaction"], boardElement: HTMLElement, input: HTMLInputElement, curText: CurrentTextState, active: boolean, boundTextChangeHandler: (evt: Event | KeyboardEvent | FocusEvent) => void, boundBlur: () => void}} TextState */

const TEXT_INPUT_BORDER_PX = 1;
const TEXT_INPUT_CARET_ROOM_PX = 3;
const TEXT_INPUT_HORIZONTAL_PADDING_PX = 2;
const TEXT_INPUT_EXTRA_WIDTH_PX =
  TEXT_INPUT_HORIZONTAL_PADDING_PX * 2 +
  TEXT_INPUT_BORDER_PX * 2 +
  TEXT_INPUT_CARET_ROOM_PX;
const TEXT_INPUT_FONT_FAMILY = "Arial, Helvetica, sans-serif";
const TEXT_INPUT_MIN_WIDTH_PX = 12;

/** @type {CanvasRenderingContext2D | null} */
let textMeasurementContext = null;

/**
 * @param {TextState} state
 * @returns {void}
 */
function normalizeCurrentTextPosition(state) {
  const maxBoardSize = resolveMaxBoardSize(
    state.runtimeConfig.serverConfig.MAX_BOARD_SIZE,
  );
  state.curText.x = state.board.toBoardCoordinate(state.curText.x);
  const normalizedY = state.board.toBoardCoordinate(state.curText.y);
  state.curText.y = Math.min(
    Math.max(normalizedY, state.curText.size),
    maxBoardSize,
  );
}

export const toolId = "text";
export const drawsOnBoard = true;
export const mouseCursor = "text";

/**
 * @param {unknown} data
 * @returns {data is TextMessage}
 */
function isTextMessage(data) {
  if (!data || typeof data !== "object") return false;
  const message = /** @type {Partial<TextMessage>} */ (data);
  if (message.tool !== ToolCodes.TEXT) return false;
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
  toolCode: ToolCodes.TEXT,
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
    return (
      "<text " +
      'id="' +
      helpers.htmlspecialchars(text.id || "t") +
      '" ' +
      'x="' +
      (text.x | 0) +
      '" ' +
      'y="' +
      (text.y | 0) +
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
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
function measureTextWidth(text, fontSize) {
  if (!textMeasurementContext) {
    const canvas = document.createElement("canvas");
    textMeasurementContext =
      typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  }
  const context = textMeasurementContext;
  if (!context) return Math.max(1, text.length) * fontSize * 0.55;
  context.font = `${fontSize}px ${TEXT_INPUT_FONT_FAMILY}`;
  return context.measureText(text || " ").width;
}

/** @param {TextState} state */
function syncEditorLayout(state) {
  const scale = state.viewport.getScale();
  const fontSize = Math.max(1, state.curText.size * scale);
  const input = state.input;
  const contentWidth = measureTextWidth(input.value, fontSize);
  input.size = 1;
  input.style.color = state.curText.color || "#000";
  input.style.fontSize = `${fontSize}px`;
  input.style.lineHeight = `${fontSize}px`;
  input.style.height = `${fontSize + TEXT_INPUT_BORDER_PX * 2}px`;
  input.style.width = `${Math.ceil(
    Math.max(TEXT_INPUT_MIN_WIDTH_PX, contentWidth) + TEXT_INPUT_EXTRA_WIDTH_PX,
  )}px`;
  input.style.left = `${
    state.curText.x * scale -
    TEXT_INPUT_HORIZONTAL_PADDING_PX -
    TEXT_INPUT_BORDER_PX
  }px`;
  input.style.top = `${
    state.curText.y * scale - fontSize - TEXT_INPUT_BORDER_PX
  }px`;
}

/**
 * @param {TextState} state
 * @param {boolean} visible
 */
function setEditedTextVisibility(state, visible) {
  if (!state.curText.id) return;
  const elem = document.getElementById(state.curText.id);
  if (!elem || String(elem.tagName).toLowerCase() !== "text") return;
  elem.style.visibility = visible ? "" : "hidden";
}

/** @param {TextState} state */
function blurEditor(state) {
  if (state.active) return;
  state.input.style.top = "-1000px";
}

/** @param {TextState} state */
function stopEdit(state) {
  setEditedTextVisibility(state, true);
  state.input.removeEventListener("input", state.boundTextChangeHandler);
  state.input.removeEventListener("keyup", state.boundTextChangeHandler);
  state.input.removeEventListener("blur", state.boundTextChangeHandler);
  state.input.removeEventListener("blur", state.boundBlur);
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
  syncEditorLayout(state);
  setEditedTextVisibility(state, false);
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
  const r = elem.getBoundingClientRect();
  state.curText.x = state.board.pageCoordinateToBoard(
    r.left + document.documentElement.scrollLeft,
  );
  state.curText.y = state.board.pageCoordinateToBoard(
    r.top + r.height + document.documentElement.scrollTop,
  );
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
    tool: ToolCodes.TEXT,
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
    tool: ToolCodes.TEXT,
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
  syncEditorLayout(state);
  if (performance.now() - state.curText.lastSending <= 100) {
    if (state.curText.timeout !== null) clearTimeout(state.curText.timeout);
    state.curText.timeout = window.setTimeout(() => {
      textChangeHandler(state, evt);
    }, 500);
    return;
  }
  const inputText = state.input.value;
  if (state.curText.sentText === inputText) return;
  const nextText = truncateText(inputText);
  if (state.curText.id === "") {
    state.curText.id = state.ids.generateUID("t");
    state.writes.drawAndSend(createTextMessage(state));
  }
  state.writes.drawAndSend(updateTextMessage(state));
  setEditedTextVisibility(state, false);
  if (state.input.value !== nextText) {
    state.input.value = nextText;
    syncEditorLayout(state);
  }
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
  syncEditorLayout(state);
  setEditedTextVisibility(state, false);
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
  /** @type {TextState} */
  const state = {
    board: ctx.runtime.board,
    viewport: ctx.runtime.viewport,
    preferences: ctx.runtime.preferences,
    writes: ctx.runtime.writes,
    runtimeConfig: ctx.runtime.config,
    ids: ctx.runtime.ids,
    interaction: ctx.runtime.interaction,
    boardElement: ctx.runtime.board.board,
    input,
    curText: {
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
      timeout: null,
    },
    active: false,
    boundTextChangeHandler: () => {},
    boundBlur: () => {},
  };
  state.boundTextChangeHandler = (evt) => textChangeHandler(state, evt);
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
