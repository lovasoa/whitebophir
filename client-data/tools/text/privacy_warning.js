import { privateInfoKind } from "./personal_information.js";

/**
 * @param {{t(key: string): string}} i18n
 * @param {HTMLInputElement} input
 */
export function createPrivacyWarning(i18n, input) {
  const panel = document.createElement("aside");
  panel.id = "textPrivacyWarning";
  panel.hidden = true;
  const message = document.createElement("p");
  message.dir = "auto";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  panel.appendChild(message);
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", i18n.t("personal_information_dismiss"));
  // Keep the editor focused (and the mobile keyboard open) on pointer dismissal.
  dismiss.addEventListener("pointerdown", (event) => event.preventDefault());
  let dismissed = false;
  dismiss.addEventListener("click", () => {
    dismissed = true;
    panel.hidden = true;
    message.textContent = "";
    input.focus({ preventScroll: true });
  });
  panel.appendChild(dismiss);
  document.body.appendChild(panel);
  return {
    /** @param {string} text */
    update(text) {
      const detected = privateInfoKind(text) !== null;
      if (!detected) dismissed = false;
      const show = !dismissed && detected;
      if (show === !panel.hidden) return;
      panel.hidden = !show;
      message.textContent = show ? i18n.t("personal_information_warning") : "";
    },
    reset() {
      panel.hidden = true;
      message.textContent = "";
      dismissed = false;
    },
  };
}
