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
import { ToolCodes } from "../tool-order.js";
import { wboPencilPoint } from "./wbo_pencil_point.js";
/** @import { ToolBootContext, ToolRuntimeModules } from "../../../types/app-runtime" */
/** @typedef {Omit<ReturnType<typeof createLineMessage>, "opacity"> & {opacity?: number}} PencilCreateMessage */
/** @typedef {ReturnType<typeof createPointMessage>} PencilAppendMessage */
/** @typedef {PencilCreateMessage | PencilAppendMessage} PencilMessage */
/** @typedef {Pick<PencilCreateMessage, "type" | "id"> & Partial<Pick<PencilCreateMessage, "color" | "size" | "opacity">>} PencilLineData */
/** @typedef {import("../shape_contract.js").SvgTransform} StoredPencilTransform */
/** @typedef {{id?: string, color?: string, size?: number, opacity?: number, transform?: StoredPencilTransform}} StoredPencilPathItem */
/** @typedef {{escapeHtml: (value: string) => string, numberOrZero: (value: unknown) => number, renderTransformAttribute: (transform: StoredPencilTransform | undefined) => string}} StoredPencilPathSerializeHelpers */

/**
 * @param {unknown} data
 * @returns {data is PencilMessage}
 */
function isPencilMessage(data) {
  if (!data || typeof data !== "object") return false;
  const message = /** @type {Partial<PencilMessage>} */ (data);
  if (message.tool !== ToolCodes.PENCIL) return false;
  if (message.type === MutationType.CREATE) {
    return (
      typeof message.id === "string" &&
      typeof message.color === "string" &&
      typeof message.size === "number"
    );
  }
  return (
    message.type === MutationType.APPEND &&
    typeof message.parent === "string" &&
    typeof message.x === "number" &&
    typeof message.y === "number"
  );
}

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
 * @param {StoredPencilPathItem} item
 * @param {string} pathData
 * @param {StoredPencilPathSerializeHelpers} helpers
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
  toolCode: ToolCodes.PENCIL,
  payloadKind: "children",
  storedTagName: "path",
  liveMessageFields: /** @type {const} */ ({
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
  }),
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
/** @typedef {{type: string, values: number[]}} PencilPathSegment */
/** @typedef {PencilPathSegment[]} PencilPathData */
/** @typedef {{name: string, icon: string, active: boolean, switch?: () => void}} PencilSecondary */
/** @typedef {ReturnType<typeof createInitialState>} PencilState */
/** @typedef {{lineId: string, createMessage: PencilCreateMessage}} PencilPressEffect */
/** @typedef {{appendMessage: PencilAppendMessage | null, stopBefore: boolean, stopAfter: boolean, nextLastTime: number, nextHasSentPoint: boolean, nextChildCount: number}} PencilMoveEffect */

