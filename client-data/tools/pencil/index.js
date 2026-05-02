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
import { TOOL_CODE_BY_ID } from "../tool-order.js";
import { wboPencilPoint } from "./wbo_pencil_point.js";
/** @import { ToolBootContext, ToolRuntimeModules } from "../../../types/app-runtime" */
/** @typedef {Omit<ReturnType<typeof createLineMessage>, "opacity"> & {opacity?: number}} PencilCreateMessage */
/** @typedef {ReturnType<typeof createPointMessage>} PencilAppendMessage */
/** @typedef {PencilCreateMessage | PencilAppendMessage} PencilMessage */
/** @typedef {{type: number, id: string, color?: string, size?: number, opacity?: number}} PencilLineData */
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
  if (message.tool !== toolCode) return false;
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
const toolCode = TOOL_CODE_BY_ID[toolId];
export const drawsOnBoard = true;

/** @type {import("../shape_contract.js").ToolContract} */
const contract = {
  toolId,
  toolCode,
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
const LIVE_OVERLAY_CLASS = "wbo-pencil-live-overlay";
const LIVE_OVERLAY_ACTIVE_CLASS = "wbo-pencil-live-overlay-active";
const LIVE_PATH_CLASS = "wbo-pencil-live-path";
/** @typedef {{type: string, values: number[]}} PencilPathSegment */
/** @typedef {PencilPathSegment[]} PencilPathData */
/** @typedef {{name: string, icon: string, active: boolean, switch?: () => void}} PencilSecondary */
/** @typedef {ReturnType<typeof createInitialState>} PencilState */
/** @typedef {{lineId: string, createMessage: PencilCreateMessage}} PencilPressEffect */
/** @typedef {{appendMessage: PencilAppendMessage | null, stopBefore: boolean, stopAfter: boolean, nextLastTime: number, nextHasSentPoint: boolean, nextChildCount: number}} PencilMoveEffect */

/**
 * Renders the in-progress local pencil stroke outside `#drawingArea`.
 *
 * The dense board SVG is expensive to restyle, paint, and commit while a user
 * is drawing. This overlay is the only DOM that should receive per-point
 * updates for active local strokes; the canonical board path is written once
 * when the stroke ends.
 */
class PencilLiveOverlay {
  /**
   * @param {ToolRuntimeModules["board"]} board
   * @param {ToolRuntimeModules["viewport"]} viewport
   */
  constructor(board, viewport) {
    this.board = board;
    this.viewport = viewport;
    this.overlay = /** @type {SVGSVGElement | null} */ (null);
    this.path = /** @type {SVGPathElement | null} */ (null);
    this.pathData = /** @type {PencilPathData | null} */ (null);
    this.lineData = /** @type {PencilLineData | null} */ (null);
    this.animationFrame = 0;
    this.toolActive = false;
    this.strokeActive = false;
    this.refreshGeometry = () => this.syncGeometry();
  }

  /** Lazily creates the overlay SVG used for active local stroke feedback. */
  ensureOverlay() {
    if (this.overlay && this.path) return;
    const namespace = this.board.svg.namespaceURI;
    const overlay = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    overlay.setAttribute("class", LIVE_OVERLAY_CLASS);
    overlay.setAttribute("aria-hidden", "true");
    const path = /** @type {SVGPathElement} */ (
      document.createElementNS(namespace, "path")
    );
    path.setAttribute("class", LIVE_PATH_CLASS);
    overlay.appendChild(path);
    this.board.board.appendChild(overlay);
    this.overlay = overlay;
    this.path = path;
  }

  /**
   * Enables the overlay as Pencil's input surface while the tool is selected.
   *
   * The SVG uses `pointer-events: bounding-box` in CSS so empty board space
   * targets this small overlay instead of forcing hit-testing through the dense
   * persisted SVG. Events still bubble to `#board`, where tools already listen.
   */
  activate() {
    this.ensureOverlay();
    const wasActive = this.toolActive;
    this.toolActive = true;
    this.overlay?.classList.add(LIVE_OVERLAY_ACTIVE_CLASS);
    this.syncGeometry();
    if (!wasActive) {
      window.addEventListener("resize", this.refreshGeometry, {
        passive: true,
      });
    }
  }

  /** Disables Pencil's input surface when another tool owns the board. */
  deactivate() {
    this.clear();
    this.toolActive = false;
    this.overlay?.classList.remove(LIVE_OVERLAY_ACTIVE_CLASS);
    window.removeEventListener("resize", this.refreshGeometry);
  }

  /**
   * Keeps the overlay sized like the board without doing that work on the first
   * stroke point. Width/height writes can trigger style work, so they belong to
   * tool activation and resize, not pointer-down.
   */
  syncGeometry() {
    if (!this.overlay) return;
    syncOverlayGeometry(this.overlay, this.board.svg, this.viewport);
  }

  /**
   * Starts local overlay rendering for a stroke before the stroke has any
   * visible board-SVG representation.
   * @param {PencilLineData} lineData
   */
  start(lineData) {
    if (!this.toolActive) this.activate();
    this.lineData = lineData;
    this.pathData = null;
    this.strokeActive = true;
    this.scheduleFlush();
  }

  /**
   * Queues one visual overlay update. Multiple local points can arrive before
   * RAF; only the latest path data needs to be painted.
   * @param {PencilLineData} lineData
   * @param {PencilPathData} pathData
   */
  update(lineData, pathData) {
    if (!this.toolActive) this.activate();
    this.lineData = lineData;
    this.pathData = pathData;
    this.strokeActive = true;
    this.scheduleFlush();
  }

  /** Schedules a single overlay DOM write for the next animation frame. */
  scheduleFlush() {
    if (!this.strokeActive || this.animationFrame !== 0) return;
    this.animationFrame = window.requestAnimationFrame(() => {
      this.animationFrame = 0;
      this.flush();
    });
  }

  /** Applies the latest active local stroke data to the overlay only. */
  flush() {
    if (!this.strokeActive || !this.overlay || !this.path || !this.lineData) {
      return;
    }
    syncOverlayTransform(this.overlay, this.viewport);
    copyOverlayStrokeAttributes(this.path, this.lineData);
    if (this.pathData) this.path.setPathData(this.pathData);
  }

  /** Clears the active stroke while keeping Pencil's input surface installed. */
  clear() {
    this.strokeActive = false;
    this.pathData = null;
    this.lineData = null;
    if (this.animationFrame !== 0) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.path?.setPathData([]);
  }
}

/**
 * Copies pencil stroke style into the overlay path without reading from a board
 * SVG element. Active local strokes may not have one yet.
 * @param {SVGPathElement} target
 * @param {PencilLineData} source
 */
function copyOverlayStrokeAttributes(target, source) {
  target.setAttribute("fill", "none");
  target.setAttribute("stroke-linecap", "round");
  target.setAttribute("stroke-linejoin", "round");
  target.setAttribute("stroke", source.color || "black");
  target.setAttribute("stroke-width", String(source.size || 10));
  if (typeof source.opacity === "number") {
    target.setAttribute("opacity", String(source.opacity));
  } else {
    target.removeAttribute("opacity");
  }
}

/**
 * Reads an SVG animated length without forcing document scroll/layout state.
 * @param {SVGAnimatedLength | undefined} length
 * @returns {number | null}
 */
function getSvgLengthValue(length) {
  const value = Number(length?.baseVal?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Mirrors the board SVG scale without reading scroll/layout state. Stroke
 * flushes call this because zoom can change while Pencil remains selected.
 * @param {SVGSVGElement} overlay
 * @param {ToolRuntimeModules["viewport"]} viewport
 */
function syncOverlayTransform(overlay, viewport) {
  const transform = `scale(${viewport.getScale()})`;
  if (overlay.style.transform !== transform)
    overlay.style.transform = transform;
}

/**
 * Keeps the overlay in board coordinates and lets normal document scrolling
 * move it with the board. Do not read `scrollLeft`/`scrollTop` here; that was
 * the trace-visible forced layout trigger.
 * @param {SVGSVGElement} overlay
 * @param {SVGSVGElement} boardSvg
 * @param {ToolRuntimeModules["viewport"]} viewport
 */
function syncOverlayGeometry(overlay, boardSvg, viewport) {
  const width =
    getSvgLengthValue(boardSvg.width) || Number(boardSvg.getAttribute("width"));
  const height =
    getSvgLengthValue(boardSvg.height) ||
    Number(boardSvg.getAttribute("height"));
  if (Number.isFinite(width) && width > 0) {
    const textWidth = String(width);
    if (overlay.getAttribute("width") !== textWidth) {
      overlay.setAttribute("width", textWidth);
    }
    const cssWidth = `${width}px`;
    if (overlay.style.width !== cssWidth) overlay.style.width = cssWidth;
  }
  if (Number.isFinite(height) && height > 0) {
    const textHeight = String(height);
    if (overlay.getAttribute("height") !== textHeight) {
      overlay.setAttribute("height", textHeight);
    }
    const cssHeight = `${height}px`;
    if (overlay.style.height !== cssHeight) overlay.style.height = cssHeight;
  }
  syncOverlayTransform(overlay, viewport);
}

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
    viewport: runtime.viewport,
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
    activeLineData: /** @type {PencilLineData | null} */ (null),
    activeInteractionLease: /** @type {{release: () => void} | null} */ (null),
    liveOverlay: new PencilLiveOverlay(runtime.board, runtime.viewport),
    pathDataCache: /** @type {Record<string, PencilPathData>} */ ({}),
    rejectedLineDeletes: new Set(),
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
    tool: toolCode,
    type: MutationType.APPEND,
    parent: state.curLineId,
    x,
    y,
  };
}

/** @param {string} lineId */
function createDeleteLineMessage(lineId) {
  return {
    tool: TOOL_CODE_BY_ID.eraser,
    type: MutationType.DELETE,
    id: lineId,
  };
}

/**
 * @param {PencilState} state
 * @param {string} lineId
 */
function createLineMessage(state, lineId) {
  return {
    tool: toolCode,
    type: MutationType.CREATE,
    id: lineId,
    color: state.secondary.active ? "#ffffff" : state.preferences.getColor(),
    size: state.preferences.getSize(),
    opacity: state.secondary.active ? 1 : state.preferences.getOpacity(),
  };
}

/**
 * Builds the create message for a new stroke without touching DOM. Keeping
 * this pure makes press behavior easy to unit-test separately from rendering.
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
 * Decides whether a pointer move should send a pencil point, throttle it, or
 * end the current stroke because it reached the configured child limit.
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
 * Returns cached path data for a board SVG path. `getPathData()` allocates, so
 * append handling keeps one mutable JS copy per line and writes it back after
 * adding the next point.
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
 * Keeps only the style/id fields needed to render an active local stroke later.
 * The live create message itself is owned by the write pipeline after send.
 * @param {PencilCreateMessage} message
 */
function cloneLineData(message) {
  return {
    type: MutationType.CREATE,
    id: message.id,
    color: message.color,
    size: message.size,
    opacity: message.opacity,
  };
}

/**
 * Returns the JS-owned path data for an active local stroke.
 *
 * During local drawing this cache is canonical for the in-progress stroke. The
 * board SVG path is intentionally absent until `commitActiveStroke()`.
 * @param {PencilState} state
 * @param {string} lineId
 * @returns {PencilPathData}
 */
function getLocalPathData(state, lineId) {
  let pathData = state.pathDataCache[lineId];
  if (!pathData) {
    pathData = [];
    state.pathDataCache[lineId] = pathData;
  }
  return pathData;
}

/**
 * Releases the short-lived interaction lease used while Pencil owns the
 * pointer stream. The lease suppresses the local cursor while a stroke is
 * active without touching the dense board SVG subtree.
 * @param {PencilState} state
 */
function releaseInteractionLease(state) {
  state.activeInteractionLease?.release();
  state.activeInteractionLease = null;
}

/**
 * Claims the active drawing interaction so the local cursor does not repaint
 * over Pencil's own overlay feedback.
 * @param {PencilState} state
 */
function acquireInteractionLease(state) {
  releaseInteractionLease(state);
  if (typeof state.interaction.acquire !== "function") return;
  state.activeInteractionLease = state.interaction.acquire({
    suppressOwnCursor: true,
  });
}

/**
 * Clears active stroke bookkeeping after the stroke was committed, canceled,
 * or rejected. This deliberately does not decide whether to create or remove a
 * board SVG path; callers make that policy choice first.
 * @param {PencilState} state
 */
function clearActiveStrokeState(state) {
  state.liveOverlay.clear();
  releaseInteractionLease(state);
  state.curLineId = "";
  state.activeLineData = null;
  state.hasSentPoint = false;
  state.currentLineChildCount = 0;
  state.renderingLine = null;
}

/**
 * Materializes the active local stroke into `#drawingArea` exactly once.
 *
 * This is the deliberate handoff from overlay-only drawing to normal
 * canonical SVG. It should run on release or child-limit rollover, not on
 * every accepted pencil point.
 * @param {PencilState} state
 */
function commitActiveStroke(state) {
  const lineId = state.curLineId;
  if (!lineId || !state.activeLineData) return;
  const pathData = state.pathDataCache[lineId];
  if (!pathData || pathData.length === 0) return;
  const line = createLine(state, state.activeLineData);
  line.setPathData(pathData);
  state.pathDataCache[lineId] = pathData;
}

/**
 * Completes an active local stroke by committing its final path and clearing
 * overlay/lease state.
 * @param {PencilState} state
 */
function finishActiveStroke(state) {
  commitActiveStroke(state);
  clearActiveStrokeState(state);
}

/**
 * Cancels the active stroke and drops its JS path cache. `removeCurrentLine`
 * only matters for older/materialized paths; overlay-only strokes may have no
 * board SVG node to remove.
 * @param {PencilState} state
 * @param {boolean} removeCurrentLine
 */
function abortActiveStroke(state, removeCurrentLine) {
  const lineId = state.curLineId;
  clearActiveStrokeState(state);
  if (!lineId) return;
  if (removeCurrentLine) {
    const line = getLineById(state, lineId);
    if (line && line.parentNode === state.board.drawingArea) {
      state.board.drawingArea.removeChild(line);
    }
  }
  delete state.pathDataCache[lineId];
}

/**
 * Removes local state and any materialized board path for a rejected stroke.
 * This implements the simple optimistic policy: a pencil rejection discards
 * the whole local stroke instead of trying to reconstruct a valid prefix.
 * @param {PencilState} state
 * @param {string} lineId
 */
function removeLocalLine(state, lineId) {
  const line = getLineById(state, lineId);
  if (line && line.parentNode === state.board.drawingArea) {
    state.board.drawingArea.removeChild(line);
  }
  delete state.pathDataCache[lineId];
}

/**
 * Sends one cleanup delete for a rejected append so the server drops any
 * accepted prefix of the same stroke. Duplicate rejection notifications for
 * the same line id must not emit repeated deletes.
 * @param {PencilState} state
 * @param {string} lineId
 */
function sendRejectedLineDelete(state, lineId) {
  if (!lineId || state.rejectedLineDeletes.has(lineId)) return;
  state.rejectedLineDeletes.add(lineId);
  state.writes.send(createDeleteLineMessage(lineId));
}

/**
 * Cancels a user gesture and tells the server to delete any accepted prefix of
 * that stroke. This is used for touch cancellation, not normal release.
 * @param {PencilState} state
 */
function cancelLineGesture(state) {
  const lineId = state.curLineId;
  abortActiveStroke(state, true);
  if (lineId) state.writes.send(createDeleteLineMessage(lineId));
}

/**
 * Converts server-rendered canonical pencil paths back into the browser's
 * smoothed path representation. This runs on boot/normalization, not on the
 * active local input path.
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
 * Creates or resets the canonical board SVG path for one pencil stroke.
 * Active local strokes call this only when they are committed at the end.
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
  return line;
}

/**
 * Handles a local create for the currently active stroke without adding a path
 * to `#drawingArea`. Generic optimistic rollback will snapshot "no item" for
 * this id, which is compatible with the whole-stroke rejection policy.
 * @param {PencilState} state
 * @param {PencilCreateMessage} message
 */
function drawActiveLocalCreate(state, message) {
  state.activeLineData = cloneLineData(message);
  state.pathDataCache[message.id] = [];
  state.liveOverlay.start(state.activeLineData);
}

/**
 * Handles a local append by updating only JS path state and the overlay.
 * This is the hot local drawing path and must not mutate the dense board SVG.
 * @param {PencilState} state
 * @param {PencilAppendMessage} message
 */
function drawActiveLocalAppend(state, message) {
  const pathData = wboPencilPoint(
    getLocalPathData(state, message.parent),
    message.x,
    message.y,
  );
  state.liveOverlay.update(
    /** @type {PencilLineData} */ (state.activeLineData),
    pathData,
  );
}

/**
 * Renders a create message into the canonical board SVG. This path is for
 * remote/replay messages and for the final local commit, never per-point local
 * active feedback.
 * @param {PencilState} state
 * @param {PencilCreateMessage} message
 */
function drawBoardCreate(state, message) {
  state.renderingLine = createLine(state, message);
}

/**
 * Returns the board path that a non-local append should mutate, creating a
 * minimal placeholder only for out-of-order or malformed replay recovery.
 * @param {PencilState} state
 * @param {string} parentId
 * @returns {SVGPathElement & {id: string}}
 */
function getBoardLineForAppend(state, parentId) {
  const existingLine =
    state.renderingLine && state.renderingLine.id === parentId
      ? state.renderingLine
      : getLineById(state, parentId);
  if (existingLine) return existingLine;
  logFrontendEvent("warn", "tool.pencil.append_missing_parent", {
    parentId,
  });
  const fallbackLine = createLine(state, {
    type: MutationType.CREATE,
    id: parentId,
  });
  state.renderingLine = fallbackLine;
  return fallbackLine;
}

/**
 * Applies a non-local append to the canonical board SVG. Remote/replay drawing
 * still uses the board path immediately because it is not on the local input
 * critical path.
 * @param {PencilState} state
 * @param {PencilAppendMessage} message
 */
function drawBoardAppend(state, message) {
  const line = getBoardLineForAppend(state, message.parent);
  const pathData = wboPencilPoint(
    getPathData(state, line),
    message.x,
    message.y,
  );
  line.setPathData(pathData);
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
    finishActiveStroke(state);
    toggleSize(state);
  };
  return state;
}

