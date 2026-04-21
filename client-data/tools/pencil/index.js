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
import { MutationType } from "../../js/mutation_type.js";
import { wboPencilPoint } from "./wbo_pencil_point.js";
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {import("../../../types/app-runtime").MountedAppToolsState} MountedAppToolsState */

/**
 * @param {number} value
 * @returns {number}
 */
function roundPathValue(value) {
  return Math.round(value);
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isPathWhitespace(code) {
  return code === 9 || code === 10 || code === 13 || code === 32 || code === 44;
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isAsciiLetter(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * @param {string | undefined} d
 * @param {(command: "M" | "l", x: number, y: number) => void} visit
 * @returns {boolean}
 */
function forEachPathPair(d, visit) {
  if (typeof d !== "string" || d.trim() === "") return true;
  let index = 0;
  /** @type {"M" | "l" | null} */
  let command = null;
  /** @type {number | undefined} */
  let pendingX;

  while (index < d.length) {
    const code = d.charCodeAt(index);
    if (Number.isNaN(code)) break;
    if (isPathWhitespace(code)) {
      index += 1;
      continue;
    }
    if (code === 77 || code === 108) {
      if (pendingX !== undefined) return false;
      command = code === 77 ? "M" : "l";
      index += 1;
      continue;
    }
    if (isAsciiLetter(code) || !command) return false;
    const start = index;
    index += 1;
    while (index < d.length) {
      const nextCode = d.charCodeAt(index);
      if (Number.isNaN(nextCode)) break;
      if (isPathWhitespace(nextCode) || nextCode === 77 || nextCode === 108) {
        break;
      }
      index += 1;
      if (isAsciiLetter(nextCode)) return false;
    }
    const value = Number(d.slice(start, index));
    if (!Number.isFinite(value)) return false;
    if (pendingX === undefined) {
      pendingX = value;
      continue;
    }
    visit(command, pendingX, value);
    pendingX = undefined;
  }
  return pendingX === undefined;
}

/**
 * @param {string | undefined} d
 * @returns {{type: string, values: number[]}[]}
 */
function parsePathData(d) {
  /** @type {{type: string, values: number[]}[]} */
  const segments = [];
  const ok = forEachPathPair(d, (command, x, y) => {
    segments.push({ type: command, values: [x, y] });
  });
  return ok ? segments : [];
}

/**
 * @param {string | undefined} d
 * @returns {{childCount: number, localBounds: {minX: number, minY: number, maxX: number, maxY: number} | null}}
 */
function scanPathSummary(d) {
  let currentX = 0;
  let currentY = 0;
  let childCount = 0;
  /** @type {{minX: number, minY: number, maxX: number, maxY: number} | null} */
  let localBounds = null;
  /** @type {number | undefined} */
  let previousX;
  /** @type {number | undefined} */
  let previousY;
  const ok = forEachPathPair(d, (command, x, y) => {
    if (command === "M") {
      currentX = x;
      currentY = y;
    } else {
      currentX += x;
      currentY += y;
    }
    if (previousX === currentX && previousY === currentY) return;
    previousX = currentX;
    previousY = currentY;
    childCount += 1;
    if (!localBounds) {
      localBounds = {
        minX: currentX,
        minY: currentY,
        maxX: currentX,
        maxY: currentY,
      };
      return;
    }
    localBounds.minX = Math.min(localBounds.minX, currentX);
    localBounds.minY = Math.min(localBounds.minY, currentY);
    localBounds.maxX = Math.max(localBounds.maxX, currentX);
    localBounds.maxY = Math.max(localBounds.maxY, currentY);
  });
  if (!ok) return { childCount: 0, localBounds: null };
  return { childCount, localBounds };
}

/**
 * @param {{type: string, values: number[]}[]} pathData
 * @returns {{x: number, y: number}[]}
 */
function pointsFromPathData(pathData) {
  /** @type {{x: number, y: number}[]} */
  const points = [];
  let currentX = 0;
  let currentY = 0;
  pathData.forEach((segment) => {
    if (!segment || !Array.isArray(segment.values)) return;
    if (segment.values.length < 2) return;
    const x = segment.values[segment.values.length - 2];
    const y = segment.values[segment.values.length - 1];
    if (typeof x !== "number" || typeof y !== "number") return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const pointX = segment.type === "l" ? currentX + x : x;
    const pointY = segment.type === "l" ? currentY + y : y;
    const previous = points[points.length - 1];
    const point = { x: pointX, y: pointY };
    if (previous && previous.x === point.x && previous.y === point.y) return;
    points.push(point);
    currentX = pointX;
    currentY = pointY;
  });
  return points;
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

export { parsePathData, pointsFromPathData, renderPencilPath, scanPathSummary };

export const toolId = "pencil";
export const drawsOnBoard = true;

/** @type {import("../shape_contract.js").ToolContract} */
const contract = {
  toolId,
  payloadKind: "children",
  liveCreateType: "line",
  storedTagName: "path",
  liveMessageFields: {
    line: {
      id: "id",
      color: "color",
      size: "size",
      opacity: "opacity?",
    },
    child: {
      parent: "id",
      x: "coord",
      y: "coord",
    },
  },
  storedFields: {
    color: "color",
    size: "size",
    opacity: "opacity?",
    transform: "transform?",
    time: "time?",
  },
  normalizeStoredItemData(item, raw, helpers) {
    if (!Array.isArray(raw?._children)) return;
    const children = helpers.normalizeStoredChildren(
      raw._children.slice(0, helpers.maxChildren),
    );
    if (children.length) item._children = children;
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
  parseStoredSvgItem(summary, entry, helpers) {
    const points = pointsFromPathData(
      parsePathData(helpers.readStoredSvgAttribute(entry, "d")),
    );
    if (points.length === 0) return null;
    return {
      id: summary.id,
      tool: contract.toolId,
      ...summary.data,
      _children: points,
    };
  },
  serializeStoredSvgItem(item, helpers) {
    const transform = helpers.renderTransformAttribute(item.transform);
    const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
    const color = helpers.escapeHtml(item.color || "#000000");
    const size = helpers.numberOrZero(item.size) | 0;
    const opacity =
      typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
    const points = Array.isArray(item._children) ? item._children : [];
    const pathData = renderPencilPath(points);
    if (!pathData) return "";
    return (
      `<path id="${id}" d="${helpers.escapeHtml(pathData)}"` +
      ` stroke="${color}" stroke-width="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacity}${transform}></path>`
    );
  },
  renderBoardSvg(pencil, helpers) {
    const pathstring = renderPencilPath(pencil._children || []);
    return helpers.renderPath(pencil, pathstring);
  },
};

export { contract };
export const shortcut = "p";
const ACTIVE_DRAWING_CLASS = "wbo-pencil-drawing";
/** @typedef {{Tools: MountedAppToolsState, AUTO_FINGER_WHITEOUT: boolean, MAX_PENCIL_CHILDREN: number, minPencilIntervalMs: number, hasUsedStylus: boolean, curLineId: string, lastTime: number, hasSentPoint: boolean, currentLineChildCount: number, renderingLine: SVGPathElement | null, pathDataCache: {[lineId: string]: any[]}, drawingSize: number, whiteOutSize: number, secondary: {name: string, icon: string, active: boolean, switch?: () => void}, mouseCursor: string, serverRenderedElementSelector: string}} PencilState */

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
 * @returns {{type: "child", parent: string, x: number, y: number}}
 */
function createPointMessage(state, x, y) {
  return { type: "child", parent: state.curLineId, x, y };
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
 * @param {{type: "line", id: string, color?: string, size?: number, opacity?: number}} lineData
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
  const Tools = ctx.runtime.Tools;
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
    serverRenderedElementSelector: "path",
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
    case "line":
      state.renderingLine = createLine(
        state,
        /** @type {{type: "line", id: string, color?: string, size?: number, opacity?: number}} */ (
          data
        ),
      );
      return;
    case "child": {
      const childData =
        /** @type {{type: "child", parent: string, x: number, y: number}} */ (
          data
        );
      let line =
        state.renderingLine && state.renderingLine.id === childData.parent
          ? state.renderingLine
          : getLineById(state, childData.parent);
      if (!line) {
        console.error(
          "Pencil: Hmmm... I received a point of a line that has not been created (%s).",
          childData.parent,
        );
        line = state.renderingLine = createLine(state, {
          type: "line",
          id: childData.parent,
        });
      }
      line.setPathData(
        wboPencilPoint(getPathData(state, line), childData.x, childData.y),
      );
      return;
    }
    case "endline":
      return;
    default:
      console.error("Pencil: Draw instruction with unknown type. ", data);
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
      type: contract.liveCreateType,
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
    console.error(
      "Pencil: unable to normalize server-rendered path '%s'; dropping segment.",
      line.id ?? "",
    );
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

/** @param {PencilState} state */
export function onstart(state) {
  state.hasUsedStylus = false;
  if (state.secondary.active) restoreWhiteOutSize(state);
}

/** @param {PencilState} state */
export function onquit(state) {
  if (state.secondary.active) restoreDrawingSize(state);
}
