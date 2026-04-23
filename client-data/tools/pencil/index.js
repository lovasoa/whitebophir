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

import { LIMITS } from "../../js/message_common.js";
import { logFrontendEvent } from "../../js/frontend_logging.js";
import { MutationType } from "../../js/mutation_type.js";
import { wboPencilPoint } from "./wbo_pencil_point.js";
/** @import { MountedAppToolsState, MutationCode, ToolBootContext } from "../../../types/app-runtime" */

/**
 * @param {number} value
 * @returns {number}
 */
function roundPathValue(value) {
  return Math.round(value);
}

/**
 * Parse a canonical persisted pencil path emitted by renderPencilPath:
 * `M <x> <y> l <dx> <dy> ...`
 *
 * @param {string} d
 * @param {number} index
 * @returns {{value: number, index: number} | null}
 */
function readCanonicalPathInteger(d, index) {
  const length = d.length;
  let next = index;
  let sign = 1;
  if (next < length && d.charCodeAt(next) === 45) {
    sign = -1;
    next += 1;
  }
  if (next >= length) return null;
  let code = d.charCodeAt(next) - 48;
  if (code < 0 || code > 9) return null;
  let value = 0;
  while (next < length && code >= 0 && code <= 9) {
    value = value * 10 + code;
    next += 1;
    if (next >= length) break;
    code = d.charCodeAt(next) - 48;
  }
  return { value: sign * value, index: next };
}

/**
 * @param {string | undefined} d
 * @returns {{
 *   childCount: number,
 *   localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null,
 *   lastPoint: {x: number, y: number} | null,
 * }}
 */
const EMPTY_PERSISTED_PENCIL_SCAN = {
  childCount: 0,
  localBounds: null,
  lastPoint: null,
};

/**
 * @param {string | undefined} d
 * @returns {{
 *   childCount: number,
 *   localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null,
 *   lastPoint: {x: number, y: number} | null,
 * }}
 */
function scanPersistedPencilPath(d) {
  if (typeof d !== "string" || d === "") return EMPTY_PERSISTED_PENCIL_SCAN;
  const length = d.length;
  if (length < 5 || d.charCodeAt(0) !== 77 || d.charCodeAt(1) !== 32)
    return EMPTY_PERSISTED_PENCIL_SCAN;

  let index = 2;
  const firstX = readCanonicalPathInteger(d, index);
  if (!firstX || firstX.index >= length || d.charCodeAt(firstX.index) !== 32)
    return EMPTY_PERSISTED_PENCIL_SCAN;
  index = firstX.index + 1;
  const firstY = readCanonicalPathInteger(d, index);
  if (!firstY) return EMPTY_PERSISTED_PENCIL_SCAN;
  index = firstY.index;

  let currentX = firstX.value;
  let currentY = firstY.value;
  let minX = currentX;
  let minY = currentY;
  let maxX = currentX;
  let maxY = currentY;
  let childCount = 1;
  let previousDistinctX = currentX;
  let previousDistinctY = currentY;

  while (index < length) {
    if (
      index + 2 >= length ||
      d.charCodeAt(index) !== 32 ||
      d.charCodeAt(index + 1) !== 108 ||
      d.charCodeAt(index + 2) !== 32
    ) {
      return EMPTY_PERSISTED_PENCIL_SCAN;
    }
    index += 3;
    const deltaX = readCanonicalPathInteger(d, index);
    if (!deltaX || deltaX.index >= length || d.charCodeAt(deltaX.index) !== 32)
      return EMPTY_PERSISTED_PENCIL_SCAN;
    index = deltaX.index + 1;
    const deltaY = readCanonicalPathInteger(d, index);
    if (!deltaY) return EMPTY_PERSISTED_PENCIL_SCAN;
    index = deltaY.index;
    currentX += deltaX.value;
    currentY += deltaY.value;
    if (previousDistinctX === currentX && previousDistinctY === currentY) {
      continue;
    }
    previousDistinctX = currentX;
    previousDistinctY = currentY;
    childCount += 1;
    if (currentX < minX) minX = currentX;
    else if (currentX > maxX) maxX = currentX;
    if (currentY < minY) minY = currentY;
    else if (currentY > maxY) maxY = currentY;
  }

  return {
    childCount,
    localBounds: { minX, minY, maxX, maxY },
    lastPoint: { x: currentX, y: currentY },
  };
}

