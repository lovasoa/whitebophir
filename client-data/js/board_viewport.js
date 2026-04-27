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
const VIEWPORT_HASH_SYNC_DELAY_MS = 100;
const VIEWPORT_HASH_PUSH_INTERVAL_MS = 5000;
const PINCH_MIN_DISTANCE = 16;
const BOARD_EXTENT_MARGIN = 20000;

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
 *   zoomBy(factor: number, pageX: number, pageY: number): number,
 *   beginPan(clientX: number, clientY: number): void,
 *   movePan(clientX: number, clientY: number): void,
 *   endPan(): void,
 *   install(): void,
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
 * @param {{pageX: number, pageY: number}} first
 * @param {{pageX: number, pageY: number}} second
 * @returns {{pageX: number, pageY: number}}
 */
function midpoint(first, second) {
  return {
    pageX: (first.pageX + second.pageX) / 2,
    pageY: (first.pageY + second.pageY) / 2,
  };
}

/**
 * @param {any} Tools
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
  /** @type {{distance: number, scale: number} | null} */
  let activePinch = null;

  /**
   * @returns {ScaleLimits}
   */
  function currentScaleLimits() {
    return {
      maxBoardSize: Number(Tools.server_config.MAX_BOARD_SIZE) || undefined,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  /**
   * @returns {number}
   */
  function currentMaxBoardSize() {
    return Number(Tools.server_config.MAX_BOARD_SIZE) || DEFAULT_MAX_BOARD_SIZE;
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
  }

  /**
   * @returns {void}
   */
  function applyTouchPolicy() {
    const touchAction = touchPolicy === "native-pan" ? "auto" : "";
    if (Tools.board) Tools.board.style.touchAction = touchAction;
    if (Tools.svg?.style) Tools.svg.style.touchAction = touchAction;
  }

  /**
   * @returns {void}
   */
  function syncLayoutSize() {
    if (!Tools.board || !Tools.svg) return;
    const size = getScaledBoardLayoutSize(
      Tools.svg.width.baseVal.value,
      Tools.svg.height.baseVal.value,
      Tools.scale,
      window.innerWidth,
      window.innerHeight,
    );
    Tools.board.style.width = `${size.width}px`;
    Tools.board.style.height = `${size.height}px`;
    Tools.board.dataset.viewportManaged = "true";
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
    if (!Tools.svg) return false;
    const targetWidth = extentCoordinate(width);
    const targetHeight = extentCoordinate(height);
    if (targetWidth === null || targetHeight === null) return false;
    let resized = false;
    if (targetWidth > Tools.svg.width.baseVal.value) {
      Tools.svg.width.baseVal.value = targetWidth;
      resized = true;
    }
    if (targetHeight > Tools.svg.height.baseVal.value) {
      Tools.svg.height.baseVal.value = targetHeight;
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
    if (!Tools.svg) {
      Tools.scale = appliedScale;
      return appliedScale;
    }
    Tools.svg.style.willChange = "transform";
    Tools.svg.style.transform = `scale(${appliedScale})`;
    Tools.scale = appliedScale;
    const resized =
      appliedScale <= scaleLimits.minScale &&
      ensureBoardExtentAtLeast(currentMaxBoardSize(), currentMaxBoardSize());
    if (!resized) syncLayoutSize();
    if (scaleTimeout !== null) clearTimeout(scaleTimeout);
    scaleTimeout = window.setTimeout(() => {
      if (Tools.svg) Tools.svg.style.willChange = "auto";
    }, SCALE_WILL_CHANGE_TIMEOUT_MS);
    Tools.syncDrawToolAvailability(false);
    return appliedScale;
  }

  /**
   * @param {number} scale
   * @param {number} pageX
   * @param {number} pageY
   * @returns {number}
   */
  function zoomAtPagePoint(scale, pageX, pageY) {
    const oldScale = Tools.getScale();
    const x = Tools.toBoardCoordinate(screenToBoard(pageX, oldScale));
    const y = Tools.toBoardCoordinate(screenToBoard(pageY, oldScale));
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
   * @returns {void}
   */
  function flushWheelZoom() {
    wheelAnimationFrame = null;
    const factor = wheelDeltaToScaleFactor(wheelDelta);
    wheelDelta = 0;
    zoomAtPagePoint(Tools.getScale() * factor, wheelPageX, wheelPageY);
  }

  /**
   * @param {WheelEvent} event
   * @returns {void}
   */
  function handleWheel(event) {
    if (event.cancelable) event.preventDefault();
    if (event.altKey && !event.ctrlKey) {
      const change = event.shiftKey ? 1 : 5;
      Tools.setSize(
        Tools.getSize() - (normalizeWheelDelta(event) / 100) * change,
      );
      return;
    }
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
   * @param {TouchEvent} event
   * @returns {void}
   */
  function startPinch(event) {
    const touches = getPinchTouches(event);
    if (!touches) return;
    const distance = distanceBetween(touches[0], touches[1]);
    if (distance < PINCH_MIN_DISTANCE) return;
    activePinch = {
      distance,
      scale: Tools.getScale(),
    };
  }

  /**
   * @param {TouchEvent} event
   * @returns {void}
   */
  function handleTouchStart(event) {
    if (event.touches.length === 2) startPinch(event);
  }

  /**
   * @param {TouchEvent} event
   * @returns {void}
   */
  function handleTouchMove(event) {
    if (event.touches.length !== 2) return;
    const touches = getPinchTouches(event);
    if (!touches) return;
    if (!activePinch) startPinch(event);
    if (!activePinch) return;
    event.stopPropagation();
    const distance = distanceBetween(touches[0], touches[1]);
    const anchor = midpoint(touches[0], touches[1]);
    zoomAtPagePoint(
      activePinch.scale * (distance / activePinch.distance),
      anchor.pageX,
      anchor.pageY,
    );
  }

  /**
   * @param {TouchEvent} event
   * @returns {void}
   */
  function handleTouchEnd(event) {
    if (event.touches.length < 2) activePinch = null;
  }

  function syncViewportHashFromScroll() {
    const scale = Tools.getScale();
    const x = document.documentElement.scrollLeft / scale;
    const y = document.documentElement.scrollTop / scale;

    if (viewportHashScrollTimeout !== null) {
      clearTimeout(viewportHashScrollTimeout);
    }
    viewportHashScrollTimeout = window.setTimeout(
      function updateViewportHistory() {
        const hash = `#${x | 0},${y | 0},${Tools.getScale().toFixed(VIEWPORT_HASH_SCALE_DECIMALS)}`;
        if (
          Date.now() - lastViewportHashStateUpdate >
            VIEWPORT_HASH_PUSH_INTERVAL_MS &&
          hash !== window.location.hash
        ) {
          window.history.pushState({}, "", hash);
          lastViewportHashStateUpdate = Date.now();
        } else {
          window.history.replaceState({}, "", hash);
        }
      },
      VIEWPORT_HASH_SYNC_DELAY_MS,
    );
  }

  /** @type {ViewportController} */
  const controller = {
    setScale,
    getScale: () => Tools.scale,
    syncLayoutSize,
    setTouchPolicy(policy) {
      touchPolicy = policy === "native-pan" ? "native-pan" : "app-gesture";
      applyTouchPolicy();
    },
    ensureBoardExtentAtLeast,
    ensureBoardExtentForPoint,
    ensureBoardExtentForBounds,
    pageCoordinateToBoard(value) {
      return Tools.toBoardCoordinate(screenToBoard(value, Tools.getScale()));
    },
    panBy(dx, dy) {
      panTo(
        document.documentElement.scrollLeft + dx,
        document.documentElement.scrollTop + dy,
      );
    },
    panTo,
    zoomAt: zoomAtPagePoint,
    zoomBy(factor, pageX, pageY) {
      return zoomAtPagePoint(Tools.getScale() * factor, pageX, pageY);
    },
    beginPan(clientX, clientY) {
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
      activePan = null;
    },
    install() {
      if (installed || !Tools.board) return;
      installed = true;
      window.addEventListener("resize", syncLayoutSize);
      Tools.board.addEventListener("wheel", handleWheel, { passive: false });
      Tools.board.addEventListener("touchstart", handleTouchStart, {
        passive: true,
        capture: true,
      });
      Tools.board.addEventListener("touchmove", handleTouchMove, {
        passive: true,
        capture: true,
      });
      Tools.board.addEventListener("touchend", handleTouchEnd, {
        capture: true,
      });
      Tools.board.addEventListener("touchcancel", handleTouchEnd, {
        capture: true,
      });
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
      const x = Tools.toBoardCoordinate(coords[0]);
      const y = Tools.toBoardCoordinate(coords[1]);
      const scale = Number.parseFloat(coords[2] || "");
      ensureBoardExtentForPoint(x, y);
      const appliedScale = setScale(scale);
      panTo(boardToScroll(x, appliedScale), boardToScroll(y, appliedScale));
    },
  };

  return controller;
}
