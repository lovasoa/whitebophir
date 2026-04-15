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
/** @typedef {{svg: SVGSVGElement | null, drawingArea: Element | null, createSVGElement: (name: string, attrs?: Record<string, string | undefined>) => Element, add: (tool: unknown) => void}} GridToolRegistry */
/** @typedef {import("../../../types/app-runtime").ToolBootContext} ToolBootContext */

/** @param {GridToolRegistry} tools */
function createGridTool(tools) {
  let index = 0; //grid off by default
  /** @type {GridFill[]} */
  const states = ["none", "url(#grid)", "url(#dots)"];

  /** @param {Event} evt */
  function toggleGrid(evt) {
    index = (index + 1) % states.length;
    gridContainer.setAttributeNS(null, "fill", states[index] || "none");
  }

  /** @returns {SVGDefsElement} */
  function getDefs() {
    if (!tools.svg) {
      throw new Error("Grid: Missing SVG canvas.");
    }
    const existingDefs = tools.svg.getElementById("defs");
    if (existingDefs instanceof SVGDefsElement) return existingDefs;
    const defs = /** @type {SVGDefsElement} */ (
      tools.createSVGElement("defs", { id: "defs" })
    );
    if (tools.svg.firstChild) {
      tools.svg.insertBefore(defs, tools.svg.firstChild);
    } else {
      tools.svg.appendChild(defs);
    }
    return defs;
  }

  function createPatterns() {
    // create patterns
    // small (inner) grid
    const smallGrid = tools.createSVGElement("pattern", {
      id: "smallGrid",
      width: "30",
      height: "30",
      patternUnits: "userSpaceOnUse",
    });
    smallGrid.appendChild(
      tools.createSVGElement("path", {
        d: "M 30 0 L 0 0 0 30",
        fill: "none",
        stroke: "gray",
        "stroke-width": "0.5",
      }),
    );
    // (outer) grid
    const grid = tools.createSVGElement("pattern", {
      id: "grid",
      width: "300",
      height: "300",
      patternUnits: "userSpaceOnUse",
    });
    grid.appendChild(
      tools.createSVGElement("rect", {
        width: "300",
        height: "300",
        fill: "url(#smallGrid)",
      }),
    );
    grid.appendChild(
      tools.createSVGElement("path", {
        d: "M 300 0 L 0 0 0 300",
        fill: "none",
        stroke: "gray",
        "stroke-width": "1",
      }),
    );
    // dots
    const dots = tools.createSVGElement("pattern", {
      id: "dots",
      width: "30",
      height: "30",
      x: "-10",
      y: "-10",
      patternUnits: "userSpaceOnUse",
    });
    dots.appendChild(
      tools.createSVGElement("circle", {
        fill: "gray",
        cx: "10",
        cy: "10",
        r: "2",
      }),
    );

    const defs = getDefs();
    defs.appendChild(smallGrid);
    defs.appendChild(grid);
    defs.appendChild(dots);
  }

  const gridContainer = (function init() {
    // initialize patterns
    createPatterns();
    // create grid container
    const gridContainer = tools.createSVGElement("rect", {
      id: "gridContainer",
      width: "100%",
      height: "100%",
      fill: states[index] || "none",
    });
    if (!tools.svg) {
      throw new Error("Grid: Missing SVG canvas.");
    }
    if (!tools.drawingArea) {
      throw new Error("Grid: Missing drawing area.");
    }
    tools.svg.insertBefore(gridContainer, tools.drawingArea);
    return gridContainer;
  })();

  return {
    //The new tool
    name: "Grid",
    shortcut: "g",
    listeners: {},
    icon: "tools/grid/icon.svg",
    oneTouch: true,
    onstart: toggleGrid,
    mouseCursor: "crosshair",
  };
}

/** @param {GridToolRegistry} tools */
export function registerGridTool(tools) {
  const tool = createGridTool(tools);
  tools.add(tool);
  return tool;
}

// biome-ignore lint/complexity/noStaticOnlyClass: tool modules intentionally expose static boot entrypoints.
export default class GridTool {
  static toolName = "Grid";

  /**
   * @param {ToolBootContext} ctx
   * @returns {Promise<any>}
   */
  static async boot(ctx) {
    return createGridTool(ctx.runtime.Tools);
  }
}
