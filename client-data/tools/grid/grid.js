/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2020  Ophir LOJKINE
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

/** @typedef {"none" | "url(#grid)" | "url(#dots)"} GridFill */
/** @typedef {import("../../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

export default class GridTool {
  static toolName = "Grid";

  /**
   * @param {AppToolsState} tools
   */
  constructor(tools) {
    this.tools = tools;
    this.name = "Grid";
    this.shortcut = "g";
    this.icon = "tools/grid/icon.svg";
    this.oneTouch = true;
    this.mouseCursor = "crosshair";
    this.index = 0;
    /** @type {GridFill[]} */
    this.states = ["none", "url(#grid)", "url(#dots)"];
    this.gridContainer = this.createGridContainer();
  }

  /** @returns {SVGDefsElement} */
  getDefs() {
    if (!this.tools.svg) {
      throw new Error("Grid: Missing SVG canvas.");
    }
    const existingDefs = this.tools.svg.getElementById("defs");
    if (existingDefs instanceof SVGDefsElement) return existingDefs;
    const defs = /** @type {SVGDefsElement} */ (
      this.tools.createSVGElement("defs", { id: "defs" })
    );
    if (this.tools.svg.firstChild) {
      this.tools.svg.insertBefore(defs, this.tools.svg.firstChild);
    } else {
      this.tools.svg.appendChild(defs);
    }
    return defs;
  }

  createPatterns() {
    // create patterns
    // small (inner) grid
    const smallGrid = this.tools.createSVGElement("pattern", {
      id: "smallGrid",
      width: "300",
      height: "300",
      patternUnits: "userSpaceOnUse",
    });
    smallGrid.appendChild(
      this.tools.createSVGElement("path", {
        d: "M 300 0 L 0 0 0 300",
        fill: "none",
        stroke: "gray",
        "stroke-width": "5",
      }),
    );
    // (outer) grid
    const grid = this.tools.createSVGElement("pattern", {
      id: "grid",
      width: "3000",
      height: "3000",
      patternUnits: "userSpaceOnUse",
    });
    grid.appendChild(
      this.tools.createSVGElement("rect", {
        width: "3000",
        height: "3000",
        fill: "url(#smallGrid)",
      }),
    );
    grid.appendChild(
      this.tools.createSVGElement("path", {
        d: "M 3000 0 L 0 0 0 3000",
        fill: "none",
        stroke: "gray",
        "stroke-width": "10",
      }),
    );
    // dots
    const dots = this.tools.createSVGElement("pattern", {
      id: "dots",
      width: "300",
      height: "300",
      x: "-100",
      y: "-100",
      patternUnits: "userSpaceOnUse",
    });
    dots.appendChild(
      this.tools.createSVGElement("circle", {
        fill: "gray",
        cx: "100",
        cy: "100",
        r: "20",
      }),
    );

    const defs = this.getDefs();
    defs.appendChild(smallGrid);
    defs.appendChild(grid);
    defs.appendChild(dots);
  }

  /** @returns {Element} */
  createGridContainer() {
    // initialize patterns
    this.createPatterns();
    // create grid container
    const gridContainer = this.tools.createSVGElement("rect", {
      id: "gridContainer",
      width: "100%",
      height: "100%",
      fill: this.states[this.index] || "none",
    });
    if (!this.tools.svg) {
      throw new Error("Grid: Missing SVG canvas.");
    }
    if (!this.tools.drawingArea) {
      throw new Error("Grid: Missing drawing area.");
    }
    this.tools.svg.insertBefore(gridContainer, this.tools.drawingArea);
    return gridContainer;
  }

  onstart() {
    this.index = (this.index + 1) % this.states.length;
    this.gridContainer.setAttributeNS(
      null,
      "fill",
      this.states[this.index] || "none",
    );
  }

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<GridTool>}
   */
  static async boot(ctx) {
    return new GridTool(ctx.runtime.Tools);
  }
}
