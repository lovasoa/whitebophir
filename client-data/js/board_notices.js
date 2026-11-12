/** @import { AppBoardState } from "../../types/app-runtime" */
/** @import { NoticeContent } from "./board_ui_module.js" */

const WELCOME_COOKIE = "wbo_anonymous_welcome_v1";

function welcomeAcknowledged() {
  return document.cookie
    .split(";")
    .some((cookie) => cookie.trim() === `${WELCOME_COOKIE}=dismissed`);
}

function acknowledgeWelcome() {
  // biome-ignore lint/suspicious/noDocumentCookie: One fixed acknowledgement cookie; works without the Cookie Store API.
  document.cookie = `${WELCOME_COOKIE}=dismissed; Max-Age=2592000; Path=/; SameSite=Lax; Secure`;
}

/** Selects board notices and owns their acknowledgement policy, independently of rendering.
 * @param {{boardName: string, i18n: {t(key: string): string}, show: (notice: NoticeContent | null) => void}} options
 */
export function createBoardNotices({ boardName, i18n, show }) {
  const welcome = {
    title: i18n.t("anonymous_welcome_title"),
    paragraphs: [
      i18n.t("anonymous_welcome_rules"),
      i18n.t("anonymous_welcome_safety"),
    ],
    onDismiss: acknowledgeWelcome,
  };
  const unmoderated = {
    title: i18n.t("moderation_unavailable_title"),
    paragraphs: [i18n.t("moderation_unavailable_message")],
  };
  /** @param {AppBoardState} state */
  return (state) => {
    if (state.moderationUnavailable) {
      show(unmoderated);
      return;
    }
    show(boardName === "anonymous" && !welcomeAcknowledged() ? welcome : null);
  };
}
