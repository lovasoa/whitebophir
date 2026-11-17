import { normalizeSeq } from "./board_message_replay.js";

/** @import { AppToolsState } from "../../types/app-runtime" */

/**
 * @param {Document} document
 * @param {string} elementId
 * @returns {Promise<Element>}
 */
export function waitForElement(document, elementId) {
  const existing = document.getElementById(elementId);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const element = document.getElementById(elementId);
      if (!element) return;
      observer.disconnect();
      resolve(element);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * @param {SVGSVGElement} svg
 * @returns {{authoritativeSeq: number, drawingArea: SVGGElement}}
 */
export function readInlineBaseline(svg) {
  const drawingArea = svg.getElementById("drawingArea");
  if (!(drawingArea instanceof SVGGElement)) {
    throw new Error("Missing required element: #drawingArea");
  }
  return {
    authoritativeSeq: normalizeSeq(svg.getAttribute("data-wbo-seq")),
    drawingArea,
  };
}

/**
 * @param {AppToolsState} Tools
 * @param {Document} document
 * @returns {Promise<{authoritativeSeq: number}>}
 */
export async function attachBoardDomToRuntime(Tools, document) {
  const [boardElement, canvasElement] = await Promise.all([
    waitForElement(document, "board"),
    waitForElement(document, "canvas"),
  ]);
  if (!(boardElement instanceof HTMLElement)) {
    throw new Error("Missing required element: #board");
  }
  if (!(canvasElement instanceof SVGSVGElement)) {
    throw new Error("Missing required element: #canvas");
  }
  const baseline = readInlineBaseline(canvasElement);
  const dom = Tools.attachDom(
    boardElement,
    canvasElement,
    baseline.drawingArea,
  );
  dom.svg.width.baseVal.value = Math.max(
    dom.svg.width.baseVal.value,
    document.body.clientWidth,
  );
  dom.svg.height.baseVal.value = Math.max(
    dom.svg.height.baseVal.value,
    document.body.clientHeight,
  );
  return { authoritativeSeq: baseline.authoritativeSeq };
}
