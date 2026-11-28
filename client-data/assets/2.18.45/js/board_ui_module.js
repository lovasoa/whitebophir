import { createUiTemplate } from "./ui_template.js";
import { setUiIconUrl } from "./ui_icon.js";

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

/** @typedef {string | number} ActionDialogValue */
/** @typedef {{label: string, value: ActionDialogValue, iconUrl?: string, variant?: "secondary" | "warning" | "danger"}} ActionDialogChoice */
/** @typedef {{id: string, label?: string, layout: "stacked" | "segmented" | "grid", choices: ActionDialogChoice[], initialValue?: ActionDialogValue, submit?: boolean}} ActionDialogSection */
/** @typedef {{title: string, message?: string, sections: ActionDialogSection[], cancelLabel: string, link?: {label: string, href: string}}} ActionDialogOptions */
/** @typedef {{sectionId: string, value: ActionDialogValue, selections: Record<string, ActionDialogValue>}} ActionDialogResult */

/**
 * @typedef {{
 *   banDurationMs: number,
 *   kind: "ban" | "report" | "warning",
 *   title: string,
 *   message: string,
 *   acknowledgeLabel: string,
 *   rulesLabel: string,
 *   privateBoardLabel: string,
 *   countdownLabel: string,
 *   countdownDoneLabel: string,
 *   countdownUnitPatterns: CountdownUnitPatterns,
 *   ruleHeading?: string,
 *   ruleTitle?: string,
 *   ruleBody?: string,
 *   ruleIconUrl?: string,
 * }} ModerationDisconnectNoticeOptions
 */

/**
 * @typedef {{
 *   day: string,
 *   hour: string,
 *   minute: string,
 *   second: string,
 * }} CountdownUnitPatterns
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
 * @param {string} pattern
 * @param {number | string} count
 */
function formatCountdownUnit(pattern, count) {
  return pattern.replace("{count}", String(count));
}

/**
 * @param {number} remainingMs
 * @param {CountdownUnitPatterns} unitPatterns
 */
export function formatCountdownDuration(remainingMs, unitPatterns) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return [
      formatCountdownUnit(unitPatterns.day, days),
      formatCountdownUnit(unitPatterns.hour, hours),
      formatCountdownUnit(unitPatterns.minute, minutes),
    ].join(" ");
  }
  if (hours > 0) {
    return [
      formatCountdownUnit(unitPatterns.hour, hours),
      formatCountdownUnit(unitPatterns.minute, minutes),
    ].join(" ");
  }
  if (minutes > 0) {
    return [
      formatCountdownUnit(unitPatterns.minute, minutes),
      formatCountdownUnit(
        unitPatterns.second,
        String(seconds).padStart(2, "0"),
      ),
    ].join(" ");
  }
  return formatCountdownUnit(unitPatterns.second, seconds);
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
  const listeners = new AbortController();

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
    element.addEventListener(type, listener, {
      ...listenerOptions,
      signal: listeners.signal,
    });
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
      listeners.abort();
    },
  };
}

const createDialog = /** @type {() => HTMLDialogElement} */ (
  createUiTemplate(`
  <dialog class="wbo-native-dialog"><div class="wbo-dialog"></div></dialog>
`)
);

function createNativeDialogShell() {
  const dialog = createDialog();
  const panel = /** @type {HTMLElement} */ (dialog.firstElementChild);
  panel.dir =
    document.documentElement.dataset.uiDirection === "rtl" ? "rtl" : "ltr";
  return { dialog, panel };
}

const createConfirmation = createUiTemplate(`
  <div>
    <div class="wbo-dialog-title"></div>
    <div class="wbo-dialog-message"></div>
    <div class="wbo-dialog-actions">
      <button type="button" class="wbo-dialog-button wbo-dialog-button-secondary"></button>
      <button type="button" class="wbo-dialog-button wbo-dialog-button-primary"></button>
    </div>
  </div>
`);