/**
 * @param {string | undefined} d
 * @returns {{childCount: number, localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null}}
 */
function scanPathSummary(d) {
  const scanned = scanPersistedPencilPath(d);
  return {
    childCount: scanned.childCount,
    localBounds: scanned.localBounds,
  };
}

/**
 * @param {string | undefined} d
 * @param {{x: number, y: number}[]} points
 * @returns {string}
 */
function appendPersistedPencilPath(d, points) {
  if (!Array.isArray(points) || points.length === 0) {
    return typeof d === "string" ? d : "";
  }
  const scanned = scanPersistedPencilPath(d);
  if (!scanned.lastPoint) return "";
  let lastX = scanned.lastPoint.x;
  let lastY = scanned.lastPoint.y;
  let pathData = d || "";
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const x = roundPathValue(point.x);
    const y = roundPathValue(point.y);
    pathData += ` l ${x - lastX} ${y - lastY}`;
    lastX = x;
    lastY = y;
  }
  return pathData;
}

/**
 * @param {{x: number, y: number}[]} points
 * @returns {string}
 */
function renderPencilPath(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  const firstPoint = points[0];
  if (
    !firstPoint ||
    !Number.isFinite(firstPoint.x) ||
    !Number.isFinite(firstPoint.y)
  ) {
    return "";
  }
  let lastX = roundPathValue(firstPoint.x);
  let lastY = roundPathValue(firstPoint.y);
  let pathData = `M ${lastX} ${lastY}`;
  if (points.length === 1) return `${pathData} l 0 0`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const x = roundPathValue(point.x);
    const y = roundPathValue(point.y);
    pathData += ` l ${x - lastX} ${y - lastY}`;
    lastX = x;
    lastY = y;
  }
  return pathData;
}

/**
 * @param {{id?: string, color?: string, size?: number, opacity?: number, transform?: any}} item
 * @param {string} pathData
 * @param {{escapeHtml: (value: string) => string, numberOrZero: (value: unknown) => number, renderTransformAttribute: (transform: any) => string}} helpers
 * @returns {string}
 */
function serializeStoredPencilPath(item, pathData, helpers) {
  if (!pathData) return "";
  const transform = helpers.renderTransformAttribute(item.transform);
  const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
  const color = helpers.escapeHtml(item.color || "#000000");
  const size = helpers.numberOrZero(item.size) | 0;
  const opacity =
    typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
  return (
    `<path id="${id}" d="${helpers.escapeHtml(pathData)}"` +
    ` stroke="${color}" stroke-width="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacity}${transform}></path>`
  );
}

export {
  appendPersistedPencilPath,
  renderPencilPath,
  scanPathSummary,
  serializeStoredPencilPath,
};

export const toolId = "pencil";
export const drawsOnBoard = true;

/** @type {import("../shape_contract.js").ToolContract} */
const contract = {
  toolId,
  payloadKind: "children",
  storedTagName: "path",
  liveMessageFields: {
    [MutationType.CREATE]: {
      id: "id",
      color: "color",
      size: "size",
      opacity: "opacity?",
    },
    [MutationType.APPEND]: {
      parent: "id",
      x: "coord",
      y: "coord",
    },
  },
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    const scanned = scanPathSummary(helpers.readStoredSvgAttribute(entry, "d"));
    if (size === undefined || scanned.childCount === 0) return null;
    return {
      id: helpers.id,
      tool: contract.toolId,
      data: helpers.decorateStoredItemData(
        {
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        helpers.opacity,
        helpers.transform,
      ),
      childCount: scanned.childCount,
      paintOrder,
      localBounds: scanned.localBounds,
    };
  },
  serializeStoredSvgItem(item, helpers) {
    const points = Array.isArray(item._children) ? item._children : [];
    const pathData = renderPencilPath(points);
    return serializeStoredPencilPath(item, pathData, helpers);
  },
  renderBoardSvg(pencil, helpers) {
    const pathstring = renderPencilPath(pencil._children || []);
    return helpers.renderPath(pencil, pathstring);
  },
};

