export function createTool(runtime) {
  let index = 0; // grid off by default
  const states = ["none", "url(#grid)", "url(#dots)"];

  function createSVG(tagName, attrs) {
    const el = runtime.createSVGElement(tagName);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        el.setAttribute(key, attrs[key]);
      }
    }
    return el;
  }

  function toggleGrid(_evt) {
    index = (index + 1) % states.length;
    gridContainer.setAttributeNS(null, "fill", states[index]);
  }

  function getDefs() {
    const existingDefs = runtime.svgElement.getElementById("defs");
    if (existingDefs instanceof SVGDefsElement) return existingDefs;
    const defs = createSVG("defs", { id: "defs" });
    if (runtime.svgElement.firstChild) {
      runtime.svgElement.insertBefore(defs, runtime.svgElement.firstChild);
    } else {
      runtime.svgElement.appendChild(defs);
    }
    return defs;
  }

  function createPatterns() {
    // small (inner) grid
    const smallGrid = createSVG("pattern", {
      id: "smallGrid",
      width: "30",
      height: "30",
      patternUnits: "userSpaceOnUse",
    });
    smallGrid.appendChild(
      createSVG("path", {
        d: "M 30 0 L 0 0 0 30",
        fill: "none",
        stroke: "gray",
        "stroke-width": "0.5",
      }),
    );

    // (outer) grid
    const grid = createSVG("pattern", {
      id: "grid",
      width: "300",
      height: "300",
      patternUnits: "userSpaceOnUse",
    });
    grid.appendChild(
      createSVG("rect", {
        width: "300",
        height: "300",
        fill: "url(#smallGrid)",
      }),
    );
    grid.appendChild(
      createSVG("path", {
        d: "M 300 0 L 0 0 0 300",
        fill: "none",
        stroke: "gray",
        "stroke-width": "1",
      }),
    );

    // dots
    const dots = createSVG("pattern", {
      id: "dots",
      width: "30",
      height: "30",
      x: "-10",
      y: "-10",
      patternUnits: "userSpaceOnUse",
    });
    dots.appendChild(
      createSVG("circle", {
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

  function initGridContainer() {
    createPatterns();
    const container = createSVG("rect", {
      id: "gridContainer",
      width: "100%",
      height: "100%",
      fill: states[index],
    });
    runtime.svgElement.insertBefore(container, runtime.drawingArea);
    return container;
  }

  const gridContainer = initGridContainer();

  return {
    name: "Grid",
    shortcut: "g",
    listeners: {},
    icon: "tools/grid/icon.svg",
    oneTouch: true,
    onstart: toggleGrid,
    mouseCursor: "crosshair",
  };
}
