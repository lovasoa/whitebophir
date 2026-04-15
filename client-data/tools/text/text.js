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

/** @param {any} Tools */
export function registerTextTool(Tools) {
  /** @typedef {{type?: string, id?: string, txt?: string, color?: string, size?: number, opacity?: number, x?: number, y?: number}} TextMessage */
  /** @typedef {SVGTextElement & {id: string}} ExistingTextElement */
  /** @typedef {Event | KeyboardEvent | FocusEvent} TextInputEvent */
  /**
   * @typedef {object} TextEditState
   * @property {number} x
   * @property {number} y
   * @property {number} size
   * @property {number} rawSize
   * @property {number} oldSize
   * @property {number} opacity
   * @property {string} color
   * @property {string | 0} id
   * @property {string} sentText
   * @property {number} lastSending
   * @property {ReturnType<typeof setTimeout> | null} timeout
   */
  const board = Tools.board;
  const input = document.createElement("input");
  input.id = "textToolInput";
  input.type = "text";
  input.setAttribute("autocomplete", "off");

  /** @type {TextEditState} */
  const curText = {
    x: 0,
    y: 0,
    size: 36,
    rawSize: 16,
    oldSize: 0,
    opacity: 1,
    color: "#000",
    id: 0,
    sentText: "",
    lastSending: 0,
    timeout: null,
  };

  let active = false;

  /**
   * @param {EventTarget | null} target
   * @returns {target is ExistingTextElement}
   */
  function isExistingTextElement(target) {
    return target instanceof SVGTextElement;
  }

  function onStart() {
    curText.oldSize = Tools.getSize();
    Tools.setSize(curText.rawSize);
  }

  function onQuit() {
    stopEdit();
    Tools.setSize(curText.oldSize);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   * @param {boolean} isTouchEvent
   */
  function clickHandler(x, y, evt, isTouchEvent) {
    //if(document.querySelector("#menu").offsetWidth>Tools.menu_width+3) return;
    if (evt.target === input) return;
    if (isExistingTextElement(evt.target)) {
      editOldText(evt.target);
      evt.preventDefault();
      return;
    }
    curText.rawSize = Tools.getSize();
    curText.size = Math.round(curText.rawSize * 1.5 + 12);
    curText.opacity = Tools.getOpacity();
    curText.color = Tools.getColor();
    curText.x = x;
    curText.y = y + curText.size / 2;

    stopEdit();
    startEdit();
    evt.preventDefault();
  }

  /** @param {ExistingTextElement} elem */
  function editOldText(elem) {
    curText.id = elem.id;
    const r = elem.getBoundingClientRect();
    const x = (r.left + document.documentElement.scrollLeft) / Tools.scale;
    const y =
      (r.top + r.height + document.documentElement.scrollTop) / Tools.scale;

    curText.x = x;
    curText.y = y;
    curText.sentText = elem.textContent || "";
    curText.size = Number(elem.getAttribute("font-size")) || curText.size;
    curText.opacity = Number(elem.getAttribute("opacity")) || 1;
    curText.color = elem.getAttribute("fill") || "#000";
    startEdit();
    input.value = elem.textContent || "";
  }

  function startEdit() {
    active = true;
    if (!input.parentNode) board.appendChild(input);
    input.value = "";
    const clientW = Math.max(
      document.documentElement.clientWidth,
      window.innerWidth ?? 0,
    );
    let x = curText.x * Tools.scale - document.documentElement.scrollLeft;
    if (x + 250 > clientW) {
      x = Math.max(60, clientW - 260);
    }

    input.style.left = `${x}px`;
    input.style.top = `${curText.y * Tools.scale - document.documentElement.scrollTop + 20}px`;
    input.focus();
    input.addEventListener("input", textChangeHandler);
    input.addEventListener("keyup", textChangeHandler);
    input.addEventListener("blur", textChangeHandler);
    input.addEventListener("blur", blur);
  }

  function stopEdit() {
    input.removeEventListener("input", textChangeHandler);
    input.removeEventListener("keyup", textChangeHandler);
    input.removeEventListener("blur", textChangeHandler);
    input.removeEventListener("blur", blur);
    if (curText.timeout !== null) {
      clearTimeout(curText.timeout);
      curText.timeout = null;
    }
    try {
      if (typeof input.blur === "function") input.blur();
    } catch (e) {
      /* Internet Explorer */
    }
    active = false;
    blur();
    curText.id = 0;
    curText.sentText = "";
    input.value = "";
  }

  function blur() {
    if (active) return;
    input.style.top = "-1000px";
  }

  /** @param {TextInputEvent} evt */
  function textChangeHandler(evt) {
    if (evt instanceof KeyboardEvent && evt.key === "Enter") {
      // enter
      curText.y += 1.5 * curText.size;
      stopEdit();
      startEdit();
    } else if (evt instanceof KeyboardEvent && evt.key === "Escape") {
      // escape
      stopEdit();
    }
    if (performance.now() - curText.lastSending > 100) {
      if (curText.sentText !== input.value) {
        //If the user clicked where there was no text, then create a new text field
        if (curText.id === 0) {
          curText.id = Tools.generateUID("t"); //"t" for text
          Tools.drawAndSend({
            type: "new",
            id: curText.id,
            color: curText.color,
            size: curText.size,
            opacity: curText.opacity,
            x: curText.x,
            y: curText.y,
          });
        }
        Tools.drawAndSend({
          type: "update",
          id: curText.id,
          txt: truncateText(input.value),
        });
        curText.sentText = input.value;
        curText.lastSending = performance.now();
      }
    } else {
      if (curText.timeout !== null) clearTimeout(curText.timeout);
      curText.timeout = setTimeout(textChangeHandler, 500, evt);
    }
  }

  /**
   * @param {TextMessage} data
   * @param {boolean} isLocal
   * @returns {boolean | void}
   */
  function draw(data, isLocal) {
    Tools.drawingEvent = true;
    switch (data.type) {
      case "new":
        createTextField(data);
        break;
      case "update": {
        if (typeof data.id !== "string") {
          console.error("Text: update is missing an id.", data);
          return false;
        }
        const textField = document.getElementById(data.id);
        if (!textField || String(textField.tagName).toLowerCase() !== "text") {
          console.error(
            "Text: Hmmm... I received text that belongs to an unknown text field",
          );
          return false;
        }
        updateText(textField, data.txt);
        break;
      }
      default:
        console.error("Text: Draw instruction with unknown type. ", data);
        break;
    }
  }

  /**
   * @param {Node & {textContent: string | null}} textField
   * @param {string | undefined} text
   */
  function updateText(textField, text) {
    textField.textContent = text ?? "";
  }

  /**
   * @param {TextMessage} fieldData
   * @returns {SVGElement}
   */
  function createTextField(fieldData) {
    const elem = Tools.createSVGElement("text");
    elem.id = typeof fieldData.id === "string" ? fieldData.id : "";
    elem.setAttribute("x", String(fieldData.x || 0));
    elem.setAttribute("y", String(fieldData.y || 0));
    elem.setAttribute("font-size", String(fieldData.size || 0));
    elem.setAttribute("fill", fieldData.color || "#000");
    elem.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, Number(fieldData.opacity) || 1))),
    );
    if (fieldData.txt) elem.textContent = fieldData.txt;
    if (!Tools.drawingArea) {
      throw new Error("Missing drawing area for text tool");
    }
    Tools.drawingArea.appendChild(elem);
    return elem;
  }

  Tools.add({
    //The new tool
    name: "Text",
    shortcut: "t",
    listeners: {
      press: clickHandler,
    },
    onstart: onStart,
    onquit: onQuit,
    draw: draw,
    stylesheet: "tools/text/text.css",
    icon: "tools/text/icon.svg",
    mouseCursor: "text",
  });
}