/** @param {ToolBootContext} ctx */
function createInitialState(ctx) {
  const runtime = ctx.runtime;
  const serverConfig = runtime.config.serverConfig;
  const defaultMaxPencilChildren =
    Number(LIMITS.DEFAULT_MAX_CHILDREN) > 0
      ? Number(LIMITS.DEFAULT_MAX_CHILDREN)
      : Number.POSITIVE_INFINITY;
  return {
    board: runtime.board,
    preferences: runtime.preferences,
    writes: runtime.writes,
    rateLimits: runtime.rateLimits,
    runtimeConfig: runtime.config,
    ids: runtime.ids,
    interaction: runtime.interaction,
    toolRegistry: runtime.toolRegistry,
    AUTO_FINGER_WHITEOUT: serverConfig.AUTO_FINGER_WHITEOUT === true,
    MAX_PENCIL_CHILDREN:
      Number(serverConfig.MAX_CHILDREN) > 0
        ? Number(serverConfig.MAX_CHILDREN)
        : defaultMaxPencilChildren,
    minPencilIntervalMs: computeMinPencilIntervalMs(runtime.rateLimits),
    hasUsedStylus: false,
    curLineId: "",
    lastTime: performance.now(),
    hasSentPoint: false,
    currentLineChildCount: 0,
    renderingLine: /** @type {SVGPathElement | null} */ (null),
    pathDataCache: /** @type {Record<string, PencilPathData>} */ ({}),
    drawingSize: -1,
    whiteOutSize: -1,
    secondary: /** @type {PencilSecondary} */ ({
      name: "White-out",
      icon: "tools/pencil/whiteout_tape.svg",
      active: false,
    }),
    mouseCursor: `url('${ctx.assetUrl("cursor.svg")}'), crosshair`,
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function getPositiveNumber(value, fallback) {
  const number = Number(value);
  return number > 0 ? number : fallback;
}

/** @param {ToolRuntimeModules["rateLimits"]} rateLimits */
function computeMinPencilIntervalMs(rateLimits) {
  const generalLimit = rateLimits.getEffectiveRateLimit("general");
  return (
    getPositiveNumber(generalLimit.periodMs, 4096) /
    getPositiveNumber(generalLimit.limit, 192)
  );
}

/**
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 */
function createPointMessage(state, x, y) {
  return {
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: state.curLineId,
    x,
    y,
  };
}

/**
 * @param {PencilState} state
 * @param {string} lineId
 */
function createLineMessage(state, lineId) {
  return {
    tool: ToolCodes.PENCIL,
    type: MutationType.CREATE,
    id: lineId,
    color: state.secondary.active ? "#ffffff" : state.preferences.getColor(),
    size: state.preferences.getSize(),
    opacity: state.secondary.active ? 1 : state.preferences.getOpacity(),
  };
}

/**
 * @param {PencilState} state
 * @returns {PencilPressEffect}
 */
export function createPencilPressEffect(state) {
  const lineId = state.ids.generateUID("l");
  return {
    lineId,
    createMessage: createLineMessage(state, lineId),
  };
}

/**
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 * @param {number} now
 * @returns {PencilMoveEffect}
 */
export function createPencilMoveEffect(state, x, y, now) {
  if (
    state.curLineId !== "" &&
    state.currentLineChildCount >= state.MAX_PENCIL_CHILDREN
  ) {
    return {
      appendMessage: null,
      stopBefore: true,
      stopAfter: false,
      nextLastTime: state.lastTime,
      nextHasSentPoint: state.hasSentPoint,
      nextChildCount: state.currentLineChildCount,
    };
  }
  if (
    state.curLineId === "" ||
    (state.hasSentPoint && now - state.lastTime <= state.minPencilIntervalMs)
  ) {
    return {
      appendMessage: null,
      stopBefore: false,
      stopAfter: false,
      nextLastTime: state.lastTime,
      nextHasSentPoint: state.hasSentPoint,
      nextChildCount: state.currentLineChildCount,
    };
  }
  const nextChildCount = state.currentLineChildCount + 1;
  return {
    appendMessage: createPointMessage(state, x, y),
    stopBefore: false,
    stopAfter: nextChildCount >= state.MAX_PENCIL_CHILDREN,
    nextLastTime: now,
    nextHasSentPoint: true,
    nextChildCount,
  };
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
    document.getElementById(lineId) || state.board.svg.getElementById(lineId);
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
  if (!line || line.parentNode !== state.board.drawingArea) return;
  state.board.drawingArea.removeChild(line);
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
 * @param {PencilLineData} lineData
 * @returns {SVGPathElement & {id: string}}
 */
function createLine(state, lineData) {
  let line = getLineById(state, lineData.id);
  delete state.pathDataCache[lineData.id];
  if (line) line.setPathData([]);
  else {
    line = /** @type {SVGPathElement & {id: string}} */ (
      state.board.createSVGElement("path")
    );
  }
  line.id = lineData.id || "";
  line.setAttribute("stroke", lineData.color || "black");
  line.setAttribute("stroke-width", String(lineData.size || 10));
  line.setAttribute(
    "opacity",
    String(Math.max(0.1, Math.min(1, Number(lineData.opacity) || 1))),
  );
  if (line.parentNode !== state.board.drawingArea) {
    state.board.drawingArea.appendChild(line);
  }
  updateActiveDrawingClass(line, line.id === state.curLineId);
  return line;
}

/** @param {PencilState} state */
function restoreDrawingSize(state) {
  state.whiteOutSize = state.preferences.getSize();
  if (state.drawingSize !== -1) state.preferences.setSize(state.drawingSize);
}

/** @param {PencilState} state */
function restoreWhiteOutSize(state) {
  state.drawingSize = state.preferences.getSize();
  if (state.whiteOutSize !== -1) state.preferences.setSize(state.whiteOutSize);
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
    if (state.hasUsedStylus && state.toolRegistry.current?.secondary?.active) {
      state.toolRegistry.change(toolId);
    }
    state.hasUsedStylus = true;
  }
  if (touchType === "direct") {
    if (
      state.hasUsedStylus &&
      state.toolRegistry.current?.secondary &&
      !state.toolRegistry.current?.secondary?.active
    ) {
      state.toolRegistry.change(toolId);
    }
  }
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  const state = createInitialState(ctx);
  state.secondary.switch = () => {
    stopLine(state);
    toggleSize(state);
  };
  return state;
}

/**
 * @param {PencilState} state
 * @param {unknown} data
 */
export function draw(state, data) {
  state.interaction.drawingEvent = true;
  if (!isPencilMessage(data)) {
    logFrontendEvent("error", "tool.pencil.draw_invalid_type", {
      mutationType: /** @type {{type?: unknown}} */ (data)?.type,
      message: data,
    });
    return;
  }
  switch (data.type) {
    case MutationType.CREATE:
      state.renderingLine = createLine(state, data);
      return;
    case MutationType.APPEND: {
      const childData = data;
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
  const effect = createPencilPressEffect(state);
  state.curLineId = effect.lineId;
  state.hasSentPoint = false;
  state.currentLineChildCount = 0;
  state.writes.drawAndSend(effect.createMessage);
  move(state, x, y, evt);
}

/**
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 */
export function move(state, x, y, evt) {
  const effect = createPencilMoveEffect(state, x, y, performance.now());
  if (effect.stopBefore) {
    stopLine(state);
  }
  if (effect.appendMessage) {
    state.writes.drawAndSend(effect.appendMessage);
    state.currentLineChildCount = effect.nextChildCount;
    state.hasSentPoint = effect.nextHasSentPoint;
    state.lastTime = effect.nextLastTime;
    if (effect.stopAfter) stopLine(state);
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
 * @param {{type?: unknown, id?: string}} message
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
