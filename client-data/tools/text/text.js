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
/** @typedef {import("../../../types/app-runtime").BoardMessage} BoardMessage */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {import("../../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {{x: number, y: number, size: number, rawSize: number, oldSize: number, opacity: number, color: string, id: string, sentText: string, lastSending: number, timeout: ReturnType<typeof setTimeout> | null}} CurrentTextState */
/** @typedef {{type: "new", id: string, txt?: string, color?: string, size?: number, opacity?: number, x?: number, y?: number}} NewTextMessage */
/** @typedef {{type: "update", id: string, txt?: string}} TextUpdateMessage */
/** @typedef {NewTextMessage | TextUpdateMessage} TextMessage */

export default class TextTool {
  static toolName = "Text";

  /**
   * @param {AppToolsState} Tools
   */
  constructor(Tools) {
    this.Tools = Tools;
    this.board = Tools.board;
    this.name = "Text";
    this.shortcut = "t";
    this.stylesheet = "tools/text/text.css";
    this.icon = "tools/text/icon.svg";
    this.mouseCursor = "text";

    this.input = document.createElement("input");
    this.input.id = "textToolInput";
    this.input.type = "text";
    this.input.setAttribute("autocomplete", "off");

    /** @type {CurrentTextState} */
    this.curText = {
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
    };

    this.active = false;
    this.boundTextChangeHandler = this.textChangeHandler.bind(this);
    this.boundBlur = this.blur.bind(this);
  }

  /**
   * @param {EventTarget | null} target
   * @returns {target is SVGTextElement & {id: string}}
   */
  isExistingTextElement(target) {
    return target instanceof SVGTextElement;
  }

  onstart() {
    this.curText.oldSize = this.Tools.getSize();
    this.Tools.setSize(this.curText.rawSize);
  }

  onquit() {
    this.stopEdit();
    this.Tools.setSize(this.curText.oldSize);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   * @param {boolean} isTouchEvent
   */
  press(x, y, evt, isTouchEvent) {
    void isTouchEvent;
    if (evt.target === this.input) return;
    if (this.isExistingTextElement(evt.target)) {
      this.editOldText(evt.target);
      evt.preventDefault();
      return;
    }
    this.curText.rawSize = this.Tools.getSize();
    this.curText.size = Math.round(this.curText.rawSize * 1.5 + 120);
    this.curText.opacity = this.Tools.getOpacity();
    this.curText.color = this.Tools.getColor();
    this.curText.x = x;
    this.curText.y = y + this.curText.size / 2;

    this.stopEdit();
    this.startEdit();
    evt.preventDefault();
  }

  /** @param {SVGTextElement & {id: string}} elem */
  editOldText(elem) {
    this.curText.id = elem.id;
    const r = elem.getBoundingClientRect();
    const x = this.Tools.pageCoordinateToBoard(
      r.left + document.documentElement.scrollLeft,
    );
    const y = this.Tools.pageCoordinateToBoard(
      r.top + r.height + document.documentElement.scrollTop,
    );

    this.curText.x = x;
    this.curText.y = y;
    this.curText.sentText = elem.textContent || "";
    this.curText.size =
      Number(elem.getAttribute("font-size")) || this.curText.size;
    this.curText.opacity = Number(elem.getAttribute("opacity")) || 1;
    this.curText.color = elem.getAttribute("fill") || "#000";
    this.startEdit();
    this.input.value = elem.textContent || "";
  }

  startEdit() {
    this.active = true;
    if (!this.input.parentNode) this.board.appendChild(this.input);
    this.input.value = "";
    const clientW = Math.max(
      document.documentElement.clientWidth,
      window.innerWidth ?? 0,
    );
    let x =
      this.curText.x * this.Tools.scale - document.documentElement.scrollLeft;
    if (x + 250 > clientW) {
      x = Math.max(60, clientW - 260);
    }

    this.input.style.left = `${x}px`;
    this.input.style.top = `${this.curText.y * this.Tools.scale - document.documentElement.scrollTop + 20}px`;
    this.input.focus();
    this.input.addEventListener("input", this.boundTextChangeHandler);
    this.input.addEventListener("keyup", this.boundTextChangeHandler);
    this.input.addEventListener("blur", this.boundTextChangeHandler);
    this.input.addEventListener("blur", this.boundBlur);
  }

  stopEdit() {
    this.input.removeEventListener("input", this.boundTextChangeHandler);
    this.input.removeEventListener("keyup", this.boundTextChangeHandler);
    this.input.removeEventListener("blur", this.boundTextChangeHandler);
    this.input.removeEventListener("blur", this.boundBlur);
    if (this.curText.timeout !== null) {
      clearTimeout(this.curText.timeout);
      this.curText.timeout = null;
    }
    try {
      this.input.blur();
    } catch {
      /* Internet Explorer */
    }
    this.active = false;
    this.blur();
    this.curText.id = "";
    this.curText.sentText = "";
    this.input.value = "";
  }

  blur() {
    if (this.active) return;
    this.input.style.top = "-1000px";
  }

  /** @param {Event | KeyboardEvent | FocusEvent} evt */
  textChangeHandler(evt) {
    if (evt instanceof KeyboardEvent && evt.key === "Enter") {
      this.curText.y += 1.5 * this.curText.size;
      this.stopEdit();
      this.startEdit();
    } else if (evt instanceof KeyboardEvent && evt.key === "Escape") {
      this.stopEdit();
    }
    if (performance.now() - this.curText.lastSending > 100) {
      if (this.curText.sentText !== this.input.value) {
        if (this.curText.id === "") {
          this.curText.id = this.Tools.generateUID("t");
          this.Tools.drawAndSend({
            type: "new",
            id: this.curText.id,
            color: this.curText.color,
            size: this.curText.size,
            opacity: this.curText.opacity,
            x: this.curText.x,
            y: this.curText.y,
          });
        }
        this.Tools.drawAndSend({
          type: "update",
          id: this.curText.id,
          txt: truncateText(this.input.value),
        });
        this.curText.sentText = this.input.value;
        this.curText.lastSending = performance.now();
      }
    } else {
      if (this.curText.timeout !== null) clearTimeout(this.curText.timeout);
      this.curText.timeout = setTimeout(() => {
        this.textChangeHandler(evt);
      }, 500);
    }
  }

  /**
   * @param {BoardMessage} data
   * @param {boolean} isLocal
   * @returns {boolean | void}
   */
  draw(data, isLocal) {
    void isLocal;
    const textMessage = /** @type {TextMessage} */ (data);
    this.Tools.drawingEvent = true;
    switch (textMessage.type) {
      case "new":
        this.createTextField(textMessage);
        break;
      case "update": {
        const textField = document.getElementById(textMessage.id);
        if (!textField || String(textField.tagName).toLowerCase() !== "text") {
          console.error(
            "Text: Hmmm... I received text that belongs to an unknown text field",
          );
          return false;
        }
        this.updateText(textField, textMessage.txt);
        break;
      }
      default:
        console.error(
          "Text: Draw instruction with unknown type. ",
          textMessage,
        );
        break;
    }
  }

  /**
   * @param {Node & {textContent: string | null}} textField
   * @param {string | undefined} text
   */
  updateText(textField, text) {
    textField.textContent = text ?? "";
  }

  /**
   * @param {NewTextMessage} fieldData
   * @returns {SVGElement}
   */
  createTextField(fieldData) {
    const elem = this.Tools.createSVGElement("text");
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
    if (!this.Tools.drawingArea) {
      throw new Error("Missing drawing area for text tool");
    }
    this.Tools.drawingArea.appendChild(elem);
    return elem;
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<TextTool>}
   */
  static async boot(ctx) {
    return new TextTool(ctx.runtime.Tools);
  }
}
