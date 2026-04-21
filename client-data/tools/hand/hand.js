/**
 *						  WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *	JavaScript code in this page.
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

import { messages as BoardMessages } from "../../js/board_transport.js";
import {
  pointInTransformedBBox,
  transformedBBoxIntersects,
} from "../../js/intersect.js";
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {{a:number, b:number, c:number, d:number, e:number, f:number}} TransformState */
/** @typedef {SVGImageElement & { origWidth: number, origHeight: number, drawCallback: (button: SelectionButton, bbox: {r:[number,number], a:[number,number], b:[number,number]}, scale:number) => void, clickCallback: (x:number, y:number, evt: { preventDefault(): void }) => void }} SelectionButton */

export default class HandTool {
  static toolName = "Hand";

  /**
   * @param {any} Tools
   * @param {(assetFile: string) => string} [assetUrl]
   */
  constructor(
    Tools,
    assetUrl = /** @param {string} assetFile */ (assetFile) =>
      `tools/hand/${assetFile}`,
  ) {
    this.Tools = Tools;
    this.assetUrl = assetUrl;
    this.selectorStates = {
      pointing: 0,
      selecting: 1,
      transform: 2,
    };
    this.selected = null;
    /** @type {(SVGGraphicsElement & {id: string})[]} */
    this.selectedEls = [];
    this.selectionRect = this.createSelectorRect();
    this.selectionRectTransform = undefined;
    this.currentTransform = null;
    /** @type {TransformState[]} */
    this.transformElements = [];
    this.selectorState = this.selectorStates.pointing;
    this.lastSent = 0;
    this.blockedSelectionButtons =
      Tools.server_config.BLOCKED_SELECTION_BUTTONS || [];

    this.selectionButtons = [
      this.createButton(
        "delete",
        "delete",
        24,
        24,
        (me, bbox, s) => {
          me.width.baseVal.value = me.origWidth / s;
          me.height.baseVal.value = me.origHeight / s;
          me.x.baseVal.value = bbox.r[0];
          me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / s;
          me.style.display = "";
        },
        this.deleteSelection.bind(this),
      ),
      this.createButton(
        "duplicate",
        "duplicate",
        24,
        24,
        (me, bbox, s) => {
          me.width.baseVal.value = me.origWidth / s;
          me.height.baseVal.value = me.origHeight / s;
          me.x.baseVal.value = bbox.r[0] + (me.origWidth + 2) / s;
          me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / s;
          me.style.display = "";
        },
        this.duplicateSelection.bind(this),
      ),
      this.createButton(
        "scaleHandle",
        "handle",
        14,
        14,
        (me, bbox, s) => {
          me.width.baseVal.value = me.origWidth / s;
          me.height.baseVal.value = me.origHeight / s;
          me.x.baseVal.value = bbox.r[0] + bbox.a[0] - me.origWidth / (2 * s);
          me.y.baseVal.value = bbox.r[1] + bbox.b[1] - me.origHeight / (2 * s);
          me.style.display = "";
        },
        this.startScalingTransform.bind(this),
      ),
    ];

    this.blockedSelectionButtons.forEach(
      (/** @type {number | string} */ buttonIndex) => {
        if (typeof buttonIndex === "number") {
          delete this.selectionButtons[buttonIndex];
        }
      },
    );

    this.name = "Hand";
    this.shortcut = "h";
    this.boundDeleteShortcut = this.deleteShortcut.bind(this);
    this.boundDuplicateShortcut = this.duplicateShortcut.bind(this);
    this.onSocketDisconnect = this.onquit.bind(this);
    this.secondary = Tools.canWrite
      ? {
          name: "Selector",
          icon: "tools/hand/selector.svg",
          active: false,
          switch: this.switchTool.bind(this),
        }
      : null;
    this.icon = "tools/hand/hand.svg";
    this.mouseCursor = "move";
    this.showMarker = true;
  }

