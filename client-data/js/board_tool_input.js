/** @import { AppToolsState, MountedAppTool, ToolPointerListener, CompiledToolListener, CompiledToolListeners } from "../../types/app-runtime" */
/** @typedef {{browserOwnsActiveTouchSequence: boolean, multiTouchOwnsActiveTouchSequence: boolean}} TouchDispatchState */

export function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

/**
 * @param {MountedAppTool} tool
 * @returns {boolean}
 */
function toolCanReceiveBrowserOwnedTouch(tool) {
  // Hand native-pan lets the browser scroll. Always-on tools such as cursor
  // only observe pointer position alongside the active tool.
  return tool.alwaysOn === true || tool.getTouchPolicy?.() === "native-pan";
}

/**
 * @param {TouchEvent} event
 * @returns {boolean}
 */
function browserAlreadyOwnsTouchSequence(event) {
  return (
    (event.type === "touchstart" || event.type === "touchmove") &&
    event.cancelable === false
  );
}

/** @param {AppToolsState} Tools */
export function bindToolKeyboardControls(Tools) {
  /**
   * @param {boolean} active
   * @param {KeyboardEvent} evt
   */
  function handleShift(active, evt) {
    if (
      evt.keyCode === 16 &&
      Tools?.toolRegistry.current &&
      Tools.toolRegistry.current.secondary &&
      Tools.toolRegistry.current.secondary.active !== active
    ) {
      Tools.toolRegistry.change(Tools.toolRegistry.current.name);
    }
  }
  window.addEventListener("keydown", handleShift.bind(null, true));
  window.addEventListener("keyup", handleShift.bind(null, false));
}

/**
 * @param {AppToolsState} Tools
 * @param {MountedAppTool} tool
 * @returns {CompiledToolListeners}
 */
export function compileToolListeners(Tools, tool) {
  /**
   * @param {ToolPointerListener} listener
   * @param {boolean} isTouchEvent
   * @returns {CompiledToolListener}
   */
  function compilePointerListener(listener, isTouchEvent) {
    return function handlePointer(evt) {
      if (
        tool === Tools.toolRegistry.current &&
        (Tools.toolRegistry.shouldDisableTool(tool.name) ||
          (listener === tool.listeners.press &&
            !Tools.toolRegistry.canInteractWithTool(tool.name)))
      ) {
        return true;
      }
      if (isTouchEvent) {
        const touchEvent = /** @type {TouchEvent} */ (evt);
        if (
          touchEvent.changedTouches.length !== 1 ||
          touchEvent.touches.length > 1
        ) {
          if (
            !toolCanReceiveBrowserOwnedTouch(tool) &&
            !touchDispatchState.multiTouchOwnsActiveTouchSequence
          ) {
            cancelToolTouchGesture(touchEvent);
            touchDispatchState.multiTouchOwnsActiveTouchSequence = true;
          }
          resetTouchDispatchStateIfDone(touchEvent);
          return true;
        }
        if (
          (touchEvent.type === "touchstart" ||
            touchEvent.type === "touchmove") &&
          touchEvent.touches.length !== 1
        ) {
          return true;
        }
        if (
          (touchEvent.type === "touchend" ||
            touchEvent.type === "touchcancel") &&
          touchEvent.touches.length !== 0
        ) {
          return true;
        }
        // cancelable=false means the browser has taken over this touch
        // sequence for scrolling or zooming. App tools must not also draw,
        // erase, transform, or zoom from that same user gesture.
        if (
          browserAlreadyOwnsTouchSequence(touchEvent) &&
          !toolCanReceiveBrowserOwnedTouch(tool)
        ) {
          if (!touchDispatchState.browserOwnsActiveTouchSequence) {
            cancelToolTouchGesture(touchEvent);
          }
          touchDispatchState.browserOwnsActiveTouchSequence = true;
        }
        if (
          touchDispatchState.browserOwnsActiveTouchSequence ||
          touchDispatchState.multiTouchOwnsActiveTouchSequence
        ) {
          resetTouchDispatchStateIfDone(touchEvent);
          return true;
        }
        const touch = touchEvent.changedTouches[0];
        if (!touch) return true;
        return listener(
          Tools.coordinates.pageCoordinateToBoard(touch.pageX),
          Tools.coordinates.pageCoordinateToBoard(touch.pageY),
          touchEvent,
          true,
        );
      }
      const mouseEvent = /** @type {MouseEvent} */ (evt);
      return listener(
        Tools.coordinates.pageCoordinateToBoard(mouseEvent.pageX),
        Tools.coordinates.pageCoordinateToBoard(mouseEvent.pageY),
        mouseEvent,
        false,
      );
    };
  }

  /**
   * @param {CompiledToolListener} listener
   * @returns {CompiledToolListener}
   */
  function wrapUnsetHover(listener) {
    return function unsetHover(evt) {
      blurActiveElement();
      return listener(evt);
    };
  }

  const compiled = /** @type {CompiledToolListeners} */ ({});
  const touchDispatchState = /** @type {TouchDispatchState} */ ({
    browserOwnsActiveTouchSequence: false,
    multiTouchOwnsActiveTouchSequence: false,
  });

  /** @param {TouchEvent} touchEvent */
  function cancelToolTouchGesture(touchEvent) {
    tool.cancelTouchGesture?.(touchEvent);
  }

  /** @param {TouchEvent} touchEvent */
  function resetTouchDispatchStateIfDone(touchEvent) {
    if (
      (touchEvent.type === "touchend" || touchEvent.type === "touchcancel") &&
      touchEvent.touches.length === 0
    ) {
      touchDispatchState.browserOwnsActiveTouchSequence = false;
      touchDispatchState.multiTouchOwnsActiveTouchSequence = false;
    }
  }

  if (tool.listeners.press) {
    compiled.mousedown = wrapUnsetHover(
      compilePointerListener(tool.listeners.press, false),
    );
    compiled.touchstart = wrapUnsetHover(
      compilePointerListener(tool.listeners.press, true),
    );
  }
  if (tool.listeners.move) {
    compiled.mousemove = compilePointerListener(tool.listeners.move, false);
    compiled.touchmove = compilePointerListener(tool.listeners.move, true);
  }
  if (tool.listeners.release) {
    compiled.mouseup = compilePointerListener(tool.listeners.release, false);
    compiled.mouseleave = compiled.mouseup;
    const touchRelease = compilePointerListener(tool.listeners.release, true);
    compiled.touchleave = touchRelease;
    compiled.touchend = touchRelease;
    compiled.touchcancel = touchRelease;
  }
  return compiled;
}
