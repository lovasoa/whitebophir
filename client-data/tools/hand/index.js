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

import {
  extendBoundsWithBounds,
  measureSvgElementBoundsAfterTransform,
} from "../../js/board_extent.js";
import { messages as BoardMessages } from "../../js/board_transport.js";
import { logFrontendEvent } from "../../js/frontend_logging.js";
import MessageCommon from "../../js/message_common.js";
import { MutationType } from "../../js/message_tool_metadata.js";
import { ToolCodes } from "../tool-order.js";

/** @import { ToolBootContext, ToolRuntimeModules } from "../../../types/app-runtime" */
/** @typedef {{a:number, b:number, c:number, d:number, e:number, f:number}} TransformState */
/** @typedef {ReturnType<typeof createUpdateChildMessage>} HandUpdateChildMessage */
/** @typedef {ReturnType<typeof createDeleteChildMessage>} HandDeleteChildMessage */
/** @typedef {ReturnType<typeof createCopyChildMessage>} HandCopyChildMessage */
/** @typedef {HandUpdateChildMessage | HandDeleteChildMessage | HandCopyChildMessage} HandChildMessage */
/** @typedef {ReturnType<typeof createBatchMessage>} HandBatchMessage */
/** @template {HandChildMessage} TChild @typedef {{tool: typeof ToolCodes.HAND} & TChild} HandSingleMessage */
/** @typedef {HandSingleMessage<HandUpdateChildMessage>} HandUpdateMessage */
/** @typedef {HandSingleMessage<HandDeleteChildMessage>} HandDeleteMessage */
/** @typedef {HandSingleMessage<HandCopyChildMessage>} HandCopyMessage */
/** @typedef {HandUpdateMessage | HandDeleteMessage | HandCopyMessage | HandBatchMessage} HandDrawMessage */
/** @typedef {HandDrawMessage | HandChildMessage} HandRenderableMessage */
/** @typedef {{type?: unknown, id?: unknown, transform?: unknown, newid?: unknown, _children?: unknown}} HandMessageCandidate */
/** @typedef {SVGImageElement & { origWidth: number, origHeight: number, drawCallback: (button: SelectionButton, bbox: {r:[number,number], a:[number,number], b:[number,number]}, scale:number) => void, clickCallback: (x:number, y:number, evt: { preventDefault(): void }) => void }} SelectionButton */
/** @typedef {import("../../js/intersect.js").Point2D} Point2D */
/** @typedef {import("../../js/intersect.js").TransformedBBox} TransformedBBox */

/** @type {(point: Point2D, box: TransformedBBox) => boolean} */
let pointInTransformedBBox = () => false;

const INTERSECTION_SELECTION_TIMEOUT_MS = 120;

export const toolId = "hand";
export const shortcut = "h";
export const mouseCursor = "move";
export const showMarker = true;
export const touchListenerOptions = { passive: true };
export const visibleWhenReadOnly = true;
export const updatableFields = /** @type {const} */ (["transform"]);
export const batchMessageFields = /** @type {const} */ ({
  [MutationType.UPDATE]: { id: "id", transform: "transform" },
  [MutationType.DELETE]: { id: "id" },
  [MutationType.COPY]: { id: "id", newid: "id" },
});

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
 * @returns {HandMessageCandidate | null}
 */
function handMessageCandidate(value) {
  return value && typeof value === "object"
    ? /** @type {HandMessageCandidate} */ (value)
    : null;
}

/**
 * @param {unknown} value
 * @returns {value is TransformState}
 */
function isTransformState(value) {
  if (!value || typeof value !== "object") return false;
  const transform = /** @type {Partial<TransformState>} */ (value);
  return (
    typeof transform.a === "number" &&
    typeof transform.b === "number" &&
    typeof transform.c === "number" &&
    typeof transform.d === "number" &&
    typeof transform.e === "number" &&
    typeof transform.f === "number"
  );
}

/**
 * @param {unknown} value
 * @returns {value is HandBatchMessage}
 */
