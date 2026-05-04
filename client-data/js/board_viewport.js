import { isTextEntryTarget } from "./text_entry_target.js";

export const DEFAULT_BOARD_SCALE = 0.1;
export const MIN_BOARD_SCALE = 0.01;
export const MAX_BOARD_SCALE = 1;
export const VIEWPORT_HASH_SCALE_DECIMALS = 3;

const DEFAULT_MAX_BOARD_SIZE = 655360;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_PIXELS = 30;
const WHEEL_PAGE_PIXELS = 1000;
const WHEEL_ZOOM_SENSITIVITY = 0.01;
const WHEEL_MAX_FRAME_DELTA = 30;
const SCALE_WILL_CHANGE_TIMEOUT_MS = 1000;
const VIEWPORT_HASH_SYNC_DELAY_MS = 200;
const VIEWPORT_HASH_PUSH_INTERVAL_MS = 5000;
const PINCH_MIN_DISTANCE = 16;
const BOARD_EXTENT_MARGIN = 20000;
/** Opacity change per event is `wheelDelta / this` (smaller = stronger; was 1000). */
const STYLE_WHEEL_OPACITY_DIVISOR = 500;
/** Size change is `(wheelDelta / 100) * this` with S + wheel (was 5). */
const STYLE_WHEEL_SIZE_FACTOR = 10;
const APP_TOOL_TOUCH_ACTION = "none";
const BROWSER_SCROLL_WITHOUT_ZOOM_TOUCH_ACTION = "pan-x pan-y";
const TOUCH_EVENT_LISTENER_OPTIONS = {
  passive: false,
  capture: true,
};
/** @type {GestureCoordinatorEventName[]} */
const TOUCH_EVENT_NAMES = [
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
];

/**
 * @typedef {{
 *   minScale?: number,
 *   maxScale?: number,
 *   defaultScale?: number,
 *   maxBoardSize?: number,
 *   viewportWidth?: number,
 *   viewportHeight?: number,
 * }} ScaleLimits
 */

/**
 * @typedef {{
 *   scrollLeft: number,
 *   scrollTop: number,
 *   scale: number,
 *   x: number,
 *   y: number,
 * }} ViewportState
 */

/** @typedef {"app-gesture" | "native-pan"} ViewportTouchPolicy */
/** @typedef {"none" | "browser" | "viewport-gesture"} TouchGestureOwner */
/** @typedef {Pick<import("../../types/app-runtime").AppToolsState, "config" | "coordinates" | "dom" | "preferences" | "toolRegistry" | "viewportState">} ViewportRuntime */
/** @typedef {{startPinchPan(event: TouchEvent): void, updatePinchPan(event: TouchEvent): void, endPinchPan(): void, cancelPinchPan(): void}} GestureCoordinatorHandlers */
/** @typedef {"touchstart" | "touchmove" | "touchend" | "touchcancel"} GestureCoordinatorEventName */
/** @typedef {Record<GestureCoordinatorEventName, (event: TouchEvent) => void>} GestureCoordinatorEventHandlers */

/**
 * @typedef {{
 *   setScale(scale: number): number,
 *   getScale(): number,
 *   syncLayoutSize(): void,
 *   setTouchPolicy(policy: ViewportTouchPolicy): void,
 *   ensureBoardExtentAtLeast(width: number, height: number): boolean,
 *   ensureBoardExtentForPoint(x: number, y: number): boolean,
 *   ensureBoardExtentForBounds(bounds: {maxX: number, maxY: number} | null | undefined): boolean,
 *   pageCoordinateToBoard(value: unknown): number,
 *   panBy(dx: number, dy: number): void,
 *   panTo(left: number, top: number): void,
 *   zoomAt(scale: number, pageX: number, pageY: number): number,
 *   zoomAtBoardPoint(scale: number, boardX: number, boardY: number): number,
 *   zoomBy(factor: number, pageX: number, pageY: number): number,
 *   beginPan(clientX: number, clientY: number): void,
 *   movePan(clientX: number, clientY: number): void,
 *   endPan(): void,
 *   install(): void,
 *   installTemporaryPan(): () => void,
 *   installHashObservers(): void,
 *   applyFromHash(): void,
 * }} ViewportController
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
 * @param {"innerWidth" | "innerHeight"} property
 * @returns {number}
 */
