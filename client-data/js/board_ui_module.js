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
 * @typedef {{
 *   message: string,
 *   title?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   variant?: "default" | "danger",
 * }} ConfirmDialogOptions
 */

/**
 * @template T
 * @typedef {{
 *   label: string,
 *   value: T,
 *   variant?: "secondary" | "warning" | "danger",
 * }} ChoiceDialogOption
 */

/**
 * @template T
 * @typedef {{
 *   message: string,
 *   choices: ChoiceDialogOption<T>[],
 *   cancelLabel?: string,
 * }} ChoiceDialogOptions
 */

/**
 * @typedef {{
 *   overlayId?: string,
 *   dialogId?: string,
 *   overlayClassName?: string,
 *   dialogClassName?: string,
 *   hiddenClass?: string,
 *   initiallyHidden?: boolean,
 * }} ModalShellOptions
 */

/**
 * @typedef {{
 *   overlay: HTMLElement,
 *   dialog: HTMLElement,
 *   show: () => void,
 *   hide: () => void,
 *   destroy: () => void,
 * }} ModalShell
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

/**
 * @param {HTMLElement} element
 * @param {string | undefined} className
 */
function addOptionalClasses(element, className) {
  if (!className) return;
  className
    .split(/\s+/)
    .filter(Boolean)
    .forEach((name) => element.classList.add(name));
}

const MODAL_BACKDROP_CLASS = "wbo-modal-backdrop";
const DIALOG_PANEL_CLASS = "wbo-dialog";
const NATIVE_DIALOG_CLASS = "wbo-native-dialog";

/**
 * @param {HTMLElement} element
 * @param {string | undefined} className
 */
function applyModalBackdropClasses(element, className) {
  element.classList.add(MODAL_BACKDROP_CLASS);
  addOptionalClasses(element, className);
}

/**
 * @param {HTMLElement} element
 * @param {string | undefined} className
 */
function applyDialogPanelClasses(element, className) {
  element.classList.add(DIALOG_PANEL_CLASS);
  addOptionalClasses(element, className);
}

/**
 * @param {string | undefined} className
 * @returns {HTMLElement}
 */
function createDialogPanel(className) {
  const panel = document.createElement("div");
  applyDialogPanelClasses(panel, className);
  return panel;
}

/**
 * @returns {{dialog: HTMLDialogElement, panel: HTMLElement}}
 */
function createNativeDialogShell() {
  const dialog = document.createElement("dialog");
  dialog.classList.add(NATIVE_DIALOG_CLASS);
  const panel = createDialogPanel(undefined);
  dialog.appendChild(panel);
  return { dialog, panel };
}

/**
 * @param {ModalShellOptions} [options]
 * @returns {ModalShell}
 */
export function createModalShell(options = {}) {
  const {
    overlayId,
    dialogId,
    overlayClassName,
    dialogClassName,
    hiddenClass,
    initiallyHidden = false,
  } = options;
  let overlay = overlayId ? document.getElementById(overlayId) : null;
  let createdOverlay = false;
  if (!(overlay instanceof HTMLElement)) {
    overlay = document.createElement("div");
    createdOverlay = true;
    if (overlayId) overlay.id = overlayId;
    document.body.appendChild(overlay);
  }
  applyModalBackdropClasses(overlay, overlayClassName);
  if (createdOverlay && initiallyHidden && hiddenClass) {
    overlay.classList.add(hiddenClass);
  }

  let panel = dialogId ? document.getElementById(dialogId) : null;
  if (!(panel instanceof HTMLElement)) {
    panel = createDialogPanel(dialogClassName);
    if (dialogId) panel.id = dialogId;
    overlay.appendChild(panel);
  } else if (panel.parentNode !== overlay) {
    overlay.appendChild(panel);
    applyDialogPanelClasses(panel, dialogClassName);
  } else {
    applyDialogPanelClasses(panel, dialogClassName);
  }

  return {
    overlay,
    dialog: panel,
    show() {
      if (hiddenClass) overlay.classList.remove(hiddenClass);
      else overlay.hidden = false;
    },
    hide() {
      if (hiddenClass) overlay.classList.add(hiddenClass);
      else overlay.hidden = true;
    },
    destroy() {
      overlay.remove();
    },
  };
}