function isBatchMessage(value) {
  const message = handMessageCandidate(value);
  return !!message && Array.isArray(message._children);
}

/**
 * @param {unknown} child
 * @returns {child is HandUpdateChildMessage}
 */
function isHandUpdateChild(child) {
  const message = handMessageCandidate(child);
  return !!(
    message &&
    message.type === MutationType.UPDATE &&
    typeof message.id === "string" &&
    isTransformState(message.transform)
  );
}

/**
 * @param {unknown} child
 * @returns {child is HandDeleteChildMessage}
 */
function isHandDeleteChild(child) {
  const message = handMessageCandidate(child);
  return !!(
    message &&
    message.type === MutationType.DELETE &&
    typeof message.id === "string"
  );
}

/**
 * @param {unknown} child
 * @returns {child is HandCopyChildMessage}
 */
function isHandCopyChild(child) {
  const message = handMessageCandidate(child);
  return !!(
    message &&
    message.type === MutationType.COPY &&
    typeof message.id === "string" &&
    typeof message.newid === "string"
  );
}

/**
 * @param {unknown} child
 * @returns {child is HandChildMessage}
 */
function isHandChildMessage(child) {
  return (
    isHandUpdateChild(child) ||
    isHandDeleteChild(child) ||
    isHandCopyChild(child)
  );
}

/**
 * @param {unknown} value
 * @returns {value is HandRenderableMessage}
 */
function isHandRenderableMessage(value) {
  if (isBatchMessage(value)) return value._children.every(isHandChildMessage);
  return isHandChildMessage(value);
}

/**
 * @param {string} id
 * @param {TransformState} transform
 */
function createUpdateChildMessage(id, transform) {
  return {
    type: MutationType.UPDATE,
    id,
    transform,
  };
}

/** @param {string} id */
function createDeleteChildMessage(id) {
  return {
    type: MutationType.DELETE,
    id,
  };
}

/**
 * @param {string} id
 * @param {string} newid
 */
function createCopyChildMessage(id, newid) {
  return {
    type: MutationType.COPY,
    id,
    newid,
  };
}

/** @param {HandChildMessage[]} children */
function createBatchMessage(children) {
  return {
    tool: ToolCodes.HAND,
    _children: children,
  };
}

/**
 * @typedef {{
 *   server_config: ToolRuntimeModules["config"]["serverConfig"],
 *   canWrite: boolean,
 *   drawAndSend: ToolRuntimeModules["writes"]["drawAndSend"],
 *   generateUID: ToolRuntimeModules["ids"]["generateUID"],
 *   createSVGElement: ToolRuntimeModules["board"]["createSVGElement"],
 *   svg: SVGSVGElement,
 *   drawingArea: Element,
 *   viewport: ToolRuntimeModules["viewport"],
 *   getScale: () => number,
 *   messageForTool: ToolRuntimeModules["messages"]["messageForTool"],
 * }} HandRuntime
 */

/**
 * @typedef {{Tools: HandRuntime, assetUrl: (assetFile: string) => string, selectorStates: {pointing: number, selecting: number, transform: number}, selected: any, selectedEls: (SVGGraphicsElement & { id: string })[], selectionRect: SVGRectElement, selectionRectTransform: any, currentTransform: ((x: number, y: number, force: boolean) => void) | null, transformElements: TransformState[], selectorState: number, selectionRunId: number, lastSent: number, blockedSelectionButtons: (number | string)[], selectionButtons: SelectionButton[], boundDeleteShortcut: (e: { key: string, target: EventTarget | null }) => void, boundDuplicateShortcut: (e: { key: string, target: EventTarget | null }) => void, secondary: { name: string, icon: string, active: boolean, switch?: () => void } | null}} HandState
 */