function windowDimension(property) {
  return typeof window === "undefined" ? 0 : window[property] || 0;
}

/**
 * @param {ScaleLimits} limits
 * @returns {{minScale: number, maxScale: number, defaultScale: number}}
 */
export function getScaleLimits(limits = {}) {
  const maxBoardSize = finiteOr(limits.maxBoardSize, DEFAULT_MAX_BOARD_SIZE);
  const viewportWidth = finiteOr(
    limits.viewportWidth,
    windowDimension("innerWidth"),
  );
  const viewportHeight = finiteOr(
    limits.viewportHeight,
    windowDimension("innerHeight"),
  );
  const fullScale = Math.max(viewportWidth, viewportHeight) / maxBoardSize;
  return {
    minScale: Math.max(finiteOr(limits.minScale, MIN_BOARD_SCALE), fullScale),
    maxScale: finiteOr(limits.maxScale, MAX_BOARD_SCALE),
    defaultScale: finiteOr(limits.defaultScale, DEFAULT_BOARD_SCALE),
  };
}

/**
 * @param {unknown} scale
 * @param {ScaleLimits} limits
 * @returns {number}
 */
export function clampScale(scale, limits = {}) {
  const scaleLimits = getScaleLimits(limits);
  const value = finiteOr(scale, scaleLimits.defaultScale);
  return Math.max(scaleLimits.minScale, Math.min(scaleLimits.maxScale, value));
}

/**
 * @param {unknown} value
 * @param {number} scale
 * @returns {number}
 */
export function screenToBoard(value, scale) {
  const screenCoordinate = Number(value);
  if (!Number.isFinite(screenCoordinate)) return 0;
  return screenCoordinate / scale;
}

/**
 * @param {number} boardCoordinate
 * @param {number} scale
 * @returns {number}
 */
export function boardToScroll(boardCoordinate, scale) {
  return boardCoordinate * scale;
}

/**
 * @param {unknown} svgWidth
 * @param {unknown} svgHeight
 * @param {unknown} scale
 * @param {unknown} viewportWidth
 * @param {unknown} viewportHeight
 * @returns {{width: number, height: number}}
 */
export function getScaledBoardLayoutSize(
  svgWidth,
  svgHeight,
  scale,
  viewportWidth,
  viewportHeight,
) {
  const safeScale = Math.max(0, finiteOr(scale, DEFAULT_BOARD_SCALE));
  return {
    width: Math.max(
      0,
      finiteOr(viewportWidth, 0),
      finiteOr(svgWidth, 0) * safeScale,
    ),
    height: Math.max(
      0,
      finiteOr(viewportHeight, 0),
      finiteOr(svgHeight, 0) * safeScale,
    ),
  };
}

/**
 * @param {{deltaMode?: number, deltaY?: number}} event
 * @returns {number}
 */
export function normalizeWheelDelta(event) {
  return normalizeWheelAxisDelta(event, "deltaY");
}

/**
 * @param {{deltaMode?: number, deltaX?: number, deltaY?: number}} event
 * @param {"deltaX" | "deltaY"} axis
 * @returns {number}
 */
function normalizeWheelAxisDelta(event, axis) {
  const multiplier =
    event.deltaMode === DOM_DELTA_LINE
      ? WHEEL_LINE_PIXELS
      : event.deltaMode === DOM_DELTA_PAGE
        ? WHEEL_PAGE_PIXELS
        : 1;
  return finiteOr(event[axis], 0) * multiplier;
}

/**
 * Prefer vertical wheel delta; when it is zero or smaller than horizontal (common on Mac
 * trackpads), use deltaX for S/O + wheel size and opacity adjustments.
 *
 * @param {WheelEvent} event
 * @returns {number}
 */
export function wheelDeltaForStyleWheel(event) {
  const dy = normalizeWheelAxisDelta(event, "deltaY");
  const dx = normalizeWheelAxisDelta(event, "deltaX");
  const absY = Math.abs(dy);
  const absX = Math.abs(dx);
  if (absY >= absX) return dy;
  return dx;
}

/**
 * @param {number} delta
 * @returns {number}
 */
export function wheelDeltaToScaleFactor(delta) {
  const cappedDelta = Math.max(
    -WHEEL_MAX_FRAME_DELTA,
    Math.min(WHEEL_MAX_FRAME_DELTA, delta),
  );
  return Math.exp(-cappedDelta * WHEEL_ZOOM_SENSITIVITY);
}

