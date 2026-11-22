import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { FriendStore } from "./board_friend_store.js";
import { getRequiredElement } from "./board_page_state.js";
import { VIEWPORT_HASH_SCALE_DECIMALS } from "./board_viewport.js";
import { getMessageActivityPoint } from "./message_activity_point.js";
import MessageCommon from "./message_common.js";
import { LIMITS } from "./message_limits.js";
import {
  getModerationRule,
  MODERATION_DURATION_OPTIONS,
  MODERATION_RULES,
} from "./moderation_rules.js";
import { SocketEvents } from "./socket_events.js";
import { createToolIconBadge, updateToolIconBadge } from "./tool_icon_badge.js";
import { createUiTemplate } from "./ui_template.js";

const connectedUserRowTemplate = createUiTemplate(`
  <li class="connected-user-row">
    <span class="connected-user-visual"></span>
    <div class="connected-user-main">
      <a class="connected-user-main-link">
        <div class="connected-user-name"><bdi class="connected-user-name-text" dir="auto"></bdi></div>
        <span class="connected-user-meta"><span class="connected-user-time"></span></span>
      </a>
    </div>
    <span class="connected-user-actions">
      <button type="button" class="connected-user-action connected-user-friend">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20 4.8 13a4.6 4.6 0 0 1 6.5-6.5l.7.7.7-.7a4.6 4.6 0 1 1 6.5 6.5Z"/>
        </svg>
      </button>
      <button type="button" class="connected-user-action connected-user-report">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path class="connected-user-report-flag" d="M5 21V4h7l1.5 2H20v10h-7l-1.5-2H5"/>
          <path class="connected-user-report-check" d="m5 12 4 4 10-9"/>
        </svg>
      </button>
    </span>
  </li>
`);
const activeBanRowTemplate = createUiTemplate(`
  <li class="active-ban-row">
    <div>
      <bdi class="active-ban-name" dir="auto"></bdi>
      <time class="active-ban-meta"></time>
      <span class="active-ban-meta"></span>
    </div>
    <button type="button" class="active-ban-unban"></button>
  </li>
`);

/** @import { ActiveBan, AppToolsState, BoardMessage, ConnectedUser, ConnectedUserMap } from "../../types/app-runtime" */
/** @typedef {{
 * element: HTMLLIElement, link: HTMLAnchorElement,
 * toolIcon: HTMLImageElement, toolBadge: HTMLSpanElement,
 * name: HTMLElement, friend: HTMLButtonElement,
 * meta: HTMLElement, joinedTime: HTMLElement, report: HTMLButtonElement,
 * }} ConnectedUserRow */
/** @typedef {"minute" | "hour" | "day"} ConnectedUserDurationUnit */
/** @typedef {{kind: "now"} | {kind: "duration", count: number, unit: ConnectedUserDurationUnit, shortKey: string}} ConnectedUserRelativeTime */

