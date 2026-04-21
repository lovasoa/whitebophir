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
import { wboPencilPoint } from "./wbo_pencil_point.js";
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */
/** @typedef {import("../../../types/app-runtime").AppToolsState} AppToolsState */

export default class PencilTool {
  static toolName = "Pencil";
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

    this.name = "Pencil";
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
    this.icon = "tools/pencil/icon.svg";
    this.serverRenderedElementSelector = "path";
    this.stylesheet = "tools/pencil/pencil.css";
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
        this.Tools.change("Pencil");
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
        this.Tools.change("Pencil");
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
      type: "line",
      id: this.curLineId,
      color: this.secondary.active ? "#ffffff" : this.Tools.getColor(),
      size: this.Tools.getSize(),
      opacity: this.secondary.active ? 1 : this.Tools.getOpacity(),
    };

    this.Tools.drawAndSend(initialData, this);
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
      this.Tools.drawAndSend(this.createPointMessage(x, y), this);
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
    if (message.type === "clear") {
      this.abortLine(false);
      return;
    }
    if (
      message.type === "delete" &&
      message.id &&
      message.id === this.curLineId
    ) {
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