/**
 * @param {ViewportState} viewport
 * @param {number} nextScale
 * @returns {{left: number, top: number, scale: number}}
 */
export function zoomAt(viewport, nextScale) {
  const oldScale = viewport.scale;
  const scale = nextScale;
  return {
    left: viewport.scrollLeft + viewport.x * (scale - oldScale),
    top: viewport.scrollTop + viewport.y * (scale - oldScale),
    scale,
  };
}

/**
 * @param {{clientX: number, clientY: number}} first
 * @param {{clientX: number, clientY: number}} second
 * @returns {number}
 */
function distanceBetween(first, second) {
  const dx = first.clientX - second.clientX;
  const dy = first.clientY - second.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * @param {{clientX: number, clientY: number}} first
 * @param {{clientX: number, clientY: number}} second
 * @returns {{clientX: number, clientY: number}}
 */
function midpoint(first, second) {
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2,
  };
}

/**
 * @param {Event} event
 * @returns {boolean}
 */
export function safePreventDefault(event) {
  if (!event.cancelable) return false;
  event.preventDefault();
  return true;
}

class GestureCoordinator {
  /** @param {GestureCoordinatorHandlers} handlers */
  constructor(handlers) {
    this.handlers = handlers;
    /** @type {TouchGestureOwner} */
    this.owner = "none";

    /** @type {GestureCoordinatorEventHandlers} */
    this.eventHandlers = {
      touchstart: (event) => {
        if (!this.acceptCancelableTouchEvent(event)) return;
        if (event.touches.length >= 2) {
          this.claimViewportGesture(event);
          this.handlers.startPinchPan(event);
        }
      },
      touchmove: (event) => {
        if (!this.acceptCancelableTouchEvent(event)) return;
        if (this.owner === "browser") return;
        if (event.touches.length >= 2) {
          this.claimViewportGesture(event);
          this.handlers.updatePinchPan(event);
          return;
        }
        if (this.owner === "viewport-gesture") safePreventDefault(event);
      },
      touchend: (event) => {
        if (!this.acceptCancelableTouchEvent(event)) return;
        if (this.owner === "viewport-gesture") {
          safePreventDefault(event);
          if (event.touches.length === 0) {
            this.handlers.endPinchPan();
            this.reset();
          }
          return;
        }
        if (event.touches.length === 0) this.reset();
      },
      touchcancel: (event) => {
        if (!this.acceptCancelableTouchEvent(event)) return;
        if (this.owner === "viewport-gesture") {
          safePreventDefault(event);
          this.handlers.cancelPinchPan();
        }
        this.reset();
      },
    };
  }

  /** @returns {void} */
  reset() {
    this.owner = "none";
  }

  /**
   * @param {TouchEvent} event
   * @returns {boolean}
   */
  acceptCancelableTouchEvent(event) {
    if (event.cancelable) return true;
    if (this.owner === "viewport-gesture") this.handlers.cancelPinchPan();
    this.owner = "browser";
    if (event.touches.length === 0) this.reset();
    return false;
  }

  /** @param {TouchEvent} event */
  claimViewportGesture(event) {
    this.owner = "viewport-gesture";
    safePreventDefault(event);
  }
}

/**
 * @param {ViewportRuntime} Tools
 * @returns {ViewportController}
 */
