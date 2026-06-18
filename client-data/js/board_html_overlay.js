import { VIEWPORT_LAYOUT_EVENT } from "./board_viewport.js";

/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   width: number,
 *   height: number,
 * }} BoardRect
 */

/**
 * @typedef {{
 *   left: number,
 *   top: number,
 *   width: number,
 *   height: number,
 * }} LayoutRect
 */

/**
 * @typedef {{
 *   left?: unknown,
 *   top?: unknown,
 *   right?: unknown,
 *   bottom?: unknown,
 *   width?: unknown,
 *   height?: unknown,
 * }} ClientRectLike
 */

/** @typedef {BoardRect | (() => BoardRect | null | undefined)} BoardRectSource */
/** @typedef {LayoutRect | (() => LayoutRect | null | undefined)} LayoutRectSource */
/** @typedef {ClientRectLike | (() => ClientRectLike | null | undefined)} ClientRectSource */

/**
 * @typedef {{
 *   boardRectToLayoutRect(rect: BoardRect): LayoutRect,
 *   clientRectToLayoutRect(rect: ClientRectLike): LayoutRect,
 *   clientRectToBoardRect(rect: ClientRectLike): BoardRect,
 * }} OverlayViewport
 */

/**
 * @typedef {{
 *   board: {board: HTMLElement} | HTMLElement,
 *   viewport: OverlayViewport,
 *   element: HTMLElement,
 * }} BoardHtmlOverlayOptions
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {{board: HTMLElement} | HTMLElement} board
 * @returns {HTMLElement}
 */
function resolveBoardElement(board) {
  return "board" in board ? board.board : board;
}

/**
 * @param {BoardRect | null | undefined} rect
 * @returns {BoardRect | null}
 */
function normalizeBoardRect(rect) {
  if (!rect) return null;
  return {
    x: finiteOr(rect.x, 0),
    y: finiteOr(rect.y, 0),
    width: Math.max(0, finiteOr(rect.width, 0)),
    height: Math.max(0, finiteOr(rect.height, 0)),
  };
}

/**
 * @param {LayoutRect | null | undefined} rect
 * @returns {LayoutRect | null}
 */
function normalizeLayoutRect(rect) {
  if (!rect) return null;
  return {
    left: finiteOr(rect.left, 0),
    top: finiteOr(rect.top, 0),
    width: Math.max(0, finiteOr(rect.width, 0)),
    height: Math.max(0, finiteOr(rect.height, 0)),
  };
}

/**
 * @param {BoardRectSource} source
 * @returns {BoardRect | null}
 */
function readBoardRect(source) {
  return normalizeBoardRect(typeof source === "function" ? source() : source);
}

/**
 * @param {LayoutRectSource} source
 * @returns {LayoutRect | null}
 */
function readLayoutRect(source) {
  return normalizeLayoutRect(typeof source === "function" ? source() : source);
}

/**
 * @param {BoardHtmlOverlayOptions} options
 */
export function createBoardHtmlOverlay({ board, viewport, element }) {
  const boardElement = resolveBoardElement(board);
  /** @type {{kind: "board", source: BoardRectSource} | {kind: "client", source: ClientRectSource} | {kind: "layout", source: LayoutRectSource} | null} */
  let lastSync = null;
  let listening = false;

  function ensureAttached() {
    if (element.parentNode !== boardElement) boardElement.appendChild(element);
    element.style.position = "absolute";
  }

  function removeLayoutListener() {
    if (!listening) return;
    listening = false;
    boardElement.removeEventListener(VIEWPORT_LAYOUT_EVENT, render);
  }

  function addLayoutListener() {
    if (listening) return;
    listening = true;
    boardElement.addEventListener(VIEWPORT_LAYOUT_EVENT, render);
  }

  /** @param {LayoutRect} rect */
  function applyLayoutRect(rect) {
    ensureAttached();
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    element.style.display = "";
  }

  function render() {
    if (!lastSync) return;
    let rect = null;
    if (lastSync.kind === "board") {
      const boardRect = readBoardRect(lastSync.source);
      rect = boardRect ? viewport.boardRectToLayoutRect(boardRect) : null;
    } else if (lastSync.kind === "client") {
      const source = lastSync.source;
      const clientRect = typeof source === "function" ? source() : source;
      rect = clientRect ? viewport.clientRectToLayoutRect(clientRect) : null;
    } else {
      rect = readLayoutRect(lastSync.source);
    }
    if (!rect) {
      element.style.display = "none";
      return;
    }
    applyLayoutRect(rect);
  }

  return {
    /** @param {BoardRectSource} rect */
    syncBoardRect(rect) {
      lastSync = { kind: "board", source: rect };
      addLayoutListener();
      render();
    },
    /** @param {LayoutRectSource} rect */
    syncLayoutRect(rect) {
      lastSync = { kind: "layout", source: rect };
      addLayoutListener();
      render();
    },
    /** @param {ClientRectSource} rect */
    syncClientRect(rect) {
      lastSync =
        typeof rect === "function"
          ? { kind: "client", source: rect }
          : { kind: "board", source: viewport.clientRectToBoardRect(rect) };
      addLayoutListener();
      render();
    },
    hide() {
      lastSync = null;
      removeLayoutListener();
      element.style.display = "none";
    },
    destroy() {
      this.hide();
      if (element.parentNode === boardElement) {
        boardElement.removeChild(element);
      }
    },
  };
}