export class PresenceModule {
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
    this.users = /** @type {ConnectedUserMap} */ (new Map());
    this.rows = /** @type {Map<string, ConnectedUserRow>} */ (new Map());
    this.friendStore = new FriendStore();
    this.friendStorageBound = false;
    this.bans = /** @type {ActiveBan[]} */ ([]);
    this.renderedBans = /** @type {ActiveBan[] | null} */ (null);
    this.renderedCanUnban = false;
    this.panelOpen = false;
    this.renderScheduled = false;
    this.scheduleActivityRender = () => this.schedulePresenceRender(false);
    /** @type {number | null} */
    this.staleTickId = null;
  }

  clearConnectedUsers() {
    this.bans = [];
    Array.from(this.users.values()).forEach((user) => {
      clearConnectedUserTimers(user);
    });
    if (this.staleTickId) {
      clearTimeout(this.staleTickId);
      this.staleTickId = null;
    }
    this.users = /** @type {ConnectedUserMap} */ (new Map());
    if (this.panelOpen) this.renderConnectedUsers();
    else syncConnectedUsersSummary(this);
  }

  /** @param {boolean} [syncSummaryWhenClosed] */
  schedulePresenceRender(syncSummaryWhenClosed = true) {
    if (!this.panelOpen) {
      if (syncSummaryWhenClosed) syncConnectedUsersSummary(this);
      return;
    }
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    const schedule = window.requestAnimationFrame || window.setTimeout;
    schedule(() => {
      this.renderScheduled = false;
      if (this.panelOpen) this.renderConnectedUsers();
    });
  }

  renderConnectedUsers() {
    const Tools = this.getTools();
    const list = getConnectedUsersList();
    const focusedListControl =
      document.activeElement instanceof HTMLElement &&
      list.contains(document.activeElement)
        ? document.activeElement
        : null;
    const currentSocketId = Tools.connection.socket?.id;
    const visibleUsers = getVisibleConnectedUsers(this.users, currentSocketId);
    for (const [identity, row] of this.rows) {
      if (visibleUsers.has(identity)) continue;
      row.element.remove();
      this.rows.delete(identity);
    }
    const users = Array.from(visibleUsers).sort(([, left], [, right]) =>
      compareConnectedUsersForDisplay(currentSocketId, left, right),
    );

    users.forEach(([identity, user], index) => {
      const row =
        this.rows.get(identity) || createConnectedUserRow(this.getTools, this);
      this.rows.set(identity, row);
      updateConnectedUserRow(Tools, row, user);
      const currentChild = list.children[index];
      if (currentChild !== row.element)
        list.insertBefore(row.element, currentChild || null);
    });
    if (
      focusedListControl?.isConnected &&
      document.activeElement !== focusedListControl
    ) {
      focusedListControl.focus({ preventScroll: true });
    }
    this.renderActiveBans();
    syncConnectedUsersSummary(this, visibleUsers.size, Tools);
    schedulePresenceStaleTick(this);
  }

  /** @param {ActiveBan[]} bans */
  setActiveBans(bans) {
    this.bans = bans;
    this.schedulePresenceRender();
  }

  renderActiveBans() {
    const Tools = this.getTools();
    const canUnban = Tools.access.canUnban === true;
    if (this.renderedBans === this.bans && this.renderedCanUnban === canUnban)
      return;
    this.renderedBans = this.bans;
    this.renderedCanUnban = canUnban;
    const details = /** @type {HTMLDetailsElement | null} */ (
      document.getElementById("activeBansSection")
    );
    // Older cached HTML has no active-bans panel; its absence must not block boot.
    if (!details) return;
    details.hidden = this.bans.length === 0;
    if (details.hidden) details.open = false;
    getRequiredElement("activeBansSummary").textContent = Tools.i18n.format(
      "active_bans_count",
      { count: String(this.bans.length) },
    );
    const list = getRequiredElement("activeBansList");
    list.replaceChildren();
    for (const ban of this.bans) {
      const row = activeBanRowTemplate();
      const name = row.querySelector("bdi");
      const time = row.querySelector("time");
      const reason = row.querySelector("span");
      const unban = row.querySelector("button");
      if (!name || !time || !reason || !unban)
        throw new Error("Invalid active ban row template.");
      name.textContent = ban.name;
      const date = new Date(ban.bannedAt);
      time.dateTime = date.toISOString();
      time.textContent = Tools.i18n.format("banned_at", {
        time: date.toLocaleString(document.documentElement.lang || undefined, {
          dateStyle: "short",
          timeStyle: "short",
        }),
      });
      const rule = getModerationRule(ban.moderationRule);
      reason.textContent = Tools.i18n.t(
        rule ? rule.titleKey : "ban_reason_unspecified",
      );
      if (canUnban) {
        unban.textContent = Tools.i18n.t("unban");
        unban.setAttribute(
          "aria-label",
          Tools.i18n.format("unban_user", { name: ban.name }),
        );
        unban.addEventListener("click", () => {
          const currentTools = this.getTools();
          if (currentTools.access.canUnban !== true) return;
          currentTools.connection.socket?.emit(SocketEvents.UNBAN_USER, {
            banId: ban.id,
          });
        });
      } else unban.remove();
      list.appendChild(row);
    }
  }

  /** @param {boolean} open */
  setConnectedUsersPanelOpen(open) {
    const shouldOpen = open && (this.users.size > 0 || this.bans.length > 0);
    const panel = getConnectedUsersPanel();
    const toggle = getConnectedUsersToggle();
    this.panelOpen = shouldOpen;
    panel.classList.toggle("connected-users-panel-hidden", !shouldOpen);
    toggle.classList.toggle("board-presence-toggle-open", shouldOpen);
    toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    if (shouldOpen) this.renderConnectedUsers();
  }

  /** @param {ConnectedUser} user */
  upsertConnectedUser(user) {
    const previous = this.users.get(user.socketId);
    const joinedAt = previous?.joinedAt || user.joinedAt || Date.now();
    this.users.set(
      user.socketId,
      Object.assign({}, previous || {}, user, {
        joinedAt,
        disconnectedAt: 0,
        friend: this.friendStore.has(user.userId),
      }),
    );
    this.syncFriendStates();
    this.schedulePresenceRender();
  }

  /** @param {string} userId */
  toggleFriend(userId) {
    this.friendStore.toggle(userId);
    this.syncFriendStates();
  }

  syncFriendStates() {
    let changed = false;
    const currentUserId = this.users.get(
      this.getTools().connection.socket?.id || "",
    )?.userId;
    this.users.forEach((user) => {
      const friend =
        user.userId !== currentUserId && this.friendStore.has(user.userId);
      if (user.friend === friend) return;
      user.friend = friend;
      changed = true;
    });
    if (changed) {
      const Tools = this.getTools();
      Tools.toolRegistry.notifyPresenceDisplayChange();
      this.schedulePresenceRender(false);
    }
  }

  /** @param {string} socketId */
  removeConnectedUser(socketId) {
    const user = this.users.get(socketId);
    if (!user || user.disconnectedAt) return;
    clearConnectedUserTimers(user);
    user.disconnectedAt = Date.now();
    user.removeTimeoutId = window.setTimeout(() => {
      const current = this.users.get(socketId);
      if (current && current.disconnectedAt) {
        this.users.delete(socketId);
        this.schedulePresenceRender();
      }
    }, 3500);
    this.schedulePresenceRender();
  }

  /**
   * @param {string | undefined} userId
   * @param {BoardMessage} message
   * @param {string | undefined} [socketId]
   */
  updateConnectedUsersFromActivity(userId, message, socketId = message.socket) {
    // A socket identifies one tab; userId may match multiple tabs. Live traffic
    // always carries a socket ID, so it must not scan every connected user.
    if (!userId && !socketId) return;
    const focusPoint = getMessageFocusPoint(message);
    let changed = false;
    if (socketId) {
      const user = this.users.get(socketId);
      if (user)
        changed = applyConnectedUserActivity(
          user,
          message,
          focusPoint,
          this.scheduleActivityRender,
        );
    } else {
      for (const user of this.users.values()) {
        if (user.userId !== userId) continue;
        changed =
          applyConnectedUserActivity(
            user,
            message,
            focusPoint,
            this.scheduleActivityRender,
          ) || changed;
      }
    }
    if (changed) this.scheduleActivityRender();
  }

  /** @param {BoardMessage} message */
  updateCurrentConnectedUserFromActivity(message) {
    const socketId = this.getTools().connection.socket?.id;
    if (socketId)
      this.updateConnectedUsersFromActivity(undefined, message, socketId);
  }

  initConnectedUsersUI() {
    const Tools = this.getTools();
    const toggle = document.getElementById("connectedUsersToggle");
    const panel = document.getElementById("connectedUsersPanel");
    if (!(toggle instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      return;
    }
    this.panelOpen = toggle.getAttribute("aria-expanded") === "true";
    syncConnectedUsersSummary(this);
    if (!this.friendStorageBound) {
      this.friendStorageBound = true;
      this.friendStore.subscribe(() => this.syncFriendStates());
    }
    if (toggle.dataset.connectedUsersUiBound !== "true") {
      toggle.dataset.connectedUsersUiBound = "true";
      const panelController = Tools.ui.createFloatingPanelController({
        panel,
        isOpen: () => this.panelOpen,
        open: () => this.setConnectedUsersPanelOpen(true),
        close: () => this.setConnectedUsersPanelOpen(false),
        closeOnBlurFrom: toggle,
        restoreFocusElement: toggle,
      });
      toggle.addEventListener("click", () => {
        panelController.toggle();
      });
    }
    this.renderConnectedUsers();
  }
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUser} user
 */