  /**
   * @param {EventTarget | null} target
   * @returns {target is SVGGraphicsElement & { id: string }}
   */
  isSelectableElement(target) {
    return !!(
      target &&
      typeof target === "object" &&
      "id" in target &&
      "transform" in target &&
      "transformedBBox" in target
    );
  }

  /**
   * @param {EventTarget | null} target
   * @returns {target is { matches(selector: string): boolean }}
   */
  isMatchableTarget(target) {
    return !!(target && typeof target === "object" && "matches" in target);
  }

  /**
   * @param {unknown} value
   * @returns {value is {_children: any[]}}
   */
  isBatchMessage(value) {
    return !!(value && typeof value === "object" && "_children" in value);
  }

  /**
   * @param {EventTarget | null} el
   * @returns {(SVGGraphicsElement & { id: string }) | null}
   */
  getParentMathematics(el) {
    if (!this.isSelectableElement(el)) return null;
    let target;
    /** @type {(SVGGraphicsElement & { id: string }) | null} */
    let a = el;
    /** @type {(SVGGraphicsElement & { id: string })[]} */
    const els = [];
    while (a) {
      els.unshift(a);
      /** @type {EventTarget | null} */
      const parentElement = a.parentElement;
      a =
        parentElement && this.isSelectableElement(parentElement)
          ? parentElement
          : null;
    }
    const parentMathematics = els.find(
      (elem) => elem.getAttribute("class") === "MathElement",
    );
    if (parentMathematics && parentMathematics.tagName === "svg") {
      target = /** @type {SVGGraphicsElement & { id: string }} */ (
        parentMathematics
      );
    }
    return target || /** @type {SVGGraphicsElement & { id: string }} */ (el);
  }

  deleteSelection() {
    const msgs = this.selectedEls.map((el) => ({
      type: "delete",
      id: el.id,
    }));
    this.Tools.drawAndSend({ _children: msgs }, this);
    this.selectedEls = [];
    this.hideSelectionUI();
  }

  duplicateSelection() {
    if (
      this.selectorState !== this.selectorStates.pointing ||
      this.selectedEls.length === 0
    ) {
      return;
    }
    const msgs = [];
    for (let i = 0; i < this.selectedEls.length; i++) {
      const selectedElement = this.selectedEls[i];
      if (!selectedElement) continue;
      const id = selectedElement.id;
      msgs[i] = {
        type: "copy",
        id: id,
        newid: this.Tools.generateUID(id[0]),
      };
    }
    this.Tools.drawAndSend({ _children: msgs }, this);
  }

  /** @returns {SVGRectElement} */
  createSelectorRect() {
    const shape = /** @type {SVGRectElement} */ (
      this.Tools.createSVGElement("rect")
    );
    shape.id = "selectionRect";
    shape.x.baseVal.value = 0;
    shape.y.baseVal.value = 0;
    shape.width.baseVal.value = 0;
    shape.height.baseVal.value = 0;
    shape.setAttribute("stroke", "black");
    shape.setAttribute("stroke-width", "1");
    shape.setAttribute("vector-effect", "non-scaling-stroke");
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke-dasharray", "5 5");
    shape.setAttribute("opacity", "1");
    this.Tools.svg.appendChild(shape);
    return shape;
  }

  /**
   * @param {string} name
   * @param {string} icon
   * @param {number} width
   * @param {number} height
   * @param {(button: SelectionButton, bbox: {r:[number,number], a:[number,number], b:[number,number]}, scale:number) => void} drawCallback
   * @param {(x:number, y:number, evt: { preventDefault(): void }) => void} clickCallback
   * @returns {SelectionButton}
   */
  createButton(name, icon, width, height, drawCallback, clickCallback) {
    const shape = /** @type {SelectionButton} */ (
      this.Tools.createSVGElement("image", {
        href: this.assetUrl(`${icon}.svg`),
        width: width,
        height: height,
      })
    );
    shape.id = `selectionButton-${name}`;
    shape.style.display = "none";
    shape.origWidth = width;
    shape.origHeight = height;
    shape.drawCallback = drawCallback;
    shape.clickCallback = clickCallback;
    this.Tools.svg.appendChild(shape);
    return shape;
  }