/**
 * @param {HandRuntime} Tools
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
    selectionRunId: 0,
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
  /** @type {HandDeleteChildMessage[]} */
  const msgs = state.selectedEls.map((el) => createDeleteChildMessage(el.id));
  state.Tools.drawAndSend(createBatchMessage(msgs));
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
  /** @type {HandCopyChildMessage[]} */
  const msgs = [];
  for (let i = 0; i < state.selectedEls.length; i++) {
    const selectedElement = state.selectedEls[i];
    if (!selectedElement) continue;
    const id = selectedElement.id;
    msgs[i] = createCopyChildMessage(id, state.Tools.generateUID(id[0]));
  }
  state.Tools.drawAndSend(createBatchMessage(msgs));
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
function getCurrentScale(state) {
  const rawScale =
    typeof state.Tools.getScale === "function" ? state.Tools.getScale() : 1;
  return Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
}

/** @param {HandState} state */
function showSelectionButtons(state) {
  const scale = getCurrentScale(state);
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
  state.selectionRunId += 1;
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

/** @param {HandState} state @returns {(SVGGraphicsElement & { id: string })[]} */
function getSelectableElements(state) {
  const elements = state.Tools.drawingArea.children;
  const selectable = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element && isSelectableElement(element)) {
      selectable.push(element);
    }
  }
  return selectable;
}

/**
 * @param {HandState} state
 * @returns {{left: number, top: number, right: number, bottom: number} | null}
 */
function getSelectionViewportRect(state) {
  const rect = state.selectionRect;
  if (typeof rect.getBoundingClientRect === "function") {
    const clientRect = rect.getBoundingClientRect();
    if (
      Number.isFinite(clientRect.left) &&
      Number.isFinite(clientRect.top) &&
      Number.isFinite(clientRect.right) &&
      Number.isFinite(clientRect.bottom) &&
      clientRect.right > clientRect.left &&
      clientRect.bottom > clientRect.top
    ) {
      return {
        left: clientRect.left,
        top: clientRect.top,
        right: clientRect.right,
        bottom: clientRect.bottom,
      };
    }
  }

  const scale = getCurrentScale(state);
  const scrollLeft = document.documentElement.scrollLeft || 0;
  const scrollTop = document.documentElement.scrollTop || 0;
  const left = rect.x.baseVal.value * scale - scrollLeft;
  const top = rect.y.baseVal.value * scale - scrollTop;
  const right = left + rect.width.baseVal.value * scale;
  const bottom = top + rect.height.baseVal.value * scale;
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/**
 * @param {{left: number, top: number, right: number, bottom: number}} rect
 * @returns {string | null}
 */
function selectionRectRootMargin(rect) {
  const viewportWidth =
    document.documentElement.clientWidth || window.innerWidth || 0;
  const viewportHeight =
    document.documentElement.clientHeight || window.innerHeight || 0;
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  const left = Math.max(0, Math.min(viewportWidth, rect.left));
  const top = Math.max(0, Math.min(viewportHeight, rect.top));
  const right = Math.max(0, Math.min(viewportWidth, rect.right));
  const bottom = Math.max(0, Math.min(viewportHeight, rect.bottom));
  if (right <= left || bottom <= top) return null;

  return `${-top}px ${right - viewportWidth}px ${bottom - viewportHeight}px ${-left}px`;
}

/**
 * @param {IntersectionObserverEntry} entry
 * @returns {boolean}
 */
function isSelectionIntersection(entry) {
  return entry.isIntersecting;
}

/**
 * @param {HandState} state
 * @param {(SVGGraphicsElement & { id: string })[]} selectable
 * @returns {Promise<(SVGGraphicsElement & { id: string })[]>}
 */
function calculateSelectionWithIntersectionObserver(state, selectable) {
  if (selectable.length === 0) return Promise.resolve([]);
  if (typeof IntersectionObserver !== "function") return Promise.resolve([]);

  const viewportRect = getSelectionViewportRect(state);
  if (!viewportRect) return Promise.resolve([]);
  const rootMargin = selectionRectRootMargin(viewportRect);
  if (!rootMargin) return Promise.resolve([]);

  return new Promise((resolve) => {
    /** @type {Set<Element>} */
    const selected = new Set();
    let settled = false;
    /** @type {Set<Element>} */
    const seen = new Set();
    /** @type {IntersectionObserver | null} */
    let observer = null;
    let timeout = 0;

    /** @param {IntersectionObserverEntry[]} entries */
    function collect(entries) {
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (!entry) continue;
        seen.add(entry.target);
        if (isSelectionIntersection(entry)) selected.add(entry.target);
      }
    }

    /** @param {(SVGGraphicsElement & { id: string })[]} value */
    function finish(value) {
      if (settled) return;
      settled = true;
      if (observer) observer.disconnect();
      window.clearTimeout(timeout);
      resolve(value);
    }

    observer = new IntersectionObserver(
      (entries) => {
        collect(entries);
        if (seen.size >= selectable.length) {
          finish(selectable.filter((element) => selected.has(element)));
        }
      },
      {
        root: null,
        rootMargin,
        threshold: 0,
      },
    );
    // Do not fall back to getBBox() here: a board-wide SVG bbox scan forces
    // synchronous layout on dense boards and can freeze or crash the page.
    timeout = window.setTimeout(() => {
      if (!observer) {
        finish([]);
        return;
      }
      collect(observer.takeRecords());
      finish(
        seen.size >= selectable.length
          ? selectable.filter((element) => selected.has(element))
          : [],
      );
    }, INTERSECTION_SELECTION_TIMEOUT_MS);
    for (let index = 0; index < selectable.length; index++) {
      const element = selectable[index];
      if (element) observer.observe(element);
    }
  });
}