function isCurrentSocketUser(Tools, user) {
  return !!(
    Tools.connection.socket?.id && user.socketId === Tools.connection.socket.id
  );
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUserMap} users
 * @param {ConnectedUser} user
 * @returns {boolean}
 */
function isCurrentIdentityUser(Tools, users, user) {
  const currentSocketId = Tools.connection.socket?.id;
  if (!currentSocketId) return false;
  const currentUser = users.get(currentSocketId);
  return !!currentUser && currentUser.userId === user.userId;
}

/**
 * @param {string | undefined} currentSocketId
 * @param {ConnectedUser} left
 * @param {ConnectedUser} right
 * @returns {number}
 */
export function compareConnectedUsersForDisplay(currentSocketId, left, right) {
  const leftIsSelf = !!currentSocketId && left.socketId === currentSocketId;
  const rightIsSelf = !!currentSocketId && right.socketId === currentSocketId;
  if (leftIsSelf !== rightIsSelf) return leftIsSelf ? -1 : 1;
  const leftIsFriend = left.friend === true;
  const rightIsFriend = right.friend === true;
  if (leftIsFriend !== rightIsFriend) return leftIsFriend ? -1 : 1;
  return (
    left.name.localeCompare(right.name) ||
    left.userId.localeCompare(right.userId)
  );
}

function getConnectedUsersToggle() {
  return getRequiredElement("connectedUsersToggle");
}

function getConnectedUsersPanel() {
  return getRequiredElement("connectedUsersPanel");
}

function getConnectedUsersList() {
  return getRequiredElement("connectedUsersList");
}

/**
 * @param {ConnectedUserMap} users
 * @param {string | undefined} [currentSocketId]
 */