export { contract };
export const shortcut = "p";
export const serverRenderedElementSelector = "path";
const ACTIVE_DRAWING_CLASS = "wbo-pencil-drawing";
/** @typedef {{Tools: MountedAppToolsState, AUTO_FINGER_WHITEOUT: boolean, MAX_PENCIL_CHILDREN: number, minPencilIntervalMs: number, hasUsedStylus: boolean, curLineId: string, lastTime: number, hasSentPoint: boolean, currentLineChildCount: number, renderingLine: SVGPathElement | null, pathDataCache: {[lineId: string]: any[]}, drawingSize: number, whiteOutSize: number, secondary: {name: string, icon: string, active: boolean, switch?: () => void}, mouseCursor: string}} PencilState */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function getPositiveNumber(value, fallback) {
  const number = Number(value);
  return number > 0 ? number : fallback;
}

/** @param {MountedAppToolsState} Tools */
function computeMinPencilIntervalMs(Tools) {
  const generalLimit =
    Tools.getEffectiveRateLimit?.("general") ??
    Tools.server_config?.RATE_LIMITS?.general ??
    {};
  return (
    getPositiveNumber(generalLimit.periodMs, 4096) /
    getPositiveNumber(generalLimit.limit, 192)
  );
}

/**
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 * @returns {{type: MutationCode, parent: string, x: number, y: number}}
 */
function createPointMessage(state, x, y) {
  return { type: MutationType.APPEND, parent: state.curLineId, x, y };
}

/**
 * @param {PencilState} state
 * @param {SVGPathElement & {id: string}} line
 */
function getPathData(state, line) {
  let pathData = state.pathDataCache[line.id];
  if (!pathData) {
    pathData = line.getPathData();
    state.pathDataCache[line.id] = pathData;
  }
  return pathData;
}

/**
 * @param {PencilState} state
 * @param {string | undefined} lineId
 * @returns {(SVGPathElement & {id: string}) | null}
 */
function getLineById(state, lineId) {
  if (!lineId) return null;
  const line =
    document.getElementById(lineId) ||
    (state.Tools.svg ? state.Tools.svg.getElementById(lineId) : null);
  return line instanceof SVGPathElement
    ? /** @type {SVGPathElement & {id: string}} */ (line)
    : null;
}

/**
 * @param {SVGPathElement & {id: string} | null} line
 * @param {boolean} active
 */