  showSelectionButtons() {
    const scale = this.Tools.getScale();
    const selectionBBox = this.selectionRect.transformedBBox();
    for (let i = 0; i < this.selectionButtons.length; i++) {
      const button = this.selectionButtons[i];
      if (button) button.drawCallback(button, selectionBBox, scale);
    }
  }

  hideSelectionButtons() {
    for (let i = 0; i < this.selectionButtons.length; i++) {
      const button = this.selectionButtons[i];
      if (button) button.style.display = "none";
    }
  }

  hideSelectionUI() {
    this.hideSelectionButtons();
    this.selectionRect.style.display = "none";
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ preventDefault(): void }} evt
   */
  startMovingElements(x, y, evt) {
    evt.preventDefault();
    this.selectorState = this.selectorStates.transform;
    this.currentTransform = this.moveSelection.bind(this);
    this.selected = { x: x, y: y };
    this.selectedEls = this.selectedEls.filter(
      (el) => this.Tools.svg.getElementById(el.id) !== null,
    );
    this.transformElements = this.selectedEls.map((el) => {
      const tmatrix = this.getTransformMatrix(el);
      return {
        a: tmatrix.a,
        b: tmatrix.b,
        c: tmatrix.c,
        d: tmatrix.d,
        e: tmatrix.e,
        f: tmatrix.f,
      };
    });
    const tmatrix = this.getTransformMatrix(this.selectionRect);
    this.selectionRectTransform = { x: tmatrix.e, y: tmatrix.f };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ preventDefault(): void }} evt
   */
  startScalingTransform(x, y, evt) {
    void x;
    void y;
    evt.preventDefault();
    this.hideSelectionButtons();
    this.selectorState = this.selectorStates.transform;
    const bbox = this.selectionRect.transformedBBox();
    this.selected = {
      x: bbox.r[0],
      y: bbox.r[1],
      w: bbox.a[0],
      h: bbox.b[1],
    };
    this.transformElements = this.selectedEls.map((el) => {
      const tmatrix = this.getTransformMatrix(el);
      return {
        a: tmatrix.a,
        b: tmatrix.b,
        c: tmatrix.c,
        d: tmatrix.d,
        e: tmatrix.e,
        f: tmatrix.f,
      };
    });
    const tmatrix = this.getTransformMatrix(this.selectionRect);
    this.selectionRectTransform = {
      a: tmatrix.a,
      d: tmatrix.d,
      e: tmatrix.e,
      f: tmatrix.f,
    };
    this.currentTransform = this.scaleSelection.bind(this);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ preventDefault(): void }} evt
   */
  startSelector(x, y, evt) {
    evt.preventDefault();
    this.selected = { x: x, y: y };
    this.selectedEls = [];
    this.selectorState = this.selectorStates.selecting;
    this.selectionRect.x.baseVal.value = x;
    this.selectionRect.y.baseVal.value = y;
    this.selectionRect.width.baseVal.value = 0;
    this.selectionRect.height.baseVal.value = 0;
    this.selectionRect.style.display = "";
    const tmatrix = this.getTransformMatrix(this.selectionRect);
    tmatrix.e = 0;
    tmatrix.f = 0;
  }

  calculateSelection() {
    const selectionTBBox = this.selectionRect.transformedBBox();
    if (!this.Tools.drawingArea) return [];
    const elements = this.Tools.drawingArea.children;
    const selected = [];
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (!element) continue;
      if (
        this.isSelectableElement(element) &&
        transformedBBoxIntersects(selectionTBBox, element.transformedBBox())
      ) {
        selected.push(element);
      }
    }
    return selected;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} force
   */
  moveSelection(x, y, force) {
    if (
      !this.selected ||
      !this.selectionRectTransform ||
      !("x" in this.selectionRectTransform)
    ) {
      return;
    }
    const rectTranslation = /** @type {{x: number, y: number}} */ (
      this.selectionRectTransform
    );
    const dx = x - this.selected.x;
    const dy = y - this.selected.y;
    const msgs = this.selectedEls.map((el, i) => {
      const oldTransform = this.transformElements[i];
      if (!oldTransform) {
        throw new Error("Mover: Missing transform state while moving.");
      }
      return {
        type: "update",
        id: el.id,
        transform: {
          a: oldTransform.a,
          b: oldTransform.b,
          c: oldTransform.c,
          d: oldTransform.d,
          e: dx + oldTransform.e,
          f: dy + oldTransform.f,
        },
      };
    });
    const tmatrix = this.getTransformMatrix(this.selectionRect);
    tmatrix.e = dx + rectTranslation.x;
    tmatrix.f = dy + rectTranslation.y;
    this.dispatchTransform({ _children: msgs }, force);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} force
   */
  scaleSelection(x, y, force) {
    if (
      !this.selected ||
      !this.selectionRectTransform ||
      !("a" in this.selectionRectTransform) ||
      !("w" in this.selected) ||
      !("h" in this.selected)
    ) {
      return;
    }
    const scaleSelectionState =
      /** @type {{x: number, y: number, w: number, h: number}} */ (
        this.selected
      );
    const rectTransform =
      /** @type {{a: number, d: number, e: number, f: number}} */ (
        this.selectionRectTransform
      );
    const rx = (x - scaleSelectionState.x) / scaleSelectionState.w;
    const ry = (y - scaleSelectionState.y) / scaleSelectionState.h;
    const msgs = this.selectedEls.map((el, i) => {
      const oldTransform = this.transformElements[i];
      if (!oldTransform) {
        throw new Error("Mover: Missing transform state while scaling.");
      }
      const bboxX = el.transformedBBox().r[0];
      const bboxY = el.transformedBBox().r[1];
      const a = oldTransform.a * rx;
      const d = oldTransform.d * ry;
      const e =
        scaleSelectionState.x * (1 - rx) -
        bboxX * a +
        (bboxX * oldTransform.a + oldTransform.e) * rx;
      const f =
        scaleSelectionState.y * (1 - ry) -
        bboxY * d +
        (bboxY * oldTransform.d + oldTransform.f) * ry;
      return {
        type: "update",
        id: el.id,
        transform: {
          a: a,
          b: oldTransform.b,
          c: oldTransform.c,
          d: d,
          e: e,
          f: f,
        },
      };
    });

    const tmatrix = this.getTransformMatrix(this.selectionRect);
    tmatrix.a = rx;
    tmatrix.d = ry;
    tmatrix.e =
      rectTransform.e +
      this.selectionRect.x.baseVal.value * (rectTransform.a - rx);
    tmatrix.f =
      rectTransform.f +
      this.selectionRect.y.baseVal.value * (rectTransform.d - ry);
    this.dispatchTransform({ _children: msgs }, force);
  }

  /**
   * @param {{ _children: any[] }} msg
   * @param {boolean} force
   */
  dispatchTransform(msg, force) {
    const now = performance.now();
    if (force || now - this.lastSent > 70) {
      this.lastSent = now;
      this.Tools.drawAndSend(msg, this);
    } else {
      this.draw(msg);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {SVGRectElement} rect
   */
  updateRect(x, y, rect) {
    if (!this.selected) return;
    rect.x.baseVal.value = Math.min(x, this.selected.x);
    rect.y.baseVal.value = Math.min(y, this.selected.y);
    rect.width.baseVal.value = Math.abs(x - this.selected.x);
    rect.height.baseVal.value = Math.abs(y - this.selected.y);
  }

  resetSelectionRect() {
    const bbox = this.selectionRect.transformedBBox();
    const tmatrix = this.getTransformMatrix(this.selectionRect);
    this.selectionRect.x.baseVal.value = bbox.r[0];
    this.selectionRect.y.baseVal.value = bbox.r[1];
    this.selectionRect.width.baseVal.value = bbox.a[0];
    this.selectionRect.height.baseVal.value = bbox.b[1];
    tmatrix.a = 1;
    tmatrix.b = 0;
    tmatrix.c = 0;
    tmatrix.d = 1;
    tmatrix.e = 0;
    tmatrix.f = 0;
  }

  /**
   * @param {SVGGraphicsElement | SVGRectElement} elem
   * @returns {{ a:number, b:number, c:number, d:number, e:number, f:number }}
   */
  getTransformMatrix(elem) {
    let transform = null;
    for (let i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
      const baseVal = elem.transform.baseVal[i];
      if (baseVal && baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
        transform = baseVal;
        break;
      }
    }
    if (transform == null) {
      transform = elem.transform.baseVal.createSVGTransformFromMatrix(
        this.Tools.svg.createSVGMatrix(),
      );
      elem.transform.baseVal.appendItem(transform);
    }
    return transform.matrix;
  }

  /** @param {{ type?: string, id?: string, transform?: any, newid?: string, tool?: string, _children?: any[] }} data */
  draw(data) {
    if (this.isBatchMessage(data)) {
      BoardMessages.batchCall((msg) => this.draw(msg), data._children);
      return;
    }

    switch (data.type) {
      case "update": {
        const elem = this.Tools.svg.getElementById(data.id);
        if (!elem) {
          throw new Error(
            "Mover: Tried to move an element that does not exist.",
          );
        }
        const tmatrix = this.getTransformMatrix(
          /** @type {SVGGraphicsElement & { id: string }} */ (elem),
        );
        tmatrix.a = data.transform.a;
        tmatrix.b = data.transform.b;
        tmatrix.c = data.transform.c;
        tmatrix.d = data.transform.d;
        tmatrix.e = data.transform.e;
        tmatrix.f = data.transform.f;
        break;
      }
      case "copy": {
        if (!this.Tools.drawingArea) {
          throw new Error("Mover: Missing drawing area while copying.");
        }
        const sourceElement = this.Tools.svg.getElementById(data.id);
        if (!this.isSelectableElement(sourceElement)) {
          throw new Error(
            "Mover: Tried to copy an element that does not exist.",
          );
        }
        const newElement = /** @type {SVGGraphicsElement & { id: string }} */ (
          sourceElement.cloneNode(true)
        );
        newElement.id = data.newid || "";
        this.Tools.drawingArea.appendChild(newElement);
        break;
      }
      case "delete":
        data.tool = "Eraser";
        this.Tools.messageForTool(data);
        break;
      default:
        throw new Error("Mover: 'move' instruction with unknown type.");
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ target: EventTarget | null, preventDefault(): void }} evt
   */
  clickSelector(x, y, evt) {
    this.selectionRect = this.selectionRect || this.createSelectorRect();
    let button;
    for (let i = 0; i < this.selectionButtons.length; i++) {
      const candidate = this.selectionButtons[i];
      if (
        candidate &&
        evt.target &&
        candidate.contains(/** @type {Node} */ (evt.target))
      ) {
        button = candidate;
      }
    }
    if (button) {
      button.clickCallback(x, y, evt);
    } else if (
      pointInTransformedBBox([x, y], this.selectionRect.transformedBBox())
    ) {
      this.hideSelectionButtons();
      this.startMovingElements(x, y, evt);
    } else if (
      this.Tools.drawingArea &&
      evt.target &&
      this.Tools.drawingArea.contains(/** @type {Node} */ (evt.target))
    ) {
      this.hideSelectionUI();
      const parent = this.getParentMathematics(evt.target);
      if (!parent) {
        this.startSelector(x, y, evt);
        return;
      }
      this.selectedEls = [parent];
      this.startMovingElements(x, y, evt);
    } else {
      this.hideSelectionButtons();
      this.startSelector(x, y, evt);
    }
  }

  releaseSelector() {
    if (this.selectorState === this.selectorStates.selecting) {
      this.selectedEls = this.calculateSelection();
      if (this.selectedEls.length === 0) this.hideSelectionUI();
    } else if (this.selectorState === this.selectorStates.transform) {
      this.resetSelectionRect();
    }
    if (this.selectedEls.length !== 0) this.showSelectionButtons();
    this.transformElements = [];
    this.selectorState = this.selectorStates.pointing;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ target: EventTarget | null, preventDefault(): void }} evt
   * @param {boolean} force
   */
  moveSelector(x, y, evt, force) {
    void evt;
    if (this.selectorState === this.selectorStates.selecting) {
      this.updateRect(x, y, this.selectionRect);
    } else if (
      this.selectorState === this.selectorStates.transform &&
      this.currentTransform
    ) {
      this.currentTransform(x, y, force);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ clientX?: number, clientY?: number }} evt
   * @param {boolean} isTouchEvent
   */
  startHand(x, y, evt, isTouchEvent) {
    void x;
    void y;
    if (!isTouchEvent) {
      this.selected = {
        x: document.documentElement.scrollLeft + (evt.clientX || 0),
        y: document.documentElement.scrollTop + (evt.clientY || 0),
      };
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{ clientX?: number, clientY?: number }} evt
   * @param {boolean} isTouchEvent
   */
  moveHand(x, y, evt, isTouchEvent) {
    void x;
    void y;
    if (this.selected && !("w" in this.selected) && !isTouchEvent) {
      window.scrollTo(
        this.selected.x - (evt.clientX || 0),
        this.selected.y - (evt.clientY || 0),
      );
    }
  }

  isSelectorActive() {
    return !!(this.secondary && this.secondary.active);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {any} evt
   * @param {boolean} isTouchEvent
   */
  press(x, y, evt, isTouchEvent) {
    if (!this.isSelectorActive()) this.startHand(x, y, evt, isTouchEvent);
    else this.clickSelector(x, y, evt);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {any} evt
   * @param {boolean} isTouchEvent
   * @param {boolean} force
   */
  move(x, y, evt, isTouchEvent, force) {
    if (!this.isSelectorActive()) this.moveHand(x, y, evt, isTouchEvent);
    else this.moveSelector(x, y, evt, force);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {any} evt
   * @param {boolean} isTouchEvent
   */
  release(x, y, evt, isTouchEvent) {
    this.move(x, y, evt, isTouchEvent, true);
    if (this.isSelectorActive()) this.releaseSelector();
    this.selected = null;
  }

  /** @param {{ key: string, target: EventTarget | null }} e */
  deleteShortcut(e) {
    if (
      e.key === "Delete" &&
      (!this.isMatchableTarget(e.target) ||
        !e.target.matches("input[type=text], textarea"))
    ) {
      this.deleteSelection();
    }
  }

  /** @param {{ key: string, target: EventTarget | null }} e */
  duplicateShortcut(e) {
    if (
      e.key === "d" &&
      (!this.isMatchableTarget(e.target) ||
        !e.target.matches("input[type=text], textarea"))
    ) {
      this.duplicateSelection();
    }
  }

  switchTool() {
    this.onquit();
    if (this.isSelectorActive()) {
      window.addEventListener("keydown", this.boundDeleteShortcut);
      window.addEventListener("keydown", this.boundDuplicateShortcut);
    }
  }

  onquit() {
    this.selected = null;
    this.hideSelectionUI();
    window.removeEventListener("keydown", this.boundDeleteShortcut);
    window.removeEventListener("keydown", this.boundDuplicateShortcut);
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<HandTool>}
   */
  static async boot(ctx) {
    return new HandTool(ctx.runtime.Tools, ctx.assetUrl);
  }
}