function getVisibleConnectedUsers(users, currentSocketId) {
  const visible = /** @type {Map<string, ConnectedUser>} */ (new Map());
  for (const user of users.values()) {
    const identity = `${user.userId}\0${user.name}`;
    const current = visible.get(identity);
    if (current && !preferVisibleSocket(user, current, currentSocketId))
      continue;
    visible.set(identity, user);
  }
  return visible;
}

/**
 * @param {ConnectedUser} user
 * @param {ConnectedUser} current
 * @param {string | undefined} currentSocketId
 */
function preferVisibleSocket(user, current, currentSocketId) {
  if (user.socketId === currentSocketId) return true;
  if (current.socketId === currentSocketId) return false;
  if (!!user.disconnectedAt !== !!current.disconnectedAt)
    return !user.disconnectedAt;
  return (
    (user.disconnectedAt || user.lastActivityAt || user.joinedAt || 0) >
    (current.disconnectedAt || current.lastActivityAt || current.joinedAt || 0)
  );
}

/**
 * @param {AppToolsState} Tools
 * @param {number} userCount
 */
function syncConnectedUsersToggleLabel(Tools, userCount) {
  const toggle = getConnectedUsersToggle();
  const accessibleLabel = Tools.i18n.format("users_count", {
    count: String(userCount),
  });
  if (toggle.getAttribute("aria-label") === accessibleLabel) return;
  toggle.setAttribute("aria-label", accessibleLabel);
  toggle.title = accessibleLabel;
  const label = toggle.querySelector(".tool-name");
  if (!(label instanceof HTMLElement)) return;
  if (userCount <= 1) {
    label.hidden = true;
    label.textContent = "";
    delete label.dataset.badgeSize;
    return;
  }
  const badgeText = userCount > 99 ? "99+" : String(userCount);
  label.hidden = false;
  label.textContent = badgeText;
  label.dataset.badgeSize =
    badgeText.length === 1
      ? "single"
      : badgeText.length === 2
        ? "double"
        : "capped";
}

/**
 * @param {PresenceModule} presence
 * @param {number} [userCount]
 * @param {AppToolsState} [Tools]
 */
function syncConnectedUsersSummary(
  presence,
  userCount = getVisibleConnectedUsers(presence.users).size,
  Tools = presence.getTools(),
) {
  const panel = getConnectedUsersPanel();
  const empty = userCount === 0 && presence.bans.length === 0;
  panel.dataset.empty = empty ? "true" : "false";
  if (empty && presence.panelOpen) {
    presence.setConnectedUsersPanelOpen(false);
  }
  syncConnectedUsersToggleLabel(Tools, userCount);
}

const CONNECTED_USER_RING_MIN_WIDTH = 2;
const CONNECTED_USER_RING_MAX_WIDTH = 6;

/**
 * @param {number | undefined} size
 * @returns {number}
 */
function getConnectedUserRingWidth(size) {
  const userSize = Number(size);
  if (!Number.isFinite(userSize) || userSize <= 0) {
    return CONNECTED_USER_RING_MIN_WIDTH;
  }
  const range = LIMITS.MAX_SIZE - LIMITS.MIN_SIZE || 1;
  const fraction = Math.max(
    0,
    Math.min(1, (userSize - LIMITS.MIN_SIZE) / range),
  );
  return (
    CONNECTED_USER_RING_MIN_WIDTH +
    fraction * (CONNECTED_USER_RING_MAX_WIDTH - CONNECTED_USER_RING_MIN_WIDTH)
  );
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUser} user
 * @returns {string}
 */
function getConnectedUserToolLabel(Tools, user) {
  return Tools.i18n.t(user.lastTool || "hand");
}

const CONNECTED_USER_STALE_MS = 5 * 60 * 1000;
const CONNECTED_USER_TIME_TICK_MS = 30 * 1000;
const DURATION_UNIT_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};
/** @param {AppToolsState} Tools */
function getModerationDurationOptions(Tools) {
  return MODERATION_DURATION_OPTIONS.map((option) => ({
    label:
      "labelKey" in option
        ? Tools.i18n.t(option.labelKey)
        : formatShortRelativeTime(
            Tools,
            getDurationPartState(option.count, option.unit),
          ),
    durationMs: option.durationMs,
    variant: option.variant,
  }));
}

/** @param {ConnectedUser} user */
function clearConnectedUserTimers(user) {
  if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  if (user.removeTimeoutId) clearTimeout(user.removeTimeoutId);
  user.pulseTimeoutId = null;
  user.removeTimeoutId = null;
}

/**
 * @param {number} count
 * @param {ConnectedUserDurationUnit} unit
 * @returns {Extract<ConnectedUserRelativeTime, {kind: "duration"}>}
 */