const createModerationNotice = createUiTemplate(`
  <div>
    <svg class="moderation-disconnect-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 7.5v5"/>
      <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>
    </svg>
    <div class="moderation-disconnect-title" id="moderation-disconnect-title"></div>
    <p class="moderation-disconnect-message" id="moderation-disconnect-message"></p>
    <div class="moderation-disconnect-rule">
      <svg class="moderation-disconnect-rule-icon" viewBox="0 0 24 24" aria-hidden="true"><use></use></svg>
      <div class="moderation-disconnect-rule-heading"></div>
      <div class="moderation-disconnect-rule-title"></div>
      <p class="moderation-disconnect-rule-body"></p>
    </div>
    <p class="moderation-disconnect-countdown"></p>
    <a class="moderation-disconnect-rules" href="../rules" target="_blank" rel="noopener"></a>
    <div class="moderation-disconnect-actions">
      <a class="wbo-dialog-button wbo-dialog-button-secondary moderation-disconnect-private" href="../random"></a>
      <button type="button" class="wbo-dialog-button wbo-dialog-button-primary moderation-disconnect-ack" autofocus></button>
    </div>
  </div>
`);

const createActionContent = createUiTemplate(`
  <div>
    <div class="moderation-action-title" id="moderation-action-title"></div>
    <p class="moderation-action-message" id="moderation-action-message"></p>
    <div class="moderation-action-footer">
      <a class="moderation-action-rules-link" target="_blank" rel="noopener"></a>
      <button type="button" class="wbo-dialog-button wbo-dialog-button-secondary moderation-action-cancel"></button>
    </div>
  </div>
`);
const createActionChoice = /** @type {() => HTMLButtonElement} */ (
  createUiTemplate(`
  <button type="button">
    <svg class="moderation-action-rule-icon" viewBox="0 0 24 24" aria-hidden="true"><use></use></svg>
    <span></span>
  </button>
`)
);

/**
 * @template T
 * @param {T} closeValue
 * @param {(panel: HTMLElement, settle: (result: T) => void, dialog: HTMLDialogElement) => (() => void) | void} render
 * @param {{dismissOnBackdrop?: boolean, focusOptions?: FocusOptions}} [options]
 * @returns {Promise<T>}
 */