/**
 * @template T
 * @param {T | null} closeValue
 * @param {(panel: HTMLElement, settle: (result: T | null) => void) => void} render
 * @returns {Promise<T | null>}
 */
function showModalDialog(closeValue, render) {
  return new Promise((resolve) => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const { dialog, panel } = createNativeDialogShell();

    let settled = false;
    /** @param {T | null} result */
    function settle(result) {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      previousFocus?.focus();
      resolve(result);
    }

    dialog.addEventListener("close", () => settle(closeValue));
    dialog.addEventListener("click", (evt) => {
      if (evt.target === dialog) settle(closeValue);
    });

    render(panel, settle);

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/**
 * @param {ConfirmDialogOptions} options
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog({
  message,
  title,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  variant = "default",
}) {
  return /** @type {Promise<boolean>} */ (
    showModalDialog(false, (dialog, settle) => {
      if (title) {
        const titleElement = document.createElement("div");
        titleElement.className = "wbo-dialog-title";
        titleElement.textContent = title;
        dialog.appendChild(titleElement);
      } else {
        dialog.setAttribute("aria-label", confirmLabel);
      }

      const messageElement = document.createElement("div");
      messageElement.className = "wbo-dialog-message";
      messageElement.textContent = message;
      dialog.appendChild(messageElement);

      const actions = document.createElement("div");
      actions.className = "wbo-dialog-actions";

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "wbo-dialog-button wbo-dialog-button-secondary";
      cancelButton.textContent = cancelLabel;
      cancelButton.addEventListener("click", () => settle(false));

      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className =
        variant === "danger"
          ? "wbo-dialog-button wbo-dialog-button-danger"
          : "wbo-dialog-button wbo-dialog-button-primary";
      confirmButton.textContent = confirmLabel;
      confirmButton.addEventListener("click", () => settle(true));

      actions.appendChild(cancelButton);
      actions.appendChild(confirmButton);
      dialog.appendChild(actions);

      cancelButton.focus();
    })
  );
}

/**
 * @template T
 * @param {ChoiceDialogOptions<T>} options
 * @returns {Promise<T | null>}
 */
export function showChoiceDialog({ message, choices, cancelLabel = "Cancel" }) {
  return showModalDialog(/** @type {T | null} */ (null), (dialog, settle) => {
    const titleElement = document.createElement("div");
    titleElement.className = "wbo-dialog-title";
    titleElement.textContent = message;
    dialog.appendChild(titleElement);

    const choicesContainer = document.createElement("div");
    choicesContainer.className = "wbo-dialog-choices";
    /** @type {HTMLButtonElement[]} */
    const choiceButtons = [];

    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wbo-dialog-button wbo-dialog-choice-button";
      if (choice.variant) {
        button.classList.add(`wbo-dialog-button-${choice.variant}`);
      }
      button.textContent = choice.label;
      button.addEventListener("click", () => settle(choice.value));
      choiceButtons.push(button);
      choicesContainer.appendChild(button);
    }
    dialog.appendChild(choicesContainer);

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className =
      "wbo-dialog-button wbo-dialog-button-secondary wbo-dialog-choice-cancel";
    cancelButton.textContent = cancelLabel;
    cancelButton.addEventListener("click", () => settle(null));
    dialog.appendChild(cancelButton);

    choiceButtons[0]?.focus();
  });
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

  /** @param {ModalShellOptions} [options] */
  createModalShell(options) {
    return createModalShell(options);
  }

  /** @param {ConfirmDialogOptions} options */
  confirm(options) {
    return showConfirmDialog(options);
  }

  /** @template T @param {ChoiceDialogOptions<T>} options */
  showChoiceDialog(options) {
    return showChoiceDialog(options);
  }
}