function updateActiveDrawingClass(line, active) {
  if (!line) return;
  const current = String(line.getAttribute("class") || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((name) => name !== ACTIVE_DRAWING_CLASS);
  if (active) current.push(ACTIVE_DRAWING_CLASS);
  line.setAttribute("class", current.join(" "));
}

/** @param {PencilState} state */
function stopLine(state) {
  updateActiveDrawingClass(state.renderingLine, false);
  state.curLineId = "";
  state.hasSentPoint = false;
  state.currentLineChildCount = 0;
  state.renderingLine = null;
}

/**
 * @param {PencilState} state
 * @param {boolean} removeCurrentLine
 */
function abortLine(state, removeCurrentLine) {
  const lineId = state.curLineId;
  stopLine(state);
  if (!removeCurrentLine || !lineId) return;
  const line = getLineById(state, lineId);
  if (!line || line.parentNode !== state.Tools.drawingArea) return;
  state.Tools.drawingArea.removeChild(line);
  delete state.pathDataCache[lineId];
}

/**
 * @param {PencilState} state
 * @param {{type: string, values: number[]}[]} pathData
 * @returns {{type: string, values: number[]}[] | null}
 */
function normalizeServerRenderedPathData(state, pathData) {
  if (!pathData || !pathData.length) return null;
  /** @type {{type: string, values: number[]}[]} */
  const smoothedPathData = [];
  let cursorX = 0;
  let cursorY = 0;
  let hasPoint = false;
  for (const segment of pathData) {
    if (
      !segment ||
      !Array.isArray(segment.values) ||
      segment.values.length < 2
    ) {
      return null;
    }
    const x = Number(segment.values[segment.values.length - 2]);
    const y = Number(segment.values[segment.values.length - 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (segment.type === "M") {
      cursorX = x;
      cursorY = y;
      hasPoint = true;
    } else if (segment.type === "L") {
      if (!hasPoint) return null;
      cursorX = x;
      cursorY = y;
    } else if (segment.type === "m") {
      cursorX += x;
      cursorY += y;
      hasPoint = true;
    } else if (segment.type === "l") {
      if (!hasPoint) return null;
      cursorX += x;
      cursorY += y;
    } else {
      return null;
    }
    wboPencilPoint(smoothedPathData, cursorX, cursorY);
  }
  void state;
  return smoothedPathData;
}

/**
 * @param {PencilState} state
 * @param {{type: MutationCode, id: string, color?: string, size?: number, opacity?: number}} lineData
 * @returns {SVGPathElement & {id: string}}
 */
function createLine(state, lineData) {
  let line = getLineById(state, lineData.id);
  delete state.pathDataCache[lineData.id];
  if (line) line.setPathData([]);
  else {
    line = /** @type {SVGPathElement & {id: string}} */ (
      state.Tools.createSVGElement("path")
    );
  }
  line.id = lineData.id || "";
  line.setAttribute("stroke", lineData.color || "black");
  line.setAttribute("stroke-width", String(lineData.size || 10));
  line.setAttribute(
    "opacity",
    String(Math.max(0.1, Math.min(1, Number(lineData.opacity) || 1))),
  );
  if (line.parentNode !== state.Tools.drawingArea) {
    state.Tools.drawingArea.appendChild(line);
  }
  updateActiveDrawingClass(line, line.id === state.curLineId);
  return line;
}

/** @param {PencilState} state */
function restoreDrawingSize(state) {
  state.whiteOutSize = state.Tools.getSize();
  if (state.drawingSize !== -1) state.Tools.setSize(state.drawingSize);
}

/** @param {PencilState} state */
function restoreWhiteOutSize(state) {
  state.drawingSize = state.Tools.getSize();
  if (state.whiteOutSize !== -1) state.Tools.setSize(state.whiteOutSize);
}

/** @param {PencilState} state */
function toggleSize(state) {
  if (state.secondary.active) restoreWhiteOutSize(state);
  else restoreDrawingSize(state);
}

/**
 * @param {PencilState} state
 * @param {TouchEvent} evt
 */
function handleAutoWhiteOut(state, evt) {
  const touch = evt.touches && evt.touches[0];
  const touchType =
    touch && "touchType" in touch
      ? /** @type {{touchType?: string}} */ (touch).touchType
      : undefined;
  if (touchType === "stylus") {
    if (state.hasUsedStylus && state.Tools.curTool?.secondary?.active) {
      state.Tools.change(toolId);
    }
    state.hasUsedStylus = true;
  }
  if (touchType === "direct") {
    if (
      state.hasUsedStylus &&
      state.Tools.curTool?.secondary &&
      !state.Tools.curTool.secondary.active
    ) {
      state.Tools.change(toolId);
    }
  }
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  const Tools = ctx.Tools;
  const defaultMaxPencilChildren =
    Number(LIMITS.DEFAULT_MAX_CHILDREN) > 0
      ? Number(LIMITS.DEFAULT_MAX_CHILDREN)
      : Number.POSITIVE_INFINITY;
  /** @type {PencilState} */
  const state = {
    Tools,
    AUTO_FINGER_WHITEOUT: Tools.server_config.AUTO_FINGER_WHITEOUT === true,
    MAX_PENCIL_CHILDREN:
      Number(Tools.server_config.MAX_CHILDREN) > 0
        ? Number(Tools.server_config.MAX_CHILDREN)
        : defaultMaxPencilChildren,
    minPencilIntervalMs: computeMinPencilIntervalMs(Tools),
    hasUsedStylus: false,
    curLineId: "",
    lastTime: performance.now(),
    hasSentPoint: false,
    currentLineChildCount: 0,
    renderingLine: null,
    pathDataCache: {},
    drawingSize: -1,
    whiteOutSize: -1,
    secondary: {
      name: "White-out",
      icon: "tools/pencil/whiteout_tape.svg",
      active: false,
    },
    mouseCursor: `url('${ctx.assetUrl("cursor.svg")}'), crosshair`,
  };
  state.secondary.switch = () => {
    stopLine(state);
    toggleSize(state);
  };
  return state;
}

/**
 * @param {PencilState} state
 * @param {any} data
 */
export function draw(state, data) {
  state.Tools.drawingEvent = true;
  switch (data.type) {
    case MutationType.CREATE:
      state.renderingLine = createLine(
        state,
        /** @type {{type: MutationCode, id: string, color?: string, size?: number, opacity?: number}} */ (
          data
        ),
      );
      return;
    case MutationType.APPEND: {
      const childData =
        /** @type {{type: MutationCode, parent: string, x: number, y: number}} */ (
          data
        );
      let line =
        state.renderingLine && state.renderingLine.id === childData.parent
          ? state.renderingLine
          : getLineById(state, childData.parent);
      if (!line) {
        logFrontendEvent("warn", "tool.pencil.append_missing_parent", {
          parentId: childData.parent,
        });
        line = state.renderingLine = createLine(state, {
          type: MutationType.CREATE,
          id: childData.parent,
        });
      }
      line.setPathData(
        wboPencilPoint(getPathData(state, line), childData.x, childData.y),
      );
      return;
    }
    default:
      logFrontendEvent("error", "tool.pencil.draw_invalid_type", {
        mutationType: data?.type,
        message: data,
      });
  }
}

/**
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 */
export function press(state, x, y, evt) {
  evt.preventDefault();
  if (
    state.AUTO_FINGER_WHITEOUT &&
    typeof TouchEvent !== "undefined" &&
    evt instanceof TouchEvent
  ) {
    handleAutoWhiteOut(state, evt);
  }
  state.curLineId = state.Tools.generateUID("l");
  state.hasSentPoint = false;
  state.currentLineChildCount = 0;
  state.Tools.drawAndSend(
    {
      type: MutationType.CREATE,
      id: state.curLineId,
      color: state.secondary.active ? "#ffffff" : state.Tools.getColor(),
      size: state.Tools.getSize(),
      opacity: state.secondary.active ? 1 : state.Tools.getOpacity(),
    },
    toolId,
  );
  move(state, x, y, evt);
}

/**
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 */
export function move(state, x, y, evt) {
  if (
    state.curLineId !== "" &&
    state.currentLineChildCount >= state.MAX_PENCIL_CHILDREN
  ) {
    stopLine(state);
  }
  if (
    state.curLineId !== "" &&
    (!state.hasSentPoint ||
      performance.now() - state.lastTime > state.minPencilIntervalMs)
  ) {
    state.Tools.drawAndSend(createPointMessage(state, x, y), toolId);
    state.currentLineChildCount += 1;
    state.hasSentPoint = true;
    state.lastTime = performance.now();
    if (state.currentLineChildCount >= state.MAX_PENCIL_CHILDREN) {
      stopLine(state);
    }
  }
  if (evt) evt.preventDefault();
}

/**
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 */
export function release(state, x, y) {
  move(state, x, y, undefined);
  stopLine(state);
}

/**
 * @param {PencilState} state
 * @param {SVGElement} line
 */
export function normalizeServerRenderedElement(state, line) {
  if (!(line instanceof SVGPathElement)) return;
  delete state.pathDataCache[line.id];
  const normalizedPathData = normalizeServerRenderedPathData(
    state,
    getPathData(state, line),
  );
  if (!normalizedPathData || normalizedPathData.length === 0) {
    logFrontendEvent("warn", "tool.pencil.path_normalization_failed", {
      id: line.id ?? "",
    });
    const cachedPathData = getPathData(state, line);
    if (cachedPathData && cachedPathData.length > 0) {
      state.pathDataCache[line.id] = cachedPathData;
    } else {
      delete state.pathDataCache[line.id];
    }
    return;
  }
  line.setPathData(normalizedPathData);
  state.pathDataCache[line.id] = normalizedPathData;
}

/**
 * @param {PencilState} state
 * @param {{type?: string | number, id?: string}} message
 */
export function onMessage(state, message) {
  if (message.type === MutationType.CLEAR) {
    abortLine(state, false);
    return;
  }
  if (message.type === MutationType.DELETE && message.id === state.curLineId) {
    abortLine(state, false);
  }
}

/** @param {PencilState} state */
export function onSocketDisconnect(state) {
  abortLine(state, true);
}

/**
 * @param {PencilState} state
 * @param {{id?: string, parent?: string}} message
 */
export function onMutationRejected(state, message) {
  if (
    state.curLineId !== "" &&
    (message.id === state.curLineId || message.parent === state.curLineId)
  ) {
    abortLine(state, false);
  }
}

/** @param {PencilState} state */
export function onstart(state) {
  state.hasUsedStylus = false;
  if (state.secondary.active) restoreWhiteOutSize(state);
}

/** @param {PencilState} state */
export function onquit(state) {
  if (state.secondary.active) restoreDrawingSize(state);
}
