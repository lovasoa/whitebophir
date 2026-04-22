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

import { truncateText } from "../../js/message_common.js";
import { MutationType } from "../../js/mutation_type.js";
/** @typedef {import("../../../types/app-runtime").BoardMessage} BoardMessage */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {import("../../../types/app-runtime").MountedAppToolsState} MountedAppToolsState */
/** @typedef {{x: number, y: number, size: number, rawSize: number, oldSize: number, opacity: number, color: string, id: string, sentText: string, lastSending: number, timeout: ReturnType<typeof setTimeout> | null}} CurrentTextState */
/** @typedef {{type: number, id: string, txt?: string, color?: string, size?: number, opacity?: number, x?: number, y?: number}} NewTextMessage */
/** @typedef {{type: number, id: string, txt?: string}} TextUpdateMessage */
/** @typedef {NewTextMessage | TextUpdateMessage} TextMessage */
/** @typedef {{Tools: MountedAppToolsState, board: HTMLElement, input: HTMLInputElement, curText: CurrentTextState, active: boolean, boundTextChangeHandler: (evt: Event | KeyboardEvent | FocusEvent) => void, boundBlur: () => void}} TextState */

/**
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} textLength
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
function textBoundsFromLength(x, y, size, textLength) {
  return {
    minX: x,
    minY: y - size,
    maxX: x + size * textLength,
    maxY: y,
  };
}

export const toolId = "text";
export const drawsOnBoard = true;
export const mouseCursor = "text";

/** @type {import("../shape_contract.js").ToolContract} */
const contract = {
  toolId,
  payloadKind: "text",
  storedTagName: "text",
  updatableFields: ["txt"],
  liveMessageFields: {
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
  },
  storedFields: {
    color: "color",
    size: "size",
    opacity: "opacity?",
    x: "coord",
    y: "coord",
    txt: "text?",
    transform: "transform?",
    time: "time?",
  },
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
      localBounds: textBoundsFromLength(x, y, size, textLength),
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
  if (!state.input.parentNode) state.board.appendChild(state.input);
  state.input.value = "";
  const clientW = Math.max(
    document.documentElement.clientWidth,
    window.innerWidth ?? 0,
  );
  let x =
    state.curText.x * state.Tools.scale - document.documentElement.scrollLeft;
  if (x + 250 > clientW) x = Math.max(60, clientW - 260);
  state.input.style.left = `${x}px`;
  state.input.style.top = `${state.curText.y * state.Tools.scale - document.documentElement.scrollTop + 20}px`;
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
  state.curText.x = state.Tools.pageCoordinateToBoard(
    r.left + document.documentElement.scrollLeft,
  );
  state.curText.y = state.Tools.pageCoordinateToBoard(
    r.top + r.height + document.documentElement.scrollTop,
  );
  state.curText.sentText = elem.textContent || "";
  state.curText.size =
    Number(elem.getAttribute("font-size")) || state.curText.size;
  state.curText.opacity = Number(elem.getAttribute("opacity")) || 1;
  state.curText.color = elem.getAttribute("fill") || "#000";
  startEdit(state);
  state.input.value = elem.textContent || "";
}

/**
 * @param {TextState} state
 * @param {Event | KeyboardEvent | FocusEvent} evt
 */
function textChangeHandler(state, evt) {
  if (evt instanceof KeyboardEvent && evt.key === "Enter") {
    state.curText.y += 1.5 * state.curText.size;
    stopEdit(state);
    startEdit(state);
  } else if (evt instanceof KeyboardEvent && evt.key === "Escape") {
    stopEdit(state);
  }
  if (performance.now() - state.curText.lastSending <= 100) {
    if (state.curText.timeout !== null) clearTimeout(state.curText.timeout);
    state.curText.timeout = setTimeout(() => {
      textChangeHandler(state, evt);
    }, 500);
    return;
  }
  if (state.curText.sentText === state.input.value) return;
  if (state.curText.id === "") {
    state.curText.id = state.Tools.generateUID("t");
    state.Tools.drawAndSend({
      type: MutationType.CREATE,
      id: state.curText.id,
      color: state.curText.color,
      size: state.curText.size,
      opacity: state.curText.opacity,
      x: state.curText.x,
      y: state.curText.y,
    });
  }
  state.Tools.drawAndSend({
    type: MutationType.UPDATE,
    id: state.curText.id,
    txt: truncateText(state.input.value),
  });
  state.curText.sentText = state.input.value;
  state.curText.lastSending = performance.now();
}

/**
 * @param {TextState} state
 * @param {Node & {textContent: string | null}} textField
 * @param {string | undefined} text
 */
function updateText(state, textField, text) {
  void state;
  textField.textContent = text ?? "";
}

/**
 * @param {TextState} state
 * @param {NewTextMessage} fieldData
 * @returns {SVGElement}
 */
function createTextField(state, fieldData) {
  const elem = state.Tools.createSVGElement("text");
  elem.id = fieldData.id;
  elem.setAttribute("x", String(fieldData.x || 0));
  elem.setAttribute("y", String(fieldData.y || 0));
  elem.setAttribute("font-size", String(fieldData.size || 0));
  elem.setAttribute("fill", fieldData.color || "#000");
  elem.setAttribute(
    "opacity",
    String(Math.max(0.1, Math.min(1, Number(fieldData.opacity) || 1))),
  );
  if (fieldData.txt) elem.textContent = fieldData.txt;
  state.Tools.drawingArea.appendChild(elem);
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
    Tools: ctx.Tools,
    board: ctx.Tools.board,
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
 * @param {TextMessage} data
 * @param {boolean} isLocal
 */
export function draw(state, data, isLocal) {
  void isLocal;
  const textMessage = /** @type {TextMessage} */ (data);
  state.Tools.drawingEvent = true;
  if (textMessage.type === MutationType.CREATE) {
    createTextField(state, /** @type {NewTextMessage} */ (textMessage));
    return;
  }
  if (textMessage.type === MutationType.UPDATE) {
    const textField = document.getElementById(textMessage.id);
    if (!textField || String(textField.tagName).toLowerCase() !== "text") {
      console.error(
        "Text: Hmmm... I received text that belongs to an unknown text field",
      );
      return false;
    }
    updateText(state, textField, textMessage.txt);
    return;
  }
  console.error("Text: Draw instruction with unknown type. ", textMessage);
  return;
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
  state.curText.rawSize = state.Tools.getSize();
  state.curText.size = Math.round(state.curText.rawSize * 1.5 + 120);
  state.curText.opacity = state.Tools.getOpacity();
  state.curText.color = state.Tools.getColor();
  state.curText.x = x;
  state.curText.y = y + state.curText.size / 2;
  stopEdit(state);
  startEdit(state);
  evt.preventDefault();
}

/** @param {TextState} state */
export function onstart(state) {
  state.curText.oldSize = state.Tools.getSize();
  state.Tools.setSize(state.curText.rawSize);
}

/** @param {TextState} state */
export function onquit(state) {
  stopEdit(state);
  state.Tools.setSize(state.curText.oldSize);
}
