import {
  extendBoundsWithBounds,
  measureSvgElementLocalBounds,
} from "./board_extent.js";
import { DEFAULT_BOARD_SCALE } from "./board_viewport.js";
import MessageCommon from "./message_common.js";

/** @import { ToolRuntimeModules } from "../../types/app-runtime" */

/**
 * @param {SVGSVGElement} svg
 * @param {SVGGraphicsElement[]} elements
 */
function selectionBounds(svg, elements) {
  const viewport = svg.getScreenCTM();
  if (!viewport) return null;
  const toBoard = viewport.inverse();
  let bounds = null;
  for (const element of elements) {
    const local = measureSvgElementLocalBounds(element);
    const toScreen = element.getScreenCTM();
    if (!local || !toScreen) continue;
    const style = getComputedStyle(element);
    const padding =
      style.stroke === "none"
        ? 0
        : (Number.parseFloat(style.strokeWidth) || 0) / 2;
    // Include strokes before applying the item's transform, including scaling.
    bounds = extendBoundsWithBounds(
      bounds,
      MessageCommon.applyTransformToBounds(
        {
          minX: local.minX - padding,
          minY: local.minY - padding,
          maxX: local.maxX + padding,
          maxY: local.maxY + padding,
        },
        // Cancel viewport zoom/scroll. getCTM() includes CSS zoom in Firefox.
        toBoard.multiply(toScreen),
      ),
    );
  }
  return bounds;
}

/**
 * Export canonical drawing nodes, excluding live overlays and selection chrome.
 * Only selection exports measure geometry; whole boards use their known extent.
 * @param {Pick<ToolRuntimeModules, "board" | "identity" | "toolRegistry">} runtime
 * @param {SVGGraphicsElement[]} [selection]
 */
export function downloadBoardSvg(runtime, selection) {
  runtime.toolRegistry.flushPendingDraws();
  const { svg, drawingArea } = runtime.board;
  const selected = selection && new Set(selection);
  const elements = selected
    ? /** @type {SVGGraphicsElement[]} */ (
        Array.from(drawingArea.children).filter((element) =>
          selected.has(/** @type {SVGGraphicsElement} */ (element)),
        )
      )
    : null;
  const bounds = elements ? selectionBounds(svg, elements) : null;
  if (elements && !bounds) return;
  const x = bounds?.minX ?? 0;
  const y = bounds?.minY ?? 0;
  const width = bounds ? Math.max(1, bounds.maxX - x) : svg.width.baseVal.value;
  const height = bounds
    ? Math.max(1, bounds.maxY - y)
    : svg.height.baseVal.value;
  const copy = /** @type {SVGSVGElement} */ (svg.cloneNode(false));
  copy.removeAttribute("style");
  copy.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  copy.setAttribute("width", String(width * DEFAULT_BOARD_SCALE));
  copy.setAttribute("height", String(height * DEFAULT_BOARD_SCALE));
  const drawingCopy = /** @type {SVGGElement} */ (
    drawingArea.cloneNode(!elements)
  );
  if (elements) {
    for (const element of elements)
      drawingCopy.appendChild(element.cloneNode(true));
  }
  copy.appendChild(drawingCopy);
  const styleNode = document.createElementNS(svg.namespaceURI, "style");
  styleNode.textContent = Array.from(document.styleSheets)
    .filter(
      (stylesheet) =>
        stylesheet.href &&
        /\/(?:tools\/.*|board)\.css(?:\?|$)/.test(stylesheet.href),
    )
    .flatMap((stylesheet) => Array.from(stylesheet.cssRules))
    .filter(
      (rule) =>
        rule instanceof CSSStyleRule &&
        (drawingCopy.matches(rule.selectorText) ||
          drawingCopy.querySelector(rule.selectorText)),
    )
    .map((rule) => rule.cssText)
    .join("\n");
  copy.appendChild(styleNode);
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${runtime.identity.boardName}${selection ? "-selection" : ""}.svg`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
