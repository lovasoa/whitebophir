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
/** @typedef {import("../../../types/app-runtime").AppToolsState} AppToolsState */

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

class PencilTool {
  static toolId = contract.toolId;
  static ACTIVE_DRAWING_CLASS = "wbo-pencil-drawing";

  /**
   * @param {AppToolsState} Tools
   * @param {(assetFile: string) => string} [assetUrl]
   */
  constructor(
    Tools,
    assetUrl = /** @param {string} assetFile */ (assetFile) =>
      `tools/pencil/${assetFile}`,
  ) {
    this.Tools = Tools;
    this.assetUrl = assetUrl;
    this.AUTO_FINGER_WHITEOUT =
      Tools.server_config.AUTO_FINGER_WHITEOUT === true;
    const defaultMaxPencilChildren =
      Number(LIMITS.DEFAULT_MAX_CHILDREN) > 0
        ? Number(LIMITS.DEFAULT_MAX_CHILDREN)
        : Number.POSITIVE_INFINITY;
    this.MAX_PENCIL_CHILDREN =
      Number(Tools.server_config.MAX_CHILDREN) > 0
        ? Number(Tools.server_config.MAX_CHILDREN)
        : defaultMaxPencilChildren;
    this.minPencilIntervalMs = this.computeMinPencilIntervalMs();

    this.hasUsedStylus = false;
    this.curLineId = "";
    this.lastTime = performance.now();
    this.hasSentPoint = false;
    this.currentLineChildCount = 0;
    this.renderingLine = null;
    /** @type {{[lineId: string]: any[]}} */
    this.pathDataCache = {};
    this.drawingSize = -1;
    this.whiteOutSize = -1;

    this.name = contract.toolId;
    this.shortcut = "p";
    this.secondary = {
      name: "White-out",
      icon: "tools/pencil/whiteout_tape.svg",
      active: false,
      switch: () => {
        this.stopLine();
        this.toggleSize();
      },
    };
    this.mouseCursor = `url('${assetUrl("cursor.svg")}'), crosshair`;
    this.serverRenderedElementSelector = "path";
  }

  /**
   * @param {unknown} value
   * @param {number} fallback
   * @returns {number}
   */
  getPositiveNumber(value, fallback) {
    const number = Number(value);
    return number > 0 ? number : fallback;
  }

  /**
   * @returns {number}
   */
  computeMinPencilIntervalMs() {
    const generalLimit =
      this.Tools.getEffectiveRateLimit?.("general") ??
      this.Tools.server_config?.RATE_LIMITS?.general ??
      {};
    return (
      this.getPositiveNumber(generalLimit.periodMs, 4096) /
      this.getPositiveNumber(generalLimit.limit, 192)
    );
  }

  /**
   * @returns {number}
   */
  getMinPencilIntervalMs() {
    return this.minPencilIntervalMs;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{type: "child", parent: string, x: number, y: number}}
   */
  createPointMessage(x, y) {
    return {
      type: "child",
      parent: this.curLineId,
      x: x,
      y: y,
    };
  }

