/**
 * @typedef {{
 *   anchor: HTMLElement,
 *   panel: HTMLElement,
 *   gap?: number,
 *   margin?: number,
 *   fallbackWidth?: number,
 * }} AnchoredPanelPositionOptions
 */

/**
 * @typedef {{
 *   left: number,
 *   top: number,
 *   maxHeight: number,
 * }} AnchoredPanelPosition
 */

/**
 * @typedef {{
 *   anchor?: HTMLElement,
 *   panel: HTMLElement,
 *   isOpen: () => boolean,
 *   open?: () => void,
 *   close?: () => void,
 *   position?: () => void,
 *   hoverElements?: HTMLElement[],
 *   closeDelayMs?: number,
 *   closeOnBlurFrom?: HTMLElement,
 *   closeOnEscape?: boolean,
 *   restoreFocusElement?: HTMLElement,
 * }} FloatingPanelControllerOptions
 */

/**
 * @typedef {{
 *   open: () => void,
 *   close: () => void,
 *   toggle: () => void,
 *   scheduleClose: () => void,
 *   cancelClose: () => void,
 *   syncPosition: () => void,
 *   destroy: () => void,
 * }} FloatingPanelController
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Positions a fixed panel next to an anchor while keeping it inside the
 * viewport. This intentionally does not own open/closed state.
 * @param {AnchoredPanelPositionOptions} options
 * @returns {AnchoredPanelPosition}
 */
export function positionAnchoredPanel({
  anchor,
  panel,
  gap = 8,
  margin = 8,
  fallbackWidth = 200,
}) {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const panelWidth = panel.offsetWidth || fallbackWidth;
  const panelHeight = panel.offsetHeight || 0;

  let left = rect.right + gap;
  if (left + panelWidth > viewportWidth - margin) {
    left = rect.left - gap - panelWidth;
  }
  left = clamp(left, margin, viewportWidth - margin - panelWidth);

  const maxHeight = Math.max(0, viewportHeight - 2 * margin);
  panel.style.maxHeight = `${maxHeight}px`;
  panel.style.overflowY = panelHeight > maxHeight ? "auto" : "";

  const top =
    rect.top + panelHeight <= viewportHeight - margin
      ? rect.top
      : rect.bottom - panelHeight;
  const clampedTop = clamp(top, margin, viewportHeight - margin - panelHeight);

  panel.style.left = `${left}px`;
  panel.style.top = `${clampedTop}px`;
  return { left, top: clampedTop, maxHeight };
}

/**
 * @param {FloatingPanelControllerOptions} options
 * @returns {FloatingPanelController}
 */
export function createFloatingPanelController(options) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let closeTimer = null;
  /** @type {{element: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions}[]} */
  const listeners = [];

  function cancelClose() {
    if (closeTimer === null) return;
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  function syncPosition() {
    if (options.isOpen()) options.position?.();
  }

  function open() {
    cancelClose();
    if (!options.isOpen()) options.open?.();
    syncPosition();
  }

  function close() {
    cancelClose();
    if (options.isOpen()) options.close?.();
  }

  function toggle() {
    if (options.isOpen()) close();
    else open();
  }

  function scheduleClose() {
    cancelClose();
    const delay = Math.max(0, options.closeDelayMs || 0);
    if (delay === 0) {
      close();
      return;
    }
    closeTimer = setTimeout(() => {
      closeTimer = null;
      close();
    }, delay);
  }

  /**
   * @param {EventTarget} element
   * @param {string} type
   * @param {EventListener} listener
   * @param {AddEventListenerOptions} [listenerOptions]
   */
  function addListener(element, type, listener, listenerOptions) {
    element.addEventListener(type, listener, listenerOptions);
    listeners.push({ element, type, listener, options: listenerOptions });
  }

  (options.hoverElements || []).forEach((element) => {
    addListener(element, "mouseenter", open);
    addListener(element, "mouseleave", scheduleClose);
  });

  if (options.closeOnBlurFrom) {
    addListener(options.closeOnBlurFrom, "blur", () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (
          !options.panel.matches(":hover") &&
          !options.panel.contains(activeElement) &&
          activeElement !== options.closeOnBlurFrom
        ) {
          close();
        }
      }, 0);
    });
  }

  if (options.closeOnEscape !== false) {
    addListener(options.panel, "keydown", (evt) => {
      const keyEvent = /** @type {KeyboardEvent} */ (evt);
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      close();
      options.restoreFocusElement?.focus();
    });
  }

  if (options.position) {
    const resizeListener = () => syncPosition();
    addListener(window, "resize", resizeListener, { passive: true });
    if (window.visualViewport) {
      addListener(window.visualViewport, "resize", resizeListener, {
        passive: true,
      });
    }
  }

  return {
    open,
    close,
    toggle,
    scheduleClose,
    cancelClose,
    syncPosition,
    destroy() {
      cancelClose();
      listeners.forEach((entry) => {
        entry.element.removeEventListener(
          entry.type,
          entry.listener,
          entry.options,
        );
      });
      listeners.length = 0;
    },
  };
}

export class UiModule {
  /** @param {AnchoredPanelPositionOptions} options */
  positionAnchoredPanel(options) {
    return positionAnchoredPanel(options);
  }

  /** @param {FloatingPanelControllerOptions} options */
  createFloatingPanelController(options) {
    return createFloatingPanelController(options);
  }
}