function getDurationPartState(count, unit) {
  return {
    kind: "duration",
    count,
    unit,
    shortKey: `relative_${unit}s_short`,
  };
}

/**
 * @param {number} durationMs
 * @returns {ConnectedUserRelativeTime}
 */
function getDurationTimeState(durationMs) {
  const minutes = Math.floor(Math.max(0, durationMs) / DURATION_UNIT_MS.minute);
  if (minutes < 1) return { kind: "now" };
  if (minutes < 60) return getDurationPartState(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return getDurationPartState(hours, "hour");
  return getDurationPartState(Math.floor(hours / 24), "day");
}

/**
 * @param {number | undefined} timestamp
 * @returns {ConnectedUserRelativeTime}
 */
function getRelativeTimeState(timestamp) {
  const elapsedMs = Math.max(0, Date.now() - (timestamp || Date.now()));
  return getDurationTimeState(elapsedMs);
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUserRelativeTime} relativeTime
 * @returns {string}
 */
function formatShortRelativeTime(Tools, relativeTime) {
  if (relativeTime.kind === "now") return Tools.i18n.t("connected_user_now");
  return Tools.i18n.format(relativeTime.shortKey, {
    count: `${relativeTime.count}`,
  });
}

/**
 * @param {AppToolsState} Tools
 * @param {Extract<ConnectedUserRelativeTime, {kind: "duration"}>} relativeTime
 * @returns {string}
 */
function formatLongRelativeTime(Tools, relativeTime) {
  try {
    return new Intl.RelativeTimeFormat(
      document.documentElement.lang || undefined,
      {
        numeric: "always",
        style: "long",
      },
    ).format(-relativeTime.count, relativeTime.unit);
  } catch {
    return formatShortRelativeTime(Tools, relativeTime);
  }
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUserRelativeTime} relativeTime
 * @returns {string}
 */
function formatJoinedTimeTitle(Tools, relativeTime) {
  if (relativeTime.kind === "now")
    return Tools.i18n.t("connected_user_joined_now_title");
  return Tools.i18n.format("connected_user_joined_title", {
    relative_time: formatLongRelativeTime(Tools, relativeTime),
  });
}

/** @param {PresenceModule} presence */
function schedulePresenceStaleTick(presence) {
  if (presence.staleTickId || !presence.panelOpen || presence.users.size === 0)
    return;
  presence.staleTickId = window.setTimeout(() => {
    presence.staleTickId = null;
    presence.schedulePresenceRender(false);
  }, CONNECTED_USER_TIME_TICK_MS);
}

/**
 * @param {ConnectedUser} user
 * @returns {string}
 */
export function getConnectedUserDisplayName(user) {
  const markers = [];
  if (user.friend === true) markers.push("\u2764\uFE0F");
  if (user.canBan === true) markers.push("\u{1F338}");
  return markers.length > 0 ? `${markers.join(" ")} ${user.name}` : user.name;
}

/**
 * @param {ConnectedUser} user
 * @returns {boolean}
 */
function hasConnectedUserFocus(user) {
  return Number.isFinite(user.position?.x) && Number.isFinite(user.position?.y);
}

/**
 * @param {{minX: number, minY: number, maxX: number, maxY: number} | null} bounds
 * @returns {{x: number, y: number} | null}
 */
function getBoundsCenter(bounds) {
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/** Presence follows reported pointer/content coordinates. Transform-only
 * messages retain the user's last position: measuring SVG geometry here would
 * interleave layout reads with every live drawing write, even with the panel
 * closed. Selection geometry belongs to the hand tool.
 * @param {BoardMessage} message
 */
function getMessageFocusPoint(message) {
  if ("_children" in message) return null;
  return (
    getMessageActivityPoint(message) ||
    getBoundsCenter(MessageCommon.getEffectiveGeometryBounds(message))
  );
}

/**
 * @param {ConnectedUser} user
 * @param {() => void} scheduleActivityRender
 * @returns {void}
 */
function scheduleConnectedUserPulseEnd(user, scheduleActivityRender) {
  if (user.pulseTimeoutId) return;
  if (!user.pulseUntil) {
    user.pulseTimeoutId = null;
    return;
  }
  const checkPulseEnd = () => {
    const remainingMs = Math.max(0, (user.pulseUntil || 0) - Date.now());
    if (remainingMs > 0) {
      user.pulseTimeoutId = window.setTimeout(checkPulseEnd, remainingMs + 20);
      return;
    }
    if (user.pulseUntil) {
      user.pulseUntil = 0;
      user.pulseTimeoutId = null;
      scheduleActivityRender();
    }
  };
  user.pulseTimeoutId = window.setTimeout(
    checkPulseEnd,
    Math.max(0, user.pulseUntil - Date.now()) + 20,
  );
}

/**
 * @param {ConnectedUser} user
 * @param {() => void} scheduleActivityRender
 * @returns {boolean}
 */
function markConnectedUserActivity(user, scheduleActivityRender) {
  const now = Date.now();
  const wasActive = !!(user.pulseUntil && user.pulseUntil > now);
  user.lastActivityAt = now;
  user.pulseMs = 700;
  user.pulseUntil = now + user.pulseMs;
  scheduleConnectedUserPulseEnd(user, scheduleActivityRender);
  return !wasActive;
}

/**
 * @param {ConnectedUser} user
 * @returns {boolean}
 */
function markConnectedUserIdleActivity(user) {
  const now = Date.now();
  const wasInactive =
    now - (user.lastActivityAt || user.joinedAt || now) >
    CONNECTED_USER_STALE_MS;
  user.lastActivityAt = now;
  return wasInactive;
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUser} user
 * @returns {string}
 */
function getConnectedUserFocusHash(Tools, user) {
  if (!hasConnectedUserFocus(user)) return "";
  const scale = Tools.viewportState.controller.getScale();
  const x = user.position.x;
  const y = user.position.y;
  return `#${Math.max(0, (x - window.innerWidth / (2 * scale)) | 0)},${Math.max(
    0,
    (y - window.innerHeight / (2 * scale)) | 0,
  )},${scale.toFixed(VIEWPORT_HASH_SCALE_DECIMALS)}`;
}

/**
 * @param {AppToolsState} Tools
 * @param {string} name
 * @returns {string}
 */
function getReportActionLabel(Tools, name) {
  return Tools.i18n.format(
    Tools.access.canBan === true ? "ban_user" : "report_user",
    { name },
  );
}

/** @returns {boolean} */
function hasCoarsePointer() {
  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches) ||
    navigator.maxTouchPoints > 0
  );
}

