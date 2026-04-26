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
import MessageCommon from "../../js/message_common.js";
import {
  getMutationType,
  MutationType,
} from "../../js/message_tool_metadata.js";
import { Eraser } from "../index.js";
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {{a:number, b:number, c:number, d:number, e:number, f:number}} TransformState */
/** @typedef {SVGImageElement & { origWidth: number, origHeight: number, drawCallback: (button: SelectionButton, bbox: {r:[number,number], a:[number,number], b:[number,number]}, scale:number) => void, clickCallback: (x:number, y:number, evt: { preventDefault(): void }) => void }} SelectionButton */
/** @typedef {import("../../js/intersect.js").Point2D} Point2D */
/** @typedef {import("../../js/intersect.js").TransformedBBox} TransformedBBox */

/** @type {(point: Point2D, box: TransformedBBox) => boolean} */
let pointInTransformedBBox = () => false;
/** @type {(bboxA: TransformedBBox, bboxB: TransformedBBox) => boolean} */
let transformedBBoxIntersects = () => false;

export const toolId = "hand";
export const shortcut = "h";
export const mouseCursor = "move";
export const showMarker = true;
export const touchListenerOptions = { passive: true };
export const visibleWhenReadOnly = true;
export const updatableFields = ["transform"];
export const batchMessageFields = {
  [MutationType.UPDATE]: { id: "id", transform: "transform" },
  [MutationType.DELETE]: { id: "id" },
  [MutationType.COPY]: { id: "id", newid: "id" },
};

/**
 * @param {EventTarget | null} target
 * @returns {target is SVGGraphicsElement & { id: string }}
 */