/**
 * Draws one pencil message.
 *
 * Local active strokes are special: they are visible through
 * `PencilLiveOverlay` and stay out of `#drawingArea` until release. All
 * remote/replay messages continue to mutate canonical board SVG immediately.
 * @param {PencilState} state
 * @param {unknown} data
 * @param {boolean} [isLocal]
 */
export function draw(state, data, isLocal = false) {
  state.interaction.drawingEvent = true;
  if (!isPencilMessage(data)) {
    logFrontendEvent("error", "tool.pencil.draw_invalid_type", {
      mutationType: /** @type {{type?: unknown}} */ (data)?.type,
      message: data,
    });
    return;
  }

  if (data.type === MutationType.CREATE) {
    if (isLocal && data.id === state.curLineId) {
      drawActiveLocalCreate(state, data);
    } else {
      drawBoardCreate(state, data);
    }
    return;
  }

  if (isLocal && data.parent === state.curLineId && state.activeLineData) {
    drawActiveLocalAppend(state, data);
  } else {
    drawBoardAppend(state, data);
  }
}

/**
 * Starts a local pencil stroke, sends the live create immediately, and lets
 * `draw()` put the first visible feedback into the overlay instead of
 * `#drawingArea`.
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
  state.activeLineData = null;
  state.rejectedLineDeletes.delete(effect.lineId);
  state.hasSentPoint = false;
  state.currentLineChildCount = 0;
  acquireInteractionLease(state);
  state.writes.drawAndSend(effect.createMessage);
  move(state, x, y, evt);
}

/**
 * Sends live pencil append messages while throttling to the configured write
 * rate. Local rendering still goes through `draw()`, so this stays focused on
 * input policy rather than DOM mutation.
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 */
export function move(state, x, y, evt) {
  const effect = createPencilMoveEffect(state, x, y, performance.now());
  if (effect.stopBefore) {
    finishActiveStroke(state);
  }
  if (effect.appendMessage) {
    state.writes.drawAndSend(effect.appendMessage);
    state.currentLineChildCount = effect.nextChildCount;
    state.hasSentPoint = effect.nextHasSentPoint;
    state.lastTime = effect.nextLastTime;
    if (effect.stopAfter) finishActiveStroke(state);
  }
  if (evt) evt.preventDefault();
}