export function createViewportController(Tools) {
  /** @type {number | null} */
  let scaleTimeout = null;
  /** @type {number | null} */
  let wheelAnimationFrame = null;
  let wheelDelta = 0;
  let wheelPageX = 0;
  let wheelPageY = 0;
  /** @type {number | null} */
  let viewportHashScrollTimeout = null;
  let lastViewportHashStateUpdate = Date.now();
  let installed = false;
  let hashObserversInstalled = false;
  /** @type {ViewportTouchPolicy} */
  let touchPolicy = "app-gesture";
  /** @type {{x: number, y: number, scrollLeft: number, scrollTop: number} | null} */
  let activePan = null;
  /** @type {{distance: number, scale: number, boardX: number, boardY: number} | null} */
  let activePinchPan = null;
  /** @type {(() => void) | null} */
  let temporaryPanCleanup = null;
  let styleWheelSizeKeyHeld = false;
  let styleWheelOpacityKeyHeld = false;

  /**
   * @returns {ScaleLimits}
   */
  function currentScaleLimits() {
    return {
      maxBoardSize:
        Number(Tools.config.serverConfig.MAX_BOARD_SIZE) || undefined,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  /**
   * @returns {number}
   */
  function currentMaxBoardSize() {
    return (
      Number(Tools.config.serverConfig.MAX_BOARD_SIZE) || DEFAULT_MAX_BOARD_SIZE
    );
  }

  /**
   * @param {unknown} value
   * @returns {number | null}
   */
  function extentCoordinate(value) {
    const coordinate = Number(value);
    if (!Number.isFinite(coordinate)) return null;
    return Math.max(0, Math.min(currentMaxBoardSize(), Math.ceil(coordinate)));
  }

  /**
   * @param {number} left
   * @param {number} top
   * @returns {void}
   */
  function panTo(left, top) {
    window.scrollTo(left, top);
    scheduleViewportHashSync();
  }

  /**
   * @returns {{board: HTMLElement, svg: SVGSVGElement, drawingArea: Element} | null}
   */
  function getAttachedDom() {
    return Tools.dom?.status === "attached" ? Tools.dom : null;
  }

  /**
   * @returns {void}
   */
  function applyTouchPolicy() {
    const dom = getAttachedDom();
    if (!dom) return;
    // Hand mode uses document scrolling as board panning. Other tools own
    // touch input themselves, so browser panning and browser zoom stay off.
    const touchAction =
      touchPolicy === "native-pan"
        ? BROWSER_SCROLL_WITHOUT_ZOOM_TOUCH_ACTION
        : APP_TOOL_TOUCH_ACTION;
    dom.board.style.touchAction = touchAction;
    dom.svg.style.touchAction = touchAction;
  }

  /**
   * @returns {void}
   */
  function syncLayoutSize() {
    const dom = getAttachedDom();
    if (!dom) return;
    const size = getScaledBoardLayoutSize(
      dom.svg.width.baseVal.value,
      dom.svg.height.baseVal.value,
      Tools.viewportState.scale,
      window.innerWidth,
      window.innerHeight,
    );
    dom.board.style.width = `${size.width}px`;
    dom.board.style.height = `${size.height}px`;
    dom.board.dataset.viewportManaged = "true";
    applyTouchPolicy();
  }

  /**
   * Root SVG dimensions are the canonical scroll extent. They only grow here;
   * zoom and page layout are derived from them.
   * @param {number} width
   * @param {number} height
   * @returns {boolean}
   */
  function ensureBoardExtentAtLeast(width, height) {
    const dom = getAttachedDom();
    if (!dom) return false;
    const targetWidth = extentCoordinate(width);
    const targetHeight = extentCoordinate(height);
    if (targetWidth === null || targetHeight === null) return false;
    let resized = false;
    if (targetWidth > dom.svg.width.baseVal.value) {
      dom.svg.width.baseVal.value = targetWidth;
      resized = true;
    }
    if (targetHeight > dom.svg.height.baseVal.value) {
      dom.svg.height.baseVal.value = targetHeight;
      resized = true;
    }
    if (resized) syncLayoutSize();
    return resized;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  function ensureBoardExtentForPoint(x, y) {
    return ensureBoardExtentAtLeast(
      Number(x) + BOARD_EXTENT_MARGIN,
      Number(y) + BOARD_EXTENT_MARGIN,
    );
  }

  /**
   * @param {{maxX: number, maxY: number} | null | undefined} bounds
   * @returns {boolean}
   */
  function ensureBoardExtentForBounds(bounds) {
    if (!bounds) return false;
    return ensureBoardExtentForPoint(bounds.maxX, bounds.maxY);
  }

  /**
   * @param {number} scale
   * @returns {number}
   */
  function setScale(scale) {
    const scaleLimits = getScaleLimits(currentScaleLimits());
    const value = finiteOr(scale, scaleLimits.defaultScale);
    const appliedScale = Math.max(
      scaleLimits.minScale,
      Math.min(scaleLimits.maxScale, value),
    );
    const dom = getAttachedDom();
    if (!dom) {
      Tools.viewportState.scale = appliedScale;
      return appliedScale;
    }
    dom.svg.style.willChange = "transform";
    dom.svg.style.transform = `scale(${appliedScale})`;
    Tools.viewportState.scale = appliedScale;
    const resized =
      appliedScale <= scaleLimits.minScale &&
      ensureBoardExtentAtLeast(currentMaxBoardSize(), currentMaxBoardSize());
    if (!resized) syncLayoutSize();
    if (scaleTimeout !== null) clearTimeout(scaleTimeout);
    scaleTimeout = window.setTimeout(() => {
      const timeoutDom = getAttachedDom();
      if (timeoutDom) timeoutDom.svg.style.willChange = "auto";
    }, SCALE_WILL_CHANGE_TIMEOUT_MS);
    Tools.toolRegistry.syncDrawToolAvailability(false);
    return appliedScale;
  }

  /**
   * @returns {number}
   */
  function getScale() {
    return Tools.viewportState.scale;
  }

  /**
   * @param {number} scale
   * @param {number} boardX
   * @param {number} boardY
   * @returns {number}
   */
  function zoomAtBoardPoint(scale, boardX, boardY) {
    const oldScale = getScale();
    const x = Tools.coordinates.toBoardCoordinate(boardX);
    const y = Tools.coordinates.toBoardCoordinate(boardY);
    const scrollLeft = document.documentElement.scrollLeft;
    const scrollTop = document.documentElement.scrollTop;
    const newScale = setScale(scale);
    const nextViewport = zoomAt(
      {
        scrollLeft,
        scrollTop,
        scale: oldScale,
        x,
        y,
      },
      newScale,
    );
    panTo(nextViewport.left, nextViewport.top);
    return newScale;
  }

  /**
   * @param {number} scale
   * @param {number} pageX
   * @param {number} pageY
   * @returns {number}
   */
  function zoomAtPagePoint(scale, pageX, pageY) {
    const oldScale = getScale();
    return zoomAtBoardPoint(
      scale,
      screenToBoard(pageX, oldScale),
      screenToBoard(pageY, oldScale),
    );
  }

  /**
   * @returns {void}
   */
  function flushWheelZoom() {
    wheelAnimationFrame = null;
    const factor = wheelDeltaToScaleFactor(wheelDelta);
    wheelDelta = 0;
    zoomAtPagePoint(getScale() * factor, wheelPageX, wheelPageY);
  }

  function resetStyleWheelModifierKeys() {
    styleWheelSizeKeyHeld = false;
    styleWheelOpacityKeyHeld = false;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function onStyleWheelModifierKeydown(event) {
    if (isTextEntryTarget(event.target)) return;
    if (event.key.length !== 1) return;
    const lower = event.key.toLowerCase();
    if (lower === "s") styleWheelSizeKeyHeld = true;
    if (lower === "o") styleWheelOpacityKeyHeld = true;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function onStyleWheelModifierKeyup(event) {
    if (event.key.length !== 1) return;
    const lower = event.key.toLowerCase();
    if (lower === "s") styleWheelSizeKeyHeld = false;
    if (lower === "o") styleWheelOpacityKeyHeld = false;
  }

  /**
   * S/O + wheel must run on window capture so it works over the toolbar/style
   * panel (wheel on `#board` never fires there). Shift is excluded so Shift+wheel
   * pan on the board still works when a key repeats focus state oddly.
   * @param {WheelEvent} event
   * @returns {void}
   */
  function handleStyleShortcutWheelCapture(event) {
    if (event.shiftKey) return;
    const prefDelta = wheelDeltaForStyleWheel(event);
    if (styleWheelOpacityKeyHeld) {
      Tools.preferences.setOpacity(
        Tools.preferences.getOpacity() -
          prefDelta / STYLE_WHEEL_OPACITY_DIVISOR,
      );
    } else if (styleWheelSizeKeyHeld) {
      Tools.preferences.setSize(
        Tools.preferences.getSize() -
          (prefDelta / 100) * STYLE_WHEEL_SIZE_FACTOR,
      );
    } else {
      return;
    }
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  /**
   * @param {WheelEvent} event
   * @returns {void}
   */
  function handleWheel(event) {
    if (event.cancelable) event.preventDefault();

    if (event.shiftKey && !event.ctrlKey) {
      controller.panBy(
        normalizeWheelAxisDelta(event, "deltaX"),
        normalizeWheelAxisDelta(event, "deltaY"),
      );
      return;
    }
    wheelDelta += normalizeWheelDelta(event);
    wheelPageX = event.pageX;
    wheelPageY = event.pageY;
    if (wheelAnimationFrame === null) {
      wheelAnimationFrame = window.requestAnimationFrame(flushWheelZoom);
    }
  }

  /**
   * @param {TouchEvent} event
   * @returns {[Touch, Touch] | null}
   */
  function getPinchTouches(event) {
    const first = event.touches[0];
    const second = event.touches[1];
    return first && second ? [first, second] : null;
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} scale
   * @returns {{x: number, y: number}}
   */
  function clientPointToBoardPoint(clientX, clientY, scale) {
    return {
      x: screenToBoard(document.documentElement.scrollLeft + clientX, scale),
      y: screenToBoard(document.documentElement.scrollTop + clientY, scale),
    };
  }

  /**
   * @param {TouchEvent} event
   * @returns {void}
   */
  function startPinchPan(event) {
    const touches = getPinchTouches(event);
    if (!touches) return;
    const distance = distanceBetween(touches[0], touches[1]);
    if (distance < PINCH_MIN_DISTANCE) return;
    clearViewportHashSync();
    const center = midpoint(touches[0], touches[1]);
    const scale = getScale();
    const boardPoint = clientPointToBoardPoint(
      center.clientX,
      center.clientY,
      scale,
    );
    activePinchPan = {
      distance,
      scale,
      boardX: boardPoint.x,
      boardY: boardPoint.y,
    };
  }

  /**
   * @param {TouchEvent} event
   * @returns {void}
   */
  function updatePinchPan(event) {
    if (event.touches.length !== 2) return;
    const touches = getPinchTouches(event);
    if (!touches) return;
    if (!activePinchPan) startPinchPan(event);
    if (!activePinchPan) return;
    const distance = distanceBetween(touches[0], touches[1]);
    const center = midpoint(touches[0], touches[1]);
    const scale = setScale(
      activePinchPan.scale * (distance / activePinchPan.distance),
    );
    // Keep the board point that was under the initial midpoint under the
    // current midpoint, so equal-distance two-finger moves pan without zooming.
    panTo(
      activePinchPan.boardX * scale - center.clientX,
      activePinchPan.boardY * scale - center.clientY,
    );
  }

  function endPinchPan() {
    const wasPinching = !!activePinchPan;
    activePinchPan = null;
    if (wasPinching) scheduleViewportHashSync();
  }

  function cancelPinchPan() {
    activePinchPan = null;
  }

  const gestureCoordinator = new GestureCoordinator({
    startPinchPan,
    updatePinchPan,
    endPinchPan,
    cancelPinchPan,
  });

  function clearViewportHashSync() {
    if (viewportHashScrollTimeout !== null) {
      window.clearTimeout(viewportHashScrollTimeout);
      viewportHashScrollTimeout = null;
    }
  }

  /**
   * @returns {string}
   */
  function currentViewportHash() {
    const scale = getScale();
    const x = document.documentElement.scrollLeft / scale;
    const y = document.documentElement.scrollTop / scale;

    return `#${x | 0},${y | 0},${scale.toFixed(VIEWPORT_HASH_SCALE_DECIMALS)}`;
  }

  function updateViewportHistory() {
    viewportHashScrollTimeout = null;
    const hash = currentViewportHash();
    if (hash === window.location.hash) return;
    if (
      Date.now() - lastViewportHashStateUpdate >
      VIEWPORT_HASH_PUSH_INTERVAL_MS
    ) {
      window.history.pushState({}, "", hash);
      lastViewportHashStateUpdate = Date.now();
    } else {
      window.history.replaceState({}, "", hash);
    }
  }

  function scheduleViewportHashSync() {
    if (!hashObserversInstalled || activePan || activePinchPan) return;
    clearViewportHashSync();
    viewportHashScrollTimeout = window.setTimeout(
      updateViewportHistory,
      VIEWPORT_HASH_SYNC_DELAY_MS,
    );
  }

  function syncViewportHashFromScroll() {
    scheduleViewportHashSync();
  }

  /** @type {ViewportController} */
  const controller = {
    setScale,
    getScale,
    syncLayoutSize,
    setTouchPolicy(policy) {
      touchPolicy = policy === "native-pan" ? "native-pan" : "app-gesture";
      applyTouchPolicy();
    },
    ensureBoardExtentAtLeast,
    ensureBoardExtentForPoint,
    ensureBoardExtentForBounds,
    pageCoordinateToBoard(value) {
      return Tools.coordinates.toBoardCoordinate(
        screenToBoard(value, getScale()),
      );
    },
    panBy(dx, dy) {
      panTo(
        document.documentElement.scrollLeft + dx,
        document.documentElement.scrollTop + dy,
      );
    },
    panTo,
    zoomAt: zoomAtPagePoint,
    zoomAtBoardPoint,
    zoomBy(factor, pageX, pageY) {
      return zoomAtPagePoint(getScale() * factor, pageX, pageY);
    },
    beginPan(clientX, clientY) {
      clearViewportHashSync();
      activePan = {
        x: clientX,
        y: clientY,
        scrollLeft: document.documentElement.scrollLeft,
        scrollTop: document.documentElement.scrollTop,
      };
    },
    movePan(clientX, clientY) {
      if (!activePan) return;
      panTo(
        activePan.scrollLeft + activePan.x - clientX,
        activePan.scrollTop + activePan.y - clientY,
      );
    },
    endPan() {
      const wasPanning = !!activePan;
      activePan = null;
      if (wasPanning) scheduleViewportHashSync();
    },
    install() {
      const dom = getAttachedDom();
      if (installed || !dom) return;
      installed = true;
      window.addEventListener("resize", syncLayoutSize);
      window.addEventListener("keydown", onStyleWheelModifierKeydown, true);
      window.addEventListener("keyup", onStyleWheelModifierKeyup, true);
      window.addEventListener("blur", resetStyleWheelModifierKeys);
      window.addEventListener("wheel", handleStyleShortcutWheelCapture, {
        passive: false,
        capture: true,
      });
      dom.board.addEventListener("wheel", handleWheel, {
        passive: false,
        capture: true,
      });
      for (const name of TOUCH_EVENT_NAMES) {
        dom.board.addEventListener(
          name,
          gestureCoordinator.eventHandlers[name],
          TOUCH_EVENT_LISTENER_OPTIONS,
        );
      }
    },
    installTemporaryPan() {
      const dom = getAttachedDom();
      if (!dom || temporaryPanCleanup) return temporaryPanCleanup || (() => {});

      /** @param {MouseEvent} event */
      function handleMouseDown(event) {
        if (event.button !== 0) return;
        if (event.cancelable) event.preventDefault();
        controller.beginPan(event.clientX, event.clientY);
      }

      /** @param {MouseEvent} event */
      function handleMouseMove(event) {
        controller.movePan(event.clientX, event.clientY);
      }

      function handleMouseUp() {
        controller.endPan();
      }

      dom.board.addEventListener("mousedown", handleMouseDown);
      dom.board.addEventListener("mousemove", handleMouseMove);
      dom.board.addEventListener("mouseup", handleMouseUp);
      dom.board.addEventListener("mouseleave", handleMouseUp);
      temporaryPanCleanup = () => {
        dom.board.removeEventListener("mousedown", handleMouseDown);
        dom.board.removeEventListener("mousemove", handleMouseMove);
        dom.board.removeEventListener("mouseup", handleMouseUp);
        dom.board.removeEventListener("mouseleave", handleMouseUp);
        controller.endPan();
        temporaryPanCleanup = null;
      };
      return temporaryPanCleanup;
    },
    installHashObservers() {
      if (hashObserversInstalled) return;
      hashObserversInstalled = true;
      window.addEventListener("scroll", syncViewportHashFromScroll);
      window.addEventListener("hashchange", controller.applyFromHash, false);
      window.addEventListener("popstate", controller.applyFromHash, false);
    },
    applyFromHash() {
      const coords = window.location.hash.slice(1).split(",");
      const x = Tools.coordinates.toBoardCoordinate(coords[0]);
      const y = Tools.coordinates.toBoardCoordinate(coords[1]);
      const scale = Number.parseFloat(coords[2] || "");
      ensureBoardExtentForPoint(x, y);
      const appliedScale = setScale(scale);
      panTo(boardToScroll(x, appliedScale), boardToScroll(y, appliedScale));
    },
  };

  return controller;
}
