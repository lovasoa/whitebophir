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
/** @import { MountedAppToolsState, ToolBootContext } from "../../../types/app-runtime" */
/** @typedef {{tools: MountedAppToolsState, index: number, states: GridFill[], gridContainer: SVGElement}} GridState */

export const toolId = "grid";
export const shortcut = "g";
export const oneTouch = true;
export const mouseCursor = "crosshair";
export const visibleWhenReadOnly = true;

/**
 * @param {MountedAppToolsState} tools
 * @returns {SVGDefsElement}
 */
function getDefs(tools) {
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

/** @param {MountedAppToolsState} tools */
function createPatterns(tools) {
  const smallGrid = tools.createSVGElement("pattern", {
    id: "smallGrid",
    width: "300",
    height: "300",
    patternUnits: "userSpaceOnUse",
  });
  smallGrid.appendChild(
    tools.createSVGElement("path", {
      d: "M 300 0 L 0 0 0 300",
      fill: "none",
      stroke: "gray",
      "stroke-width": "5",
    }),
  );
  const grid = tools.createSVGElement("pattern", {
    id: "grid",
    width: "3000",
    height: "3000",
    patternUnits: "userSpaceOnUse",
  });
  grid.appendChild(
    tools.createSVGElement("rect", {
      width: "3000",
      height: "3000",
      fill: "url(#smallGrid)",
    }),
  );
  grid.appendChild(
    tools.createSVGElement("path", {
      d: "M 3000 0 L 0 0 0 3000",
      fill: "none",
      stroke: "gray",
      "stroke-width": "10",
    }),
  );
  const dots = tools.createSVGElement("pattern", {
    id: "dots",
    width: "300",
    height: "300",
    x: "-100",
    y: "-100",
    patternUnits: "userSpaceOnUse",
  });
  dots.appendChild(
    tools.createSVGElement("circle", {
      fill: "gray",
      cx: "100",
      cy: "100",
      r: "20",
    }),
  );
  const defs = getDefs(tools);
  defs.appendChild(smallGrid);
  defs.appendChild(grid);
  defs.appendChild(dots);
}

/** @param {{tools: MountedAppToolsState, index: number, states: GridFill[]}} state */
function createGridContainer(state) {
  createPatterns(state.tools);
  const gridContainer = state.tools.createSVGElement("rect", {
    id: "gridContainer",
    width: "100%",
    height: "100%",
    fill: state.states[state.index] || "none",
  });
  state.tools.svg.insertBefore(gridContainer, state.tools.drawingArea);
  return gridContainer;
}

/** @param {ToolBootContext} ctx */
export function boot(ctx) {
  const tools = ctx.app;
  /** @type {GridFill[]} */
  const states = ["none", "url(#grid)", "url(#dots)"];
  const gridContainer = createGridContainer({ tools, index: 0, states });
  /** @type {GridState} */
  const state = {
    tools,
    index: 0,
    states,
    gridContainer,
  };
  return state;
}

/** @param {GridState} state */
export function onstart(state) {
  state.index = (state.index + 1) % state.states.length;
  state.gridContainer.setAttributeNS(
    null,
    "fill",
    state.states[state.index] || "none",
  );
}

export function draw() {}