/** @param {HTMLLIElement} row */
function revealTouchConnectedUserRow(row) {
  if (!hasCoarsePointer()) return;
  const list = row.parentElement;
  if (!list) return;
  list
    .querySelectorAll(".connected-user-row-touch-revealed")
    .forEach((revealedRow) => {
      if (revealedRow !== row) {
        revealedRow.classList.remove("connected-user-row-touch-revealed");
      }
    });
  row.classList.add("connected-user-row-touch-revealed");
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUserRow} view
 * @param {ConnectedUser} user
 * @returns {void}
 */
function updateConnectedUserRow(Tools, view, user) {
  const {
    element: row,
    link,
    toolIcon,
    toolBadge,
    name,
    friend,
    meta,
    joinedTime,
    report,
  } = view;
  row.dataset.socketId = user.socketId;
  row.dataset.userId = user.userId;
  row.classList.toggle(
    "connected-user-row-self",
    isCurrentSocketUser(Tools, user),
  );
  const now = Date.now();
  const inactive =
    now - (user.lastActivityAt || user.joinedAt || now) >
    CONNECTED_USER_STALE_MS;
  row.classList.toggle(
    "connected-user-row-inactive",
    inactive && !user.disconnectedAt,
  );
  row.classList.toggle(
    "connected-user-row-disconnected",
    !!user.disconnectedAt,
  );

  const focusHash = getConnectedUserFocusHash(Tools, user);
  row.classList.toggle("connected-user-row-jumpable", focusHash !== "");

  if (focusHash) {
    link.setAttribute("href", focusHash);
    link.removeAttribute("aria-disabled");
    link.tabIndex = 0;
  } else {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.tabIndex = -1;
  }

  updateToolIconBadge(
    toolIcon,
    user.lastTool || "hand",
    getConnectedUserToolLabel(Tools, user),
  );

  const userColor = user.color || "#001f3f";
  toolBadge.style.borderColor = userColor;
  toolBadge.style.setProperty("--connected-user-pulse-color", userColor);
  toolBadge.style.borderWidth = `${getConnectedUserRingWidth(user.size)}px`;
  if (!user.disconnectedAt && user.pulseUntil && user.pulseUntil > now) {
    toolBadge.classList.add("active");
    toolBadge.style.setProperty("--pulse-ms", `${user.pulseMs || 700}ms`);
  } else {
    toolBadge.classList.remove("active");
    toolBadge.style.removeProperty("--pulse-ms");
  }

  const displayName = getConnectedUserDisplayName(user);
  if (name.textContent !== displayName) name.textContent = displayName;

  const currentIdentityUser = isCurrentIdentityUser(
    Tools,
    Tools.presence.users,
    user,
  );
  const isFriend = user.friend === true;
  const managesUser = Tools.access.canGrantTemporaryModerator === true;
  const friendLabel = managesUser
    ? Tools.i18n.format("moderation_action_title", { name: user.name })
    : Tools.i18n.format(isFriend ? "remove_friend" : "mark_friend", {
        name: user.name,
      });
  friend.hidden = currentIdentityUser;
  friend.title = friendLabel;
  friend.setAttribute("aria-label", friendLabel);
  friend.setAttribute("aria-pressed", isFriend ? "true" : "false");
  if (managesUser) friend.setAttribute("aria-haspopup", "dialog");
  else friend.removeAttribute("aria-haspopup");
  friend.classList.toggle("connected-user-friend-manager", managesUser);
  friend.classList.toggle("connected-user-friend-active", isFriend);
  row.classList.toggle("connected-user-row-friend", isFriend);

  row.classList.toggle("connected-user-row-readonly", user.canEdit === false);

  if (user.disconnectedAt) {
    meta.textContent = Tools.i18n.t("connected_user_left");
  } else {
    const relativeTime = getRelativeTimeState(user.joinedAt);
    joinedTime.textContent = formatShortRelativeTime(Tools, relativeTime);
    joinedTime.title = formatJoinedTimeTitle(Tools, relativeTime);

    meta.textContent = inactive
      ? `${Tools.i18n.t("connected_user_idle")} · `
      : "";
    meta.appendChild(joinedTime);
  }

  const reportLabel = user.reported
    ? Tools.i18n.t(user.reportBanned ? "ban_applied" : "report_sent")
    : getReportActionLabel(Tools, user.name);
  report.title = reportLabel;
  report.setAttribute("aria-label", reportLabel);
  report.hidden = user.reported
    ? false
    : Tools.access.canReport === false ||
      currentIdentityUser ||
      user.canBan === true ||
      !!user.disconnectedAt;
  report.disabled =
    currentIdentityUser || !!user.reported || !!user.reportPending;
  report.classList.toggle("connected-user-report-latched", !!user.reported);
}