/**
 * Ends the pointer stroke and performs the single overlay-to-board-SVG commit.
 * Any live messages were already sent during press/move.
 * @param {PencilState} state
 * @param {number} x
 * @param {number} y
 */
export function release(state, x, y) {
  move(state, x, y, undefined);
  finishActiveStroke(state);
}

/**
 * Handles browser gesture cancellation by dropping local feedback and sending a
 * delete for any prefix the server may already have accepted.
 * @param {PencilState} state
 */
export function cancelTouchGesture(state) {
  cancelLineGesture(state);
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
 * Handles authoritative board events that invalidate the active local stroke.
 * The overlay is local-only, so clear/delete must explicitly discard it.
 * @param {PencilState} state
 * @param {{type?: unknown, id?: string}} message
 */
export function onMessage(state, message) {
  if (message.type === MutationType.CLEAR) {
    abortActiveStroke(state, false);
    return;
  }
  if (message.type === MutationType.DELETE && message.id === state.curLineId) {
    abortActiveStroke(state, false);
  }
}

/**
 * Drops unacknowledged local feedback on disconnect. Reconnect reloads the
 * authoritative board state instead of trying to preserve the overlay stroke.
 * @param {PencilState} state
 */
export function onSocketDisconnect(state) {
  abortActiveStroke(state, true);
}

/**
 * Handles the pencil optimistic policy after the generic write layer reports a
 * rejection. A rejected append means the server may have accepted an earlier
 * prefix, so the client sends one cleanup delete for the whole stroke.
 * @param {PencilState} state
 * @param {{type?: unknown, id?: string, parent?: string}} message
 */
export function onMutationRejected(state, message) {
  const lineId = message.parent || message.id || "";
  if (!lineId) return;
  const isAppend =
    message.type === MutationType.APPEND || typeof message.parent === "string";
  if (lineId === state.curLineId) {
    abortActiveStroke(state, false);
  } else {
    removeLocalLine(state, lineId);
  }
  if (isAppend) sendRejectedLineDelete(state, lineId);
}

/** @param {PencilState} state */
export function onstart(state) {
  state.hasUsedStylus = false;
  state.liveOverlay.activate();
  if (state.secondary.active) restoreWhiteOutSize(state);
}

/** @param {PencilState} state */
export function onquit(state) {
  finishActiveStroke(state);
  state.liveOverlay.deactivate();
  if (state.secondary.active) restoreDrawingSize(state);
}
