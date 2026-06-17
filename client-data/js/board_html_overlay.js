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
 *   left?: unknown,
 *   top?: unknown,
 *   right?: unknown,
 *   bottom?: unknown,
 *   width?: unknown,
 *   height?: unknown,
 * }} ClientRectLike
 */

/** @typedef {BoardRect | (() => BoardRect | null | undefined)} BoardRectSource */
/** @typedef {ClientRectLike | (() => ClientRectLike | null | undefined)} ClientRectSource */

/**
 * @typedef {{
 *   getScale(): number,
 *   boardCoordinateToLayout(value: unknown): number,
 *   clientRectToBoardLayoutRect(rect: ClientRectLike): BoardRect,
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
 * @param {BoardRectSource} source
 * @returns {BoardRect | null}
 */
function readBoardRect(source) {
  return normalizeBoardRect(typeof source === "function" ? source() : source);
}

/**
 * @param {OverlayViewport} viewport
 * @param {ClientRectLike} rect
 * @returns {BoardRect}
 */
function clientRectToBoardRect(viewport, rect) {
  const scale = Math.max(0.000001, finiteOr(viewport.getScale(), 1));
  const layoutRect = viewport.clientRectToBoardLayoutRect(rect);
  return {
    x: layoutRect.x / scale,
    y: layoutRect.y / scale,
    width: layoutRect.width / scale,
    height: layoutRect.height / scale,
  };
}

/**
 * @param {BoardHtmlOverlayOptions} options
 */
export function createBoardHtmlOverlay({ board, viewport, element }) {
  const boardElement = resolveBoardElement(board);
  /** @type {{kind: "board", source: BoardRectSource} | {kind: "client", source: ClientRectSource} | null} */
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

  /** @param {BoardRect} rect */
  function applyBoardRect(rect) {
    ensureAttached();
    element.style.left = `${viewport.boardCoordinateToLayout(rect.x)}px`;
    element.style.top = `${viewport.boardCoordinateToLayout(rect.y)}px`;
    element.style.width = `${viewport.boardCoordinateToLayout(rect.width)}px`;
    element.style.height = `${viewport.boardCoordinateToLayout(rect.height)}px`;
    element.style.display = "";
  }

  function render() {
    if (!lastSync) return;
    const rect =
      lastSync.kind === "board"
        ? readBoardRect(lastSync.source)
        : normalizeBoardRect(
            (() => {
              const source = lastSync && lastSync.source;
              if (!source) return null;
              const clientRect =
                typeof source === "function" ? source() : source;
              return clientRect
                ? clientRectToBoardRect(viewport, clientRect)
                : null;
            })(),
          );
    if (!rect) {
      element.style.display = "none";
      return;
    }
    applyBoardRect(rect);
  }

  return {
    /** @param {BoardRectSource} rect */
    syncBoardRect(rect) {
      lastSync = { kind: "board", source: rect };
      addLayoutListener();
      render();
    },
    /** @param {ClientRectSource} rect */
    syncClientRect(rect) {
      lastSync =
        typeof rect === "function"
          ? { kind: "client", source: rect }
          : { kind: "board", source: clientRectToBoardRect(viewport, rect) };
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