  /** @param {TouchEvent} evt */
  handleAutoWhiteOut(evt) {
    const touch = evt.touches && evt.touches[0];
    const touchType =
      touch && "touchType" in touch
        ? /** @type {{touchType?: string}} */ (touch).touchType
        : undefined;
    if (touchType === "stylus") {
      if (
        this.hasUsedStylus &&
        this.Tools.curTool &&
        this.Tools.curTool.secondary &&
        this.Tools.curTool.secondary.active
      ) {
        this.Tools.change(toolId);
      }
      this.hasUsedStylus = true;
    }
    if (touchType === "direct") {
      if (
        this.hasUsedStylus &&
        this.Tools.curTool &&
        this.Tools.curTool.secondary &&
        !this.Tools.curTool.secondary.active
      ) {
        this.Tools.change(toolId);
      }
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   */
  press(x, y, evt) {
    evt.preventDefault();

    if (
      this.AUTO_FINGER_WHITEOUT &&
      typeof TouchEvent !== "undefined" &&
      evt instanceof TouchEvent
    ) {
      this.handleAutoWhiteOut(evt);
    }

    this.curLineId = this.Tools.generateUID("l");
    this.hasSentPoint = false;
    this.currentLineChildCount = 0;

    const initialData = {
      type: contract.liveCreateType,
      id: this.curLineId,
      color: this.secondary.active ? "#ffffff" : this.Tools.getColor(),
      size: this.Tools.getSize(),
      opacity: this.secondary.active ? 1 : this.Tools.getOpacity(),
    };

    this.Tools.drawAndSend(initialData, toolId);
    this.move(x, y, evt);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent | undefined} evt
   */
  move(x, y, evt) {
    if (
      this.curLineId !== "" &&
      this.currentLineChildCount >= this.MAX_PENCIL_CHILDREN
    ) {
      this.stopLine();
    }
    if (
      this.curLineId !== "" &&
      (!this.hasSentPoint ||
        performance.now() - this.lastTime > this.getMinPencilIntervalMs())
    ) {
      this.Tools.drawAndSend(this.createPointMessage(x, y), toolId);
      this.currentLineChildCount += 1;
      this.hasSentPoint = true;
      this.lastTime = performance.now();
      if (this.currentLineChildCount >= this.MAX_PENCIL_CHILDREN) {
        this.stopLine();
      }
    }
    if (evt) evt.preventDefault();
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  release(x, y) {
    this.move(x, y, undefined);
    this.stopLine();
  }

  stopLine() {
    this.updateActiveDrawingClass(this.renderingLine, false);
    this.curLineId = "";
    this.hasSentPoint = false;
    this.currentLineChildCount = 0;
    this.renderingLine = null;
  }

  /**
   * @param {boolean} removeCurrentLine
   */
  abortLine(removeCurrentLine) {
    const lineId = this.curLineId;
    this.stopLine();
    if (!removeCurrentLine || !lineId) return;
    const line = this.getLineById(lineId);
    if (!line || !this.Tools.drawingArea) return;
    if (line.parentNode === this.Tools.drawingArea) {
      this.Tools.drawingArea.removeChild(line);
    }
    delete this.pathDataCache[lineId];
  }

  /** @param {{type?: string | number, id?: string, color?: string, size?: number, opacity?: number, parent?: string, x?: number, y?: number}} data */
  draw(data) {
    this.Tools.drawingEvent = true;
    switch (data.type) {
      case "line":
        this.renderingLine = this.createLine(
          /** @type {{type: "line", id: string, color?: string, size?: number, opacity?: number}} */ (
            data
          ),
        );
        break;
      case "child": {
        const childData =
          /** @type {{type: "child", parent: string, x: number, y: number}} */ (
            data
          );
        let line =
          this.renderingLine && this.renderingLine.id === childData.parent
            ? this.renderingLine
            : this.getLineById(childData.parent);
        if (!line) {
          console.error(
            "Pencil: Hmmm... I received a point of a line that has not been created (%s).",
            childData.parent,
          );
          line = this.renderingLine = this.createLine({
            type: "line",
            id: childData.parent,
          });
        }
        this.addPoint(line, childData.x, childData.y);
        break;
      }
      case "endline":
        break;
      default:
        console.error("Pencil: Draw instruction with unknown type. ", data);
        break;
    }
  }

  /** @param {SVGPathElement & {id: string}} line */
  getPathData(line) {
    let pathData = this.pathDataCache[line.id];
    if (!pathData) {
      pathData = line.getPathData();
      this.pathDataCache[line.id] = pathData;
    }
    return pathData;
  }

  /**
   * @param {string | undefined} lineId
   * @returns {(SVGPathElement & {id: string}) | null}
   */
  getLineById(lineId) {
    if (!lineId) return null;
    const line =
      document.getElementById(lineId) ||
      (this.Tools.svg ? this.Tools.svg.getElementById(lineId) : null);
    return line instanceof SVGPathElement
      ? /** @type {SVGPathElement & {id: string}} */ (line)
      : null;
  }

  /**
   * @param {SVGPathElement & {id: string}} line
   * @param {number} x
   * @param {number} y
   */
  addPoint(line, x, y) {
    const pts = wboPencilPoint(this.getPathData(line), x, y);
    line.setPathData(pts);
  }

  /**
   * @param {SVGPathElement & {id: string} | null} line
   * @param {boolean} active
   * @returns {void}
   */
  updateActiveDrawingClass(line, active) {
    if (!line) return;
    const className = PencilTool.ACTIVE_DRAWING_CLASS;
    const current = String(line.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((name) => name !== className);
    if (active) current.push(className);
    if (current.length > 0) {
      line.setAttribute("class", current.join(" "));
      return;
    }
    line.setAttribute("class", "");
  }

  /**
   * @param {SVGElement} line
   */
  normalizeServerRenderedElement(line) {
    if (!(line instanceof SVGPathElement)) return;
    delete this.pathDataCache[line.id];
    const normalizedPathData = this.normalizeServerRenderedPathData(
      this.getPathData(line),
    );
    if (!normalizedPathData || normalizedPathData.length === 0) {
      console.error(
        "Pencil: unable to normalize server-rendered path '%s'; dropping segment.",
        line.id ?? "",
      );
      const cachedPathData = this.getPathData(line);
      if (cachedPathData && cachedPathData.length > 0) {
        this.pathDataCache[line.id] = cachedPathData;
      } else {
        delete this.pathDataCache[line.id];
      }
      return;
    }
    line.setPathData(normalizedPathData);
    this.pathDataCache[line.id] = normalizedPathData;
  }

  /**
   * @param {{type: string, values: number[]}[]} pathData
   * @returns {{type: string, values: number[]}[] | null}
   */
  normalizeServerRenderedPathData(pathData) {
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
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }

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

    return smoothedPathData;
  }

  /**
   * @param {{type: "line", id: string, color?: string, size?: number, opacity?: number}} lineData
   * @returns {SVGPathElement & {id: string}}
   */
  createLine(lineData) {
    let line = this.getLineById(lineData.id);
    delete this.pathDataCache[lineData.id];
    if (line) {
      line.setPathData([]);
    } else {
      line = /** @type {SVGPathElement & {id: string}} */ (
        this.Tools.createSVGElement("path")
      );
    }
    line.id = lineData.id || "";
    line.setAttribute("stroke", lineData.color || "black");
    line.setAttribute("stroke-width", String(lineData.size || 10));
    line.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, Number(lineData.opacity) || 1))),
    );
    if (!this.Tools.drawingArea) {
      throw new Error("Missing drawing area for pencil tool");
    }
    if (line.parentNode !== this.Tools.drawingArea) {
      this.Tools.drawingArea.appendChild(line);
    }
    this.updateActiveDrawingClass(line, line.id === this.curLineId);
    return line;
  }

  restoreDrawingSize() {
    this.whiteOutSize = this.Tools.getSize();
    if (this.drawingSize !== -1) {
      this.Tools.setSize(this.drawingSize);
    }
  }

  restoreWhiteOutSize() {
    this.drawingSize = this.Tools.getSize();
    if (this.whiteOutSize !== -1) {
      this.Tools.setSize(this.whiteOutSize);
    }
  }

  toggleSize() {
    if (this.secondary.active) {
      this.restoreWhiteOutSize();
    } else {
      this.restoreDrawingSize();
    }
  }

  /** @param {{type?: string | number, id?: string}} message */
  onMessage(message) {
    const mutationType = message.type;
    if (mutationType === MutationType.CLEAR) {
      this.abortLine(false);
      return;
    }
    if (mutationType === MutationType.DELETE && message.id === this.curLineId) {
      this.abortLine(false);
    }
  }

  onSocketDisconnect() {
    this.abortLine(true);
  }

  onstart() {
    this.hasUsedStylus = false;
    if (this.secondary.active) {
      this.restoreWhiteOutSize();
    }
  }

  onquit() {
    if (this.secondary.active) {
      this.restoreDrawingSize();
    }
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<PencilTool>}
   */
  static async boot(ctx) {
    return new PencilTool(ctx.runtime.Tools, ctx.assetUrl);
  }
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  return PencilTool.boot(ctx);
}

/**
 * @param {PencilTool} state
 * @param {any} data
 */
export function draw(state, data) {
  return state.draw(data);
}

/**
 * @param {PencilTool} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 */
export function press(state, x, y, evt) {
  return state.press(x, y, evt);
}

/**
 * @param {PencilTool} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 */
export function move(state, x, y, evt) {
  return state.move(x, y, evt);
}

/**
 * @param {PencilTool} state
 * @param {number} x
 * @param {number} y
 */
export function release(state, x, y) {
  return state.release(x, y);
}

/**
 * @param {PencilTool} state
 * @param {SVGElement} line
 */
export function normalizeServerRenderedElement(state, line) {
  return state.normalizeServerRenderedElement(line);
}

/**
 * @param {PencilTool} state
 * @param {{type?: string | number, id?: string}} message
 */
export function onMessage(state, message) {
  return state.onMessage(message);
}

/** @param {PencilTool} state */
export function onSocketDisconnect(state) {
  return state.onSocketDisconnect();
}

/** @param {PencilTool} state */
export function onstart(state) {
  return state.onstart();
}

/** @param {PencilTool} state */
export function onquit(state) {
  return state.onquit();
}
