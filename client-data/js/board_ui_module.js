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
 * @typedef {{
 *   banDurationMs: number,
 *   title: string,
 *   message: string,
 *   acknowledgeLabel: string,
 *   rulesLabel: string,
 *   privateBoardLabel: string,
 *   countdownLabel: string,
 *   countdownDoneLabel: string,
 *   ruleHeading?: string,
 *   ruleTitle?: string,
 *   ruleBody?: string,
 * }} ModerationDisconnectNoticeOptions
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

/** @param {number} remainingMs */
function formatCountdownDuration(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

/**
 * @param {ModerationDisconnectNoticeOptions} options
 * @returns {Promise<void>}
 */
export function showModerationDisconnectNotice(options) {
  return new Promise((resolve) => {
    const shell = createModalShell({
      overlayId: "moderation-disconnect-overlay",
      dialogId: "moderation-disconnect-dialog",
      hiddenClass: "moderation-disconnect-overlay-hidden",
      initiallyHidden: true,
    });
    shell.dialog.replaceChildren();
    shell.dialog.classList.add("moderation-disconnect-dialog");
    shell.dialog.setAttribute("role", "alertdialog");
    shell.dialog.setAttribute("aria-modal", "true");
    shell.dialog.dataset.moderationKind =
      options.banDurationMs > 0 ? "ban" : "warning";

    const icon = document.createElement("div");
    icon.className = "moderation-disconnect-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    const title = document.createElement("div");
    title.className = "moderation-disconnect-title";
    title.id = "moderation-disconnect-title";
    title.textContent = options.title;
    shell.dialog.setAttribute("aria-labelledby", title.id);

    const message = document.createElement("p");
    message.className = "moderation-disconnect-message";
    message.textContent = options.message;

    const ruleCallout = document.createElement("div");
    ruleCallout.className = "moderation-disconnect-rule";
    if (options.ruleTitle) {
      const ruleHeading = document.createElement("div");
      ruleHeading.className = "moderation-disconnect-rule-heading";
      ruleHeading.textContent = options.ruleHeading || "";
      const ruleTitle = document.createElement("div");
      ruleTitle.className = "moderation-disconnect-rule-title";
      ruleTitle.textContent = options.ruleTitle;
      ruleCallout.append(ruleHeading, ruleTitle);
      if (options.ruleBody) {
        const ruleBody = document.createElement("p");
        ruleBody.className = "moderation-disconnect-rule-body";
        ruleBody.textContent = options.ruleBody;
        ruleCallout.appendChild(ruleBody);
      }
    }

    const countdown = document.createElement("p");
    countdown.className = "moderation-disconnect-countdown";
    const banEndsAt = Date.now() + Math.max(0, options.banDurationMs);
    /** @type {ReturnType<typeof setInterval> | null} */
    let countdownInterval = null;
    const updateCountdown = () => {
      const remainingMs = banEndsAt - Date.now();
      countdown.textContent =
        remainingMs > 0
          ? options.countdownLabel.replace(
              "{time}",
              formatCountdownDuration(remainingMs),
            )
          : options.countdownDoneLabel;
      if (remainingMs <= 0 && countdownInterval !== null) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    };
    if (options.banDurationMs > 0) {
      updateCountdown();
      countdownInterval = setInterval(updateCountdown, 1000);
    }

    const rulesLink = document.createElement("a");
    rulesLink.className = "moderation-disconnect-rules";
    rulesLink.href = "../rules";
    rulesLink.target = "_blank";
    rulesLink.rel = "noopener";
    rulesLink.textContent = options.rulesLabel;

    const actions = document.createElement("div");
    actions.className = "moderation-disconnect-actions";

    const privateBoard = document.createElement("a");
    privateBoard.className =
      "wbo-dialog-button wbo-dialog-button-secondary moderation-disconnect-private";
    privateBoard.href = "../random";
    privateBoard.textContent = options.privateBoardLabel;

    const acknowledge = document.createElement("button");
    acknowledge.type = "button";
    acknowledge.className =
      "wbo-dialog-button wbo-dialog-button-primary moderation-disconnect-ack";
    acknowledge.textContent = options.acknowledgeLabel;
    acknowledge.addEventListener(
      "click",
      () => {
        if (countdownInterval !== null) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        shell.hide();
        resolve();
      },
      { once: true },
    );

    actions.append(privateBoard, acknowledge);
    shell.dialog.append(icon, title, message);
    if (options.ruleTitle) shell.dialog.appendChild(ruleCallout);
    if (options.banDurationMs > 0) shell.dialog.appendChild(countdown);
    shell.dialog.append(rulesLink, actions);
    shell.show();
    acknowledge.focus();
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

  /** @param {ModerationDisconnectNoticeOptions} options */
  showModerationDisconnectNotice(options) {
    return showModerationDisconnectNotice(options);
  }
}