function isSelectableElement(target) {
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
function isMatchableTarget(target) {
  return !!(target && typeof target === "object" && "matches" in target);
}

/**
 * @param {unknown} value
 * @returns {value is {_children: any[]}}
 */
function isBatchMessage(value) {
  return !!(value && typeof value === "object" && "_children" in value);
}

/**
 * @typedef {{Tools: any, assetUrl: (assetFile: string) => string, selectorStates: {pointing: number, selecting: number, transform: number}, selected: any, selectedEls: (SVGGraphicsElement & { id: string })[], selectionRect: SVGRectElement, selectionRectTransform: any, currentTransform: ((x: number, y: number, force: boolean) => void) | null, transformElements: TransformState[], selectorState: number, lastSent: number, blockedSelectionButtons: (number | string)[], selectionButtons: SelectionButton[], boundDeleteShortcut: (e: { key: string, target: EventTarget | null }) => void, boundDuplicateShortcut: (e: { key: string, target: EventTarget | null }) => void, secondary: { name: string, icon: string, active: boolean, switch?: () => void } | null}} HandState
 */

/**
 * @param {any} Tools
 * @param {(assetFile: string) => string} assetUrl
 * @returns {HandState}
 */
function createState(Tools, assetUrl) {
  /** @type {HandState} */
  const state = {
    Tools,
    assetUrl,
    selectorStates: {
      pointing: 0,
      selecting: 1,
      transform: 2,
    },
    selected: null,
    selectedEls: [],
    selectionRect: /** @type {SVGRectElement} */ (
      /** @type {unknown} */ (null)
    ),
    selectionRectTransform: undefined,
    currentTransform: null,
    transformElements: [],
    selectorState: 0,
    lastSent: 0,
    blockedSelectionButtons:
      Tools.server_config.BLOCKED_SELECTION_BUTTONS || [],
    selectionButtons: [],
    boundDeleteShortcut: () => {},
    boundDuplicateShortcut: () => {},
    secondary: null,
  };
  state.selectionRect = createSelectorRect(state);
  state.selectionButtons = [
    createButton(
      state,
      "delete",
      "delete",
      24,
      24,
      (me, bbox, scale) => {
        me.width.baseVal.value = me.origWidth / scale;
        me.height.baseVal.value = me.origHeight / scale;
        me.x.baseVal.value = bbox.r[0];
        me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / scale;
        me.style.display = "";
      },
      (_x, _y, _evt) => deleteSelection(state),
    ),
    createButton(
      state,
      "duplicate",
      "duplicate",
      24,
      24,
      (me, bbox, scale) => {
        me.width.baseVal.value = me.origWidth / scale;
        me.height.baseVal.value = me.origHeight / scale;
        me.x.baseVal.value = bbox.r[0] + (me.origWidth + 2) / scale;
        me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / scale;
        me.style.display = "";
      },
      () => duplicateSelection(state),
    ),
    createButton(
      state,
      "scaleHandle",
      "handle",
      14,
      14,
      (me, bbox, scale) => {
        me.width.baseVal.value = me.origWidth / scale;
        me.height.baseVal.value = me.origHeight / scale;
        me.x.baseVal.value = bbox.r[0] + bbox.a[0] - me.origWidth / (2 * scale);
        me.y.baseVal.value =
          bbox.r[1] + bbox.b[1] - me.origHeight / (2 * scale);
        me.style.display = "";
      },
      (x, y, evt) => startScalingTransform(state, x, y, evt),
    ),
  ];
  state.blockedSelectionButtons.forEach((buttonIndex) => {
    if (typeof buttonIndex === "number") {
      delete state.selectionButtons[buttonIndex];
    }
  });
  state.boundDeleteShortcut = (e) => deleteShortcut(state, e);
  state.boundDuplicateShortcut = (e) => duplicateShortcut(state, e);
  state.secondary = Tools.canWrite
    ? {
        name: "Selector",
        icon: "tools/hand/selector.svg",
        active: false,
        switch: () => switchTool(state),
      }
    : null;
  return state;
}

/**
 * @param {EventTarget | null} el
 * @returns {(SVGGraphicsElement & { id: string }) | null}
 */
function getParentMathematics(el) {
  if (!isSelectableElement(el)) return null;
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
      parentElement && isSelectableElement(parentElement)
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

/** @param {HandState} state */
function deleteSelection(state) {
  const msgs = state.selectedEls.map((el) => ({
    type: MutationType.DELETE,
    id: el.id,
  }));
  state.Tools.drawAndSend({ _children: msgs }, toolId);
  state.selectedEls = [];
  hideSelectionUI(state);
}

/** @param {HandState} state */
function duplicateSelection(state) {
  if (
    state.selectorState !== state.selectorStates.pointing ||
    state.selectedEls.length === 0
  ) {
    return;
  }
  const msgs = [];
  for (let i = 0; i < state.selectedEls.length; i++) {
    const selectedElement = state.selectedEls[i];
    if (!selectedElement) continue;
    const id = selectedElement.id;
    msgs[i] = {
      type: MutationType.COPY,
      id: id,
      newid: state.Tools.generateUID(id[0]),
    };
  }
  state.Tools.drawAndSend({ _children: msgs }, toolId);
}

/** @param {HandState} state @returns {SVGRectElement} */
function createSelectorRect(state) {
  const shape = /** @type {SVGRectElement} */ (
    state.Tools.createSVGElement("rect")
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
  state.Tools.svg.appendChild(shape);
  return shape;
}

/**
 * @param {HandState} state
 * @param {string} name
 * @param {string} icon
 * @param {number} width
 * @param {number} height
 * @param {(button: SelectionButton, bbox: {r:[number,number], a:[number,number], b:[number,number]}, scale:number) => void} drawCallback
 * @param {(x:number, y:number, evt: { preventDefault(): void }) => void} clickCallback
 * @returns {SelectionButton}
 */
function createButton(
  state,
  name,
  icon,
  width,
  height,
  drawCallback,
  clickCallback,
) {
  const shape = /** @type {SelectionButton} */ (
    state.Tools.createSVGElement("image", {
      href: state.assetUrl(`${icon}.svg`),
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
  state.Tools.svg.appendChild(shape);
  return shape;
}

/** @param {HandState} state */
function showSelectionButtons(state) {
  const scale = state.Tools.getScale();
  const selectionBBox = state.selectionRect.transformedBBox();
  for (let i = 0; i < state.selectionButtons.length; i++) {
    const button = state.selectionButtons[i];
    if (button) button.drawCallback(button, selectionBBox, scale);
  }
}

/** @param {HandState} state */
function hideSelectionButtons(state) {
  for (let i = 0; i < state.selectionButtons.length; i++) {
    const button = state.selectionButtons[i];
    if (button) button.style.display = "none";
  }
}

/** @param {HandState} state */
function hideSelectionUI(state) {
  hideSelectionButtons(state);
  state.selectionRect.style.display = "none";
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {{ preventDefault(): void }} evt
 */
function startMovingElements(state, x, y, evt) {
  evt.preventDefault();
  state.selectorState = state.selectorStates.transform;
  state.currentTransform = (moveX, moveY, force) =>
    moveSelection(state, moveX, moveY, force);
  state.selected = { x: x, y: y };
  state.selectedEls = state.selectedEls.filter(
    (el) => state.Tools.svg.getElementById(el.id) !== null,
  );
  state.transformElements = state.selectedEls.map((el) => {
    const tmatrix = getTransformMatrix(state, el);
    return {
      a: tmatrix.a,
      b: tmatrix.b,
      c: tmatrix.c,
      d: tmatrix.d,
      e: tmatrix.e,
      f: tmatrix.f,
    };
  });
  const tmatrix = getTransformMatrix(state, state.selectionRect);
  state.selectionRectTransform = { x: tmatrix.e, y: tmatrix.f };
}

/**
 * @param {HandState} state
 * @param {number} _x
 * @param {number} _y
 * @param {{ preventDefault(): void }} evt
 */
function startScalingTransform(state, _x, _y, evt) {
  evt.preventDefault();
  hideSelectionButtons(state);
  state.selectorState = state.selectorStates.transform;
  const bbox = state.selectionRect.transformedBBox();
  state.selected = {
    x: bbox.r[0],
    y: bbox.r[1],
    w: bbox.a[0],
    h: bbox.b[1],
  };
  state.transformElements = state.selectedEls.map((el) => {
    const tmatrix = getTransformMatrix(state, el);
    return {
      a: tmatrix.a,
      b: tmatrix.b,
      c: tmatrix.c,
      d: tmatrix.d,
      e: tmatrix.e,
      f: tmatrix.f,
    };
  });
  const tmatrix = getTransformMatrix(state, state.selectionRect);
  state.selectionRectTransform = {
    a: tmatrix.a,
    d: tmatrix.d,
    e: tmatrix.e,
    f: tmatrix.f,
  };
  state.currentTransform = (moveX, moveY, force) =>
    scaleSelection(state, moveX, moveY, force);
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {{ preventDefault(): void }} evt
 */
function startSelector(state, x, y, evt) {
  evt.preventDefault();
  state.selected = { x: x, y: y };
  state.selectedEls = [];
  state.selectorState = state.selectorStates.selecting;
  state.selectionRect.x.baseVal.value = x;
  state.selectionRect.y.baseVal.value = y;
  state.selectionRect.width.baseVal.value = 0;
  state.selectionRect.height.baseVal.value = 0;
  state.selectionRect.style.display = "";
  const tmatrix = getTransformMatrix(state, state.selectionRect);
  tmatrix.e = 0;
  tmatrix.f = 0;
}

/** @param {HandState} state */
function calculateSelection(state) {
  const selectionTBBox = state.selectionRect.transformedBBox();
  const elements = state.Tools.drawingArea.children;
  const selected = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (
      element &&
      isSelectableElement(element) &&
      transformedBBoxIntersects(selectionTBBox, element.transformedBBox())
    ) {
      selected.push(element);
    }
  }
  return selected;
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {boolean} force
 */
function moveSelection(state, x, y, force) {
  if (
    !state.selected ||
    !state.selectionRectTransform ||
    !("x" in state.selectionRectTransform)
  ) {
    return;
  }
  const rectTranslation = /** @type {{x: number, y: number}} */ (
    state.selectionRectTransform
  );
  const dx = x - state.selected.x;
  const dy = y - state.selected.y;
  const msgs = state.selectedEls.map((el, i) => {
    const oldTransform = state.transformElements[i];
    if (!oldTransform) {
      throw new Error("Mover: Missing transform state while moving.");
    }
    return {
      type: MutationType.UPDATE,
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
  const tmatrix = getTransformMatrix(state, state.selectionRect);
  tmatrix.e = dx + rectTranslation.x;
  tmatrix.f = dy + rectTranslation.y;
  dispatchTransform(state, { _children: msgs }, force);
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {boolean} force
 */
function scaleSelection(state, x, y, force) {
  if (
    !state.selected ||
    !state.selectionRectTransform ||
    !("a" in state.selectionRectTransform) ||
    !("w" in state.selected) ||
    !("h" in state.selected)
  ) {
    return;
  }
  const scaleSelectionState =
    /** @type {{x: number, y: number, w: number, h: number}} */ (
      state.selected
    );
  const rectTransform =
    /** @type {{a: number, d: number, e: number, f: number}} */ (
      state.selectionRectTransform
    );
  const rx = (x - scaleSelectionState.x) / scaleSelectionState.w;
  const ry = (y - scaleSelectionState.y) / scaleSelectionState.h;
  const msgs = state.selectedEls.map((el, i) => {
    const oldTransform = state.transformElements[i];
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
      type: MutationType.UPDATE,
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

  const tmatrix = getTransformMatrix(state, state.selectionRect);
  tmatrix.a = rx;
  tmatrix.d = ry;
  tmatrix.e =
    rectTransform.e +
    state.selectionRect.x.baseVal.value * (rectTransform.a - rx);
  tmatrix.f =
    rectTransform.f +
    state.selectionRect.y.baseVal.value * (rectTransform.d - ry);
  dispatchTransform(state, { _children: msgs }, force);
}

/** @param {HandState} state @param {{ _children: any[] }} msg @param {boolean} force */
function dispatchTransform(state, msg, force) {
  if (!canApplyTransformBatch(state, msg)) {
    return;
  }
  const now = performance.now();
  if (force || now - state.lastSent > 70) {
    state.lastSent = now;
    state.Tools.drawAndSend(msg, toolId);
  } else {
    draw(state, msg);
  }
}

/**
 * @param {SVGGraphicsElement & { id: string }} element
 * @returns {{minX: number, minY: number, maxX: number, maxY: number} | null}
 */
function getElementLocalBounds(element) {
  const bbox = element.getBBox();
  if (
    !Number.isFinite(bbox.x) ||
    !Number.isFinite(bbox.y) ||
    !Number.isFinite(bbox.width) ||
    !Number.isFinite(bbox.height)
  ) {
    return null;
  }
  return {
    minX: bbox.x,
    minY: bbox.y,
    maxX: bbox.x + bbox.width,
    maxY: bbox.y + bbox.height,
  };
}

/**
 * @param {HandState} state
 * @param {{_children?: any[]}} msg
 * @returns {boolean}
 */
function canApplyTransformBatch(state, msg) {
  if (!Array.isArray(msg?._children)) return true;
  const maxBoardSize = state.Tools.server_config.MAX_BOARD_SIZE;
  for (let index = 0; index < msg._children.length; index++) {
    const child = msg._children[index];
    if (getMutationType(child) !== MutationType.UPDATE) continue;
    const element = state.Tools.svg.getElementById(child.id);
    if (!isSelectableElement(element)) return false;
    const localBounds = getElementLocalBounds(element);
    const effectiveBounds = MessageCommon.applyTransformToBounds(
      localBounds,
      child.transform,
    );
    if (MessageCommon.isBoundsInvalid(effectiveBounds, maxBoardSize)) {
      return false;
    }
  }
  return true;
}

/** @param {HandState} state @param {number} x @param {number} y @param {SVGRectElement} rect */
function updateRect(state, x, y, rect) {
  if (!state.selected) return;
  rect.x.baseVal.value = Math.min(x, state.selected.x);
  rect.y.baseVal.value = Math.min(y, state.selected.y);
  rect.width.baseVal.value = Math.abs(x - state.selected.x);
  rect.height.baseVal.value = Math.abs(y - state.selected.y);
}

/** @param {HandState} state */
function resetSelectionRect(state) {
  const bbox = state.selectionRect.transformedBBox();
  const tmatrix = getTransformMatrix(state, state.selectionRect);
  state.selectionRect.x.baseVal.value = bbox.r[0];
  state.selectionRect.y.baseVal.value = bbox.r[1];
  state.selectionRect.width.baseVal.value = bbox.a[0];
  state.selectionRect.height.baseVal.value = bbox.b[1];
  tmatrix.a = 1;
  tmatrix.b = 0;
  tmatrix.c = 0;
  tmatrix.d = 1;
  tmatrix.e = 0;
  tmatrix.f = 0;
}

/**
 * @param {HandState} state
 * @param {SVGGraphicsElement | SVGRectElement} elem
 * @returns {{ a:number, b:number, c:number, d:number, e:number, f:number }}
 */
function getTransformMatrix(state, elem) {
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
      state.Tools.svg.createSVGMatrix(),
    );
    elem.transform.baseVal.appendItem(transform);
  }
  return transform.matrix;
}

/**
 * @param {HandState} state
 * @param {{ type?: string | number, id?: string, transform?: any, newid?: string, tool?: string | number, _children?: any[] }} data
 */
export function draw(state, data) {
  if (isBatchMessage(data)) {
    BoardMessages.batchCall((msg) => draw(state, msg), data._children);
    return;
  }

  switch (getMutationType(data)) {
    case MutationType.UPDATE: {
      const elem = state.Tools.svg.getElementById(data.id);
      if (!elem) {
        throw new Error("Mover: Tried to move an element that does not exist.");
      }
      const tmatrix = getTransformMatrix(
        state,
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
    case MutationType.COPY: {
      const sourceElement = state.Tools.svg.getElementById(data.id);
      if (!isSelectableElement(sourceElement)) {
        throw new Error("Mover: Tried to copy an element that does not exist.");
      }
      const newElement = /** @type {SVGGraphicsElement & { id: string }} */ (
        sourceElement.cloneNode(true)
      );
      newElement.id = data.newid || "";
      state.Tools.drawingArea.appendChild(newElement);
      break;
    }
    case MutationType.DELETE:
      data.tool = Eraser.id;
      state.Tools.messageForTool(data);
      break;
    default:
      throw new Error("Mover: 'move' instruction with unknown type.");
  }
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {{ target: EventTarget | null, preventDefault(): void }} evt
 */
function clickSelector(state, x, y, evt) {
  let button;
  for (let i = 0; i < state.selectionButtons.length; i++) {
    const candidate = state.selectionButtons[i];
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
    pointInTransformedBBox([x, y], state.selectionRect.transformedBBox())
  ) {
    hideSelectionButtons(state);
    startMovingElements(state, x, y, evt);
  } else if (
    evt.target &&
    state.Tools.drawingArea.contains(/** @type {Node} */ (evt.target))
  ) {
    hideSelectionUI(state);
    const parent = getParentMathematics(evt.target);
    if (!parent) {
      startSelector(state, x, y, evt);
      return;
    }
    state.selectedEls = [parent];
    startMovingElements(state, x, y, evt);
  } else {
    hideSelectionButtons(state);
    startSelector(state, x, y, evt);
  }
}

/** @param {HandState} state */
function releaseSelector(state) {
  if (state.selectorState === state.selectorStates.selecting) {
    state.selectedEls = calculateSelection(state);
    if (state.selectedEls.length === 0) hideSelectionUI(state);
  } else if (state.selectorState === state.selectorStates.transform) {
    resetSelectionRect(state);
  }
  if (state.selectedEls.length !== 0) showSelectionButtons(state);
  state.transformElements = [];
  state.selectorState = state.selectorStates.pointing;
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {{ target: EventTarget | null, preventDefault(): void }} _evt
 * @param {boolean} force
 */
function moveSelector(state, x, y, _evt, force) {
  if (state.selectorState === state.selectorStates.selecting) {
    updateRect(state, x, y, state.selectionRect);
  } else if (
    state.selectorState === state.selectorStates.transform &&
    state.currentTransform
  ) {
    state.currentTransform(x, y, force);
  }
}

/** @param {MouseEvent | TouchEvent} evt @param {"clientX" | "clientY"} axis @returns {number} */
function getPointerClientCoord(evt, axis) {
  if ("changedTouches" in evt) {
    const touch = evt.changedTouches[0];
    return touch ? touch[axis] || 0 : 0;
  }
  if (axis === "clientX" && "clientX" in evt) return evt.clientX || 0;
  if (axis === "clientY" && "clientY" in evt) return evt.clientY || 0;
  return 0;
}

/**
 * @param {HandState} state
 * @param {number} _x
 * @param {number} _y
 * @param {MouseEvent | TouchEvent} evt
 * @param {boolean} isTouchEvent
 */
function startHand(state, _x, _y, evt, isTouchEvent) {
  void _x;
  void _y;
  if (isTouchEvent) return;
  if (evt.cancelable) evt.preventDefault();
  state.Tools.viewport.beginPan(
    getPointerClientCoord(evt, "clientX"),
    getPointerClientCoord(evt, "clientY"),
  );
  state.selected = { pan: true };
}

/**
 * @param {HandState} state
 * @param {number} _x
 * @param {number} _y
 * @param {MouseEvent | TouchEvent} evt
 * @param {boolean} isTouchEvent
 */
function moveHand(state, _x, _y, evt, isTouchEvent) {
  void _x;
  void _y;
  if (isTouchEvent) return;
  if (state.selected && !("w" in state.selected)) {
    if (evt.cancelable) evt.preventDefault();
    state.Tools.viewport.movePan(
      getPointerClientCoord(evt, "clientX"),
      getPointerClientCoord(evt, "clientY"),
    );
  }
}

/** @param {HandState} state */
function endHand(state) {
  state.Tools.viewport.endPan();
}

/** @param {HandState} state */
function isSelectorActive(state) {
  return !!(state.secondary && state.secondary.active);
}

/**
 * @param {HandState} state
 * @returns {void}
 */
function syncHandTouchAction(state) {
  const touchAction = isSelectorActive(state) ? "" : "auto";
  if (state.Tools.board) state.Tools.board.style.touchAction = touchAction;
  if (state.Tools.svg) state.Tools.svg.style.touchAction = touchAction;
}

/**
 * @param {HandState} state
 * @param {{resetTouchAction: boolean}} options
 * @returns {void}
 */
function resetHandUiState(state, options) {
  if (options.resetTouchAction) {
    if (state.Tools.board) state.Tools.board.style.touchAction = "";
    if (state.Tools.svg) state.Tools.svg.style.touchAction = "";
  } else {
    syncHandTouchAction(state);
  }
  state.selected = null;
  hideSelectionUI(state);
  window.removeEventListener("keydown", state.boundDeleteShortcut);
  window.removeEventListener("keydown", state.boundDuplicateShortcut);
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 * @param {boolean} isTouchEvent
 */
export function press(state, x, y, evt, isTouchEvent) {
  if (!isSelectorActive(state)) startHand(state, x, y, evt, isTouchEvent);
  else clickSelector(state, x, y, evt);
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 * @param {boolean} isTouchEvent
 */
export function move(state, x, y, evt, isTouchEvent) {
  if (!isSelectorActive(state)) moveHand(state, x, y, evt, isTouchEvent);
  else moveSelector(state, x, y, evt, false);
}

/**
 * @param {HandState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 * @param {boolean} isTouchEvent
 */
export function release(state, x, y, evt, isTouchEvent) {
  if (!isSelectorActive(state)) {
    if (!isTouchEvent) {
      moveHand(state, x, y, evt, false);
      endHand(state);
    }
  } else moveSelector(state, x, y, evt, true);
  if (isSelectorActive(state)) releaseSelector(state);
  state.selected = null;
}

/** @param {HandState} state @param {{ key: string, target: EventTarget | null }} e */
function deleteShortcut(state, e) {
  if (
    e.key === "Delete" &&
    (!isMatchableTarget(e.target) ||
      !e.target.matches("input[type=text], textarea"))
  ) {
    deleteSelection(state);
  }
}

/** @param {HandState} state @param {{ key: string, target: EventTarget | null }} e */
function duplicateShortcut(state, e) {
  if (
    e.key === "d" &&
    (!isMatchableTarget(e.target) ||
      !e.target.matches("input[type=text], textarea"))
  ) {
    duplicateSelection(state);
  }
}

/** @param {HandState} state */
function switchTool(state) {
  resetHandUiState(state, { resetTouchAction: false });
  if (isSelectorActive(state)) {
    window.addEventListener("keydown", state.boundDeleteShortcut);
    window.addEventListener("keydown", state.boundDuplicateShortcut);
  }
}

/** @param {ToolBootContext} ctx */
export async function boot(ctx) {
  ({ pointInTransformedBBox, transformedBBoxIntersects } = await import(
    "../../js/intersect.js"
  ));
  return createState(ctx.Tools, ctx.assetUrl);
}

/** @param {HandState} state */
export function onquit(state) {
  resetHandUiState(state, { resetTouchAction: true });
}

/** @param {HandState} state */
export function onstart(state) {
  syncHandTouchAction(state);
}

/** @param {HandState} state */
export function onSocketDisconnect(state) {
  return onquit(state);
}