function showModalDialog(closeValue, render, options = {}) {
  return new Promise((resolve) => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const { dialog, panel } = createNativeDialogShell();

    let settled = false;
    /** @type {(() => void) | void} */
    let cleanup;
    /** @param {T} result */
    function settle(result) {
      if (settled) return;
      settled = true;
      cleanup?.();
      dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus(options.focusOptions);
      resolve(result);
    }

    dialog.addEventListener("close", () => settle(closeValue));
    dialog.addEventListener("click", (evt) => {
      if (options.dismissOnBackdrop !== false && evt.target === dialog)
        settle(closeValue);
    });

    cleanup = render(panel, settle, dialog);

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
  return showModalDialog(false, (panel, settle, dialog) => {
    const content = createConfirmation();
    const titleElement = /** @type {HTMLElement} */ (
      content.querySelector(".wbo-dialog-title")
    );
    if (title) titleElement.textContent = title;
    else {
      titleElement.remove();
      dialog.setAttribute("aria-label", confirmLabel);
    }
    if (title) dialog.setAttribute("aria-label", title);
    /** @type {HTMLElement} */ (
      content.querySelector(".wbo-dialog-message")
    ).textContent = message;
    const [cancelButton, confirmButton] =
      /** @type {[HTMLButtonElement, HTMLButtonElement]} */ ([
        ...content.querySelectorAll("button"),
      ]);
    cancelButton.textContent = cancelLabel;
    confirmButton.textContent = confirmLabel;
    if (variant === "danger")
      confirmButton.className = "wbo-dialog-button wbo-dialog-button-danger";
    cancelButton.addEventListener("click", () => settle(false));
    confirmButton.addEventListener("click", () => settle(true));
    panel.append(...content.children);
    cancelButton.focus();
  });
}

/** @param {ActionDialogOptions} options @returns {Promise<ActionDialogResult | null>} */
export function showActionDialog(options) {
  return showModalDialog(
    /** @type {ActionDialogResult | null} */ (null),
    (panel, settle, dialog) => {
      panel.classList.add("moderation-action-dialog");
      const content = createActionContent();
      const title = /** @type {HTMLElement} */ (
        content.querySelector(".moderation-action-title")
      );
      title.textContent = options.title;
      dialog.setAttribute("aria-labelledby", title.id);
      const message = /** @type {HTMLElement} */ (
        content.querySelector(".moderation-action-message")
      );
      if (options.message) {
        message.textContent = options.message;
        dialog.setAttribute("aria-describedby", message.id);
      } else message.remove();
      const footer = /** @type {HTMLElement} */ (
        content.querySelector(".moderation-action-footer")
      );
      const link = /** @type {HTMLAnchorElement} */ (footer.querySelector("a"));
      if (options.link) {
        link.href = options.link.href;
        link.textContent = options.link.label;
      } else link.remove();
      const cancel = /** @type {HTMLButtonElement} */ (
        footer.querySelector("button")
      );
      cancel.textContent = options.cancelLabel;
      cancel.addEventListener("click", () => settle(null));
      panel.append(...content.children);
      /** @type {Record<string, ActionDialogValue>} */
      const selections = {};
      /** @type {HTMLButtonElement[]} */
      const allButtons = [];
      for (const section of options.sections) {
        if (section.label) {
          const heading = document.createElement("div");
          heading.className = "moderation-action-section-title";
          heading.textContent = section.label;
          panel.insertBefore(heading, footer);
        }
        const choices = document.createElement("div");
        choices.className = `moderation-action-${section.layout}`;
        choices.setAttribute("role", "group");
        if (section.label) choices.setAttribute("aria-label", section.label);
        const buttons = section.choices.map((choice) => {
          const button = createActionChoice();
          button.className =
            section.layout === "grid"
              ? "moderation-action-rule"
              : "wbo-dialog-button moderation-action-choice";
          if (section.layout === "segmented")
            button.classList.add("moderation-action-duration");
          if (choice.variant)
            button.classList.add(`wbo-dialog-button-${choice.variant}`);
          const icon = /** @type {SVGSVGElement} */ (
            button.querySelector("svg")
          );
          if (choice.iconUrl) setUiIconUrl(icon, choice.iconUrl);
          else icon.remove();
          const label = /** @type {HTMLElement} */ (
            button.querySelector("span")
          );
          label.className =
            section.layout === "grid"
              ? "moderation-action-rule-label"
              : "moderation-action-choice-label";
          label.textContent = choice.label;
          button.addEventListener("click", () => {
            if (section.submit) {
              settle({
                sectionId: section.id,
                value: choice.value,
                selections: { ...selections },
              });
              return;
            }
            selections[section.id] = choice.value;
            buttons.forEach((entry, index) => {
              const selected = section.choices[index]?.value === choice.value;
              entry.setAttribute("aria-pressed", String(selected));
              entry.classList.toggle(
                "moderation-action-choice-selected",
                selected,
              );
            });
          });
          allButtons.push(button);
          choices.appendChild(button);
          return button;
        });
        if (section.initialValue !== undefined) {
          selections[section.id] = section.initialValue;
          const selectedIndex = section.choices.findIndex(
            (choice) => choice.value === section.initialValue,
          );
          buttons[selectedIndex]?.click();
        }
        panel.insertBefore(choices, footer);
      }

      allButtons[0]?.focus();
    },
  );
}

/**
 * @param {ModerationDisconnectNoticeOptions} options
 * @returns {Promise<void>}
 */
export function showModerationDisconnectNotice(options) {
  return showModalDialog(
    undefined,
    (panel, settle, dialog) => {
      dialog.id = "moderation-disconnect-overlay";
      panel.id = "moderation-disconnect-dialog";
      panel.classList.add("moderation-disconnect-dialog");
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-modal", "true");
      panel.dataset.moderationKind = options.kind;

      const content = createModerationNotice();
      const text = (
        /** @type {string} */ selector,
        /** @type {string} */ value,
      ) => {
        const element = /** @type {HTMLElement} */ (
          content.querySelector(selector)
        );
        element.textContent = value;
        return element;
      };
      text(".moderation-disconnect-title", options.title);
      text(".moderation-disconnect-message", options.message);
      dialog.setAttribute("aria-labelledby", "moderation-disconnect-title");
      dialog.setAttribute("aria-describedby", "moderation-disconnect-message");
      const ruleCallout = /** @type {HTMLElement} */ (
        content.querySelector(".moderation-disconnect-rule")
      );
      if (options.ruleTitle) {
        const ruleIcon = /** @type {SVGSVGElement} */ (
          content.querySelector(".moderation-disconnect-rule-icon")
        );
        if (options.ruleIconUrl) setUiIconUrl(ruleIcon, options.ruleIconUrl);
        else ruleIcon.remove();
        text(".moderation-disconnect-rule-heading", options.ruleHeading || "");
        text(".moderation-disconnect-rule-title", options.ruleTitle);
        const body = text(
          ".moderation-disconnect-rule-body",
          options.ruleBody || "",
        );
        if (!options.ruleBody) body.remove();
      } else ruleCallout.remove();
      const countdown = /** @type {HTMLElement} */ (
        content.querySelector(".moderation-disconnect-countdown")
      );
      if (!(options.banDurationMs > 0)) countdown.remove();
      const banEndsAt = Date.now() + Math.max(0, options.banDurationMs);
      /** @type {ReturnType<typeof setInterval> | null} */
      let countdownInterval = null;
      const updateCountdown = () => {
        const remainingMs = banEndsAt - Date.now();
        countdown.textContent =
          remainingMs > 0
            ? options.countdownLabel.replace(
                "{time}",
                formatCountdownDuration(
                  remainingMs,
                  options.countdownUnitPatterns,
                ),
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

      const rulesLink = text(
        ".moderation-disconnect-rules",
        options.rulesLabel,
      );
      text(".moderation-disconnect-private", options.privateBoardLabel);
      const acknowledge = text(
        ".moderation-disconnect-ack",
        options.acknowledgeLabel,
      );
      acknowledge.addEventListener("click", () => settle(undefined), {
        once: true,
      });
      // Keep Tab on the notice's actions instead of entering browser chrome.
      panel.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        const endpoint = event.shiftKey ? rulesLink : acknowledge;
        if (document.activeElement !== endpoint) return;
        event.preventDefault();
        (event.shiftKey ? acknowledge : rulesLink).focus();
      });

      panel.append(...content.children);
      return () => {
        if (countdownInterval !== null) clearInterval(countdownInterval);
      };
    },
    { dismissOnBackdrop: false, focusOptions: { preventScroll: true } },
  );
}

/** @typedef {{title: string, paragraphs: string[], primaryAction?: {label: string, href: string}, onDismiss?: () => void}} NoticeContent */
/** @typedef {{panel: HTMLElement, title: HTMLElement, body: HTMLElement, primaryAction: HTMLAnchorElement, dismissButton: HTMLElement, restoreFocusElement: HTMLElement}} NoticePanelOptions */

/** Renders one notice at a time. Content and acknowledgement policies belong to callers.
 * @param {NoticePanelOptions} elements
 */
export function createNoticePanel(elements) {
  /** @type {NoticeContent | null} */
  let current = null;
  let dismissed = false;
  elements.dismissButton.addEventListener("click", () => {
    if (!current) return;
    dismissed = true;
    elements.panel.hidden = true;
    current.onDismiss?.();
    elements.restoreFocusElement.focus();
  });
  return {
    /** @param {NoticeContent | null} notice */
    show(notice) {
      if (notice !== current) {
        current = notice;
        dismissed = false;
        if (notice) {
          elements.title.textContent = notice.title;
          elements.primaryAction.hidden = !notice.primaryAction;
          elements.primaryAction.textContent =
            notice.primaryAction?.label ?? "";
          if (notice.primaryAction) {
            elements.primaryAction.setAttribute(
              "href",
              notice.primaryAction.href,
            );
          } else {
            elements.primaryAction.removeAttribute("href");
          }
          elements.body.replaceChildren(
            ...notice.paragraphs.map((text) => {
              const paragraph = document.createElement("p");
              paragraph.textContent = text;
              return paragraph;
            }),
          );
        }
      }
      elements.panel.hidden = !notice || dismissed;
    },
  };
}

export const ui = {
  createNoticePanel,
  positionAnchoredPanel,
  createFloatingPanelController,
  confirm: showConfirmDialog,
  showActionDialog,
  showModerationDisconnectNotice,
};