/**
 * @param {AppToolsState} Tools
 * @param {PresenceModule} presence
 * @param {ConnectedUser} user
 */
function showConnectedUserManagementDialog(Tools, presence, user) {
  const socket = Tools.connection.socket;
  if (!socket) return;
  const activeGrant =
    user.canBan === true && user.canGrantTemporaryModerator !== true;
  /** @type {{label: string, value: string | number}[]} */
  const actionChoices = [
    {
      label: Tools.i18n.format(user.friend ? "remove_friend" : "mark_friend", {
        name: user.name,
      }),
      value: "friend",
    },
  ];
  /** @type {{id: string, label?: string, layout: "stacked" | "segmented", submit: boolean, choices: {label: string, value: string | number}[]}[]} */
  const sections = [
    { id: "action", layout: "stacked", submit: true, choices: actionChoices },
  ];
  if (activeGrant) {
    actionChoices.push({
      label: Tools.i18n.format("revoke_temporary_moderator", {
        name: user.name,
      }),
      value: 0,
    });
  } else if (user.canBan !== true) {
    sections.push({
      id: "duration",
      label: Tools.i18n.t("make_temporary_moderator"),
      layout: "segmented",
      submit: true,
      choices: getModerationDurationOptions(Tools)
        .slice(1)
        .map((duration) => ({
          label: duration.label,
          value: duration.durationMs,
        })),
    });
  }

  void Tools.ui
    .showActionDialog({
      title: Tools.i18n.format("moderation_action_title", {
        name: user.name,
      }),
      sections,
      cancelLabel: Tools.i18n.t("Cancel"),
    })
    .then((selection) => {
      if (selection?.value === "friend") {
        presence.toggleFriend(user.userId);
        return;
      }
      if (selection === null) return;
      socket.emit(SocketEvents.SET_TEMPORARY_MODERATOR, {
        socketId: user.socketId,
        durationMs: Number(selection.value),
      });
    });
}

/**
 * @param {() => AppToolsState} getTools
 * @param {PresenceModule} presence
 * @returns {ConnectedUserRow}
 */