/**
 * @param {HandState} state
 * @param {(SVGGraphicsElement & { id: string })[]} selected
 * @param {number} runId
 */
function finishSelection(state, selected, runId) {
  if (runId !== state.selectionRunId) return;
  state.selectedEls = selected;
  if (state.selectedEls.length === 0) hideSelectionUI(state);
  else showSelectionButtons(state);
}

/**
 * @param {HandState} state
 * @param {number} runId
 * @returns {Promise<void> | void}
 */
function selectElementsInSelectionRect(state, runId) {
  return calculateSelectionWithIntersectionObserver(
    state,
    getSelectableElements(state),
  ).then((selected) => finishSelection(state, selected, runId));
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
  /** @type {HandUpdateChildMessage[]} */
  const msgs = state.selectedEls.map((el, i) => {
    const oldTransform = state.transformElements[i];
    if (!oldTransform) {
      throw new Error("Mover: Missing transform state while moving.");
    }
    return createUpdateChildMessage(el.id, {
      a: oldTransform.a,
      b: oldTransform.b,
      c: oldTransform.c,
      d: oldTransform.d,
      e: dx + oldTransform.e,
      f: dy + oldTransform.f,
    });
  });
  const tmatrix = getTransformMatrix(state, state.selectionRect);
  tmatrix.e = dx + rectTranslation.x;
  tmatrix.f = dy + rectTranslation.y;
  dispatchTransform(state, createBatchMessage(msgs), force);
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
  /** @type {HandUpdateChildMessage[]} */
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
    return createUpdateChildMessage(el.id, {
      a: a,
      b: oldTransform.b,
      c: oldTransform.c,
      d: d,
      e: e,
      f: f,
    });
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
  dispatchTransform(state, createBatchMessage(msgs), force);
}

/** @param {HandState} state @param {HandBatchMessage} msg @param {boolean} force */
function dispatchTransform(state, msg, force) {
  const validation = validateTransformBatch(state, msg);
  if (!validation.ok) return;
  const now = performance.now();
  if (force || now - state.lastSent > 70) {
    state.lastSent = now;
    if (state.Tools.drawAndSend(msg) !== false) {
      state.Tools.viewport.ensureBoardExtentForBounds(validation.bounds);
    }
  } else {
    draw(state, msg, true);
    state.Tools.viewport.ensureBoardExtentForBounds(validation.bounds);
  }
}

/**
 * @param {HandState} state
 * @param {HandBatchMessage} msg
 * @returns {{ok: true, bounds: {minX: number, minY: number, maxX: number, maxY: number} | null} | {ok: false}}
 */
function validateTransformBatch(state, msg) {
  const maxBoardSize = state.Tools.server_config.MAX_BOARD_SIZE;
  let bounds = null;
  for (let index = 0; index < msg._children.length; index++) {
    const child = msg._children[index];
    if (!isHandUpdateChild(child)) continue;
    const element = state.Tools.svg.getElementById(child.id);
    if (!isSelectableElement(element)) return { ok: false };
    const effectiveBounds = measureSvgElementBoundsAfterTransform(
      element,
      child.transform,
    );
    if (MessageCommon.isBoundsInvalid(effectiveBounds, maxBoardSize)) {
      return { ok: false };
    }
    bounds = extendBoundsWithBounds(bounds, effectiveBounds);
  }
  return { ok: true, bounds };
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
 * @param {unknown} data
 * @param {boolean} [isLocal]
 */
export function draw(state, data, isLocal = false) {
  if (!isHandRenderableMessage(data)) {
    logFrontendEvent("error", "tool.hand.draw_invalid_type", {
      mutationType: handMessageCandidate(data)?.type,
      message: data,
    });
    return;
  }
  if (isBatchMessage(data)) {
    BoardMessages.batchCall((msg) => draw(state, msg, isLocal), data._children);
    return;
  }

  switch (data.type) {
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
      if (!isLocal) {
        state.Tools.viewport.ensureBoardExtentForBounds(
          measureSvgElementBoundsAfterTransform(elem, data.transform),
        );
      }
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
      newElement.id = data.newid;
      state.Tools.drawingArea.appendChild(newElement);
      break;
    }
    case MutationType.DELETE:
      state.Tools.messageForTool({
        tool: ToolCodes.ERASER,
        type: MutationType.DELETE,
        id: data.id,
      });
      break;
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

/** @param {HandState} state @returns {Promise<void> | void} */
function releaseSelector(state) {
  if (state.selectorState === state.selectorStates.selecting) {
    const runId = state.selectionRunId;
    state.transformElements = [];
    state.selectorState = state.selectorStates.pointing;
    return selectElementsInSelectionRect(state, runId);
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
function resetHandUiState(state) {
  state.selectionRunId += 1;
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
  const result = isSelectorActive(state) ? releaseSelector(state) : undefined;
  state.selected = null;
  return result;
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
  resetHandUiState(state);
  if (isSelectorActive(state)) {
    window.addEventListener("keydown", state.boundDeleteShortcut);
    window.addEventListener("keydown", state.boundDuplicateShortcut);
  }
}

/**
 * @param {ToolBootContext} ctx
 * @returns {HandRuntime}
 */
function createHandRuntime(ctx) {
  const runtime = ctx.runtime;
  return {
    server_config: runtime.config.serverConfig,
    canWrite: runtime.permissions.canWrite(),
    drawAndSend: runtime.writes.drawAndSend,
    generateUID: runtime.ids.generateUID,
    createSVGElement: runtime.board.createSVGElement,
    svg: runtime.board.svg,
    drawingArea: runtime.board.drawingArea,
    viewport: runtime.viewport,
    getScale: () => runtime.viewport.getScale(),
    messageForTool: runtime.messages.messageForTool,
  };
}

/** @param {ToolBootContext} ctx */
export async function boot(ctx) {
  ({ pointInTransformedBBox } = await import("../../js/intersect.js"));
  return createState(createHandRuntime(ctx), ctx.assetUrl);
}

/** @param {HandState} state */
export function onquit(state) {
  resetHandUiState(state);
}

/** @param {HandState} state */
export function getTouchPolicy(state) {
  return isSelectorActive(state) ? "app-gesture" : "native-pan";
}

/** @param {HandState} state */
export function onSocketDisconnect(state) {
  return onquit(state);
}