function createConnectedUserRow(getTools, presence) {
  const row = /** @type {HTMLLIElement} */ (connectedUserRowTemplate());
  const { badge: toolBadge, icon: toolIcon } = createToolIconBadge(
    "connected-user-toolBadge",
    "connected-user-toolIcon",
  );
  row.querySelector(".connected-user-visual")?.appendChild(toolBadge);
  const view = /** @type {ConnectedUserRow} */ ({
    element: row,
    link: row.querySelector("a"),
    toolIcon,
    toolBadge,
    name: row.querySelector("bdi"),
    friend: row.querySelector(".connected-user-friend"),
    meta: row.querySelector(".connected-user-meta"),
    joinedTime: row.querySelector(".connected-user-time"),
    report: row.querySelector(".connected-user-report"),
  });
  const { friend, link, report } = view;
  friend.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    const Tools = getTools();
    if (!row.dataset.socketId) return;
    const connectedUser = presence.users.get(row.dataset.socketId);
    if (
      !connectedUser ||
      isCurrentIdentityUser(Tools, presence.users, connectedUser)
    ) {
      return;
    }
    if (Tools.access.canGrantTemporaryModerator === true) {
      showConnectedUserManagementDialog(Tools, presence, connectedUser);
      return;
    }
    presence.toggleFriend(connectedUser.userId);
  });
  link.addEventListener("click", () => revealTouchConnectedUserRow(row));
  report.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    const Tools = getTools();
    const socket = Tools.connection.socket;
    if (!socket || !row.dataset.socketId) return;
    const connectedUser = presence.users.get(row.dataset.socketId);
    if (
      !connectedUser ||
      Tools.access.canReport === false ||
      connectedUser.canBan === true ||
      isCurrentIdentityUser(Tools, presence.users, connectedUser) ||
      connectedUser.reported === true ||
      connectedUser.reportPending === true
    ) {
      return;
    }
    const updateReportRow = () => {
      if (row.dataset.socketId === connectedUser.socketId)
        updateConnectedUserRow(getTools(), view, connectedUser);
    };
    /**
     * @param {number | undefined} banDurationMs
     * @param {string | undefined} moderationRule
     */
    const reportConnectedUser = (banDurationMs, moderationRule) => {
      if (connectedUser.reported === true) return;
      connectedUser.reported = true;
      connectedUser.reportPending = false;
      connectedUser.reportBanned =
        typeof banDurationMs === "number" && banDurationMs > 0;
      updateReportRow();
      /** @type {import("../../types/app-runtime").ReportUserPayload} */
      const payload =
        banDurationMs !== undefined && moderationRule !== undefined
          ? { socketId: connectedUser.socketId, banDurationMs, moderationRule }
          : { socketId: connectedUser.socketId };
      socket.emit(SocketEvents.REPORT_USER, payload);
    };
    if (Tools.access.canBan === true) {
      connectedUser.reportPending = true;
      updateReportRow();
      void Tools.ui
        .showActionDialog({
          title: Tools.i18n.format("moderation_action_title", {
            name: connectedUser.name,
          }),
          message: Tools.i18n.t("moderation_action_message"),
          sections: [
            {
              id: "duration",
              label: Tools.i18n.t("moderation_action_duration"),
              layout: "segmented",
              initialValue: 0,
              choices: getModerationDurationOptions(Tools).map((duration) => ({
                label: duration.label,
                value: duration.durationMs,
                variant: duration.variant,
              })),
            },
            {
              id: "rule",
              label: Tools.i18n.t("moderation_action_rule"),
              layout: "grid",
              submit: true,
              choices: MODERATION_RULES.map((rule) => ({
                label: Tools.i18n.t(rule.titleKey),
                value: rule.id,
                iconUrl: `../rules/${rule.iconFile}`,
              })),
            },
          ],
          cancelLabel: Tools.i18n.t("Cancel"),
          link: {
            label: Tools.i18n.t("community_rules_link"),
            href: "../rules",
          },
        })
        .then((selection) => {
          if (selection !== null) {
            reportConnectedUser(
              Number(selection.selections.duration),
              String(selection.value),
            );
            return;
          }
          connectedUser.reportPending = false;
          updateReportRow();
        });
      return;
    }
    reportConnectedUser(undefined, undefined);
  });
  return view;
}

/**
 * @param {ConnectedUser} user
 * @param {BoardMessage} message
 * @param {{x: number, y: number} | null} focusPoint
 * @param {() => void} scheduleActivityRender
 * @returns {boolean}
 */
function applyConnectedUserActivity(
  user,
  message,
  focusPoint,
  scheduleActivityRender,
) {
  let changed = false;
  const runtimeToolId = TOOL_ID_BY_CODE[message.tool];
  const isCursorMessage = runtimeToolId === "cursor";

  if (!isCursorMessage) {
    changed =
      markConnectedUserActivity(user, scheduleActivityRender) || changed;
  } else if (focusPoint) {
    changed = markConnectedUserIdleActivity(user) || changed;
  }
  if ("color" in message && user.color !== message.color) {
    user.color = message.color;
    changed = true;
  }
  if ("size" in message && user.size !== message.size) {
    user.size = message.size || user.size;
    changed = true;
  }
  const activityToolId =
    isCursorMessage && "activeTool" in message
      ? message.activeTool
      : runtimeToolId;
  if (
    activityToolId &&
    activityToolId !== "cursor" &&
    user.lastTool !== activityToolId
  ) {
    user.lastTool = activityToolId;
    changed = true;
  }
  if (focusPoint) {
    if (user.position.x !== focusPoint.x || user.position.y !== focusPoint.y) {
      user.position = focusPoint;
      changed = true;
    }
  }
  return changed;
}
