import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { FriendStore } from "./board_friend_store.js";
import { getRequiredElement } from "./board_page_state.js";
import { VIEWPORT_HASH_SCALE_DECIMALS } from "./board_viewport.js";
import { getMessageActivityPoint } from "./message_activity_point.js";
import MessageCommon from "./message_common.js";
import { LIMITS } from "./message_limits.js";
import { MutationType } from "./message_tool_metadata.js";
import { SocketEvents } from "./socket_events.js";
import { createToolIconBadge, updateToolIconBadge } from "./tool_icon_badge.js";

/** @import { AppToolsState, AttachedBoardDomModule, BoardMessage, ConnectedUser, ConnectedUserMap, HandChildMessage } from "../../types/app-runtime" */
/** @typedef {HTMLLIElement} ConnectedUserRow */
/** @typedef {"minute" | "hour" | "day"} ConnectedUserDurationUnit */
/** @typedef {{kind: "now"} | {kind: "duration", count: number, unit: ConnectedUserDurationUnit, shortKey: string}} ConnectedUserRelativeTime */

export class PresenceModule {
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
    this.users = /** @type {ConnectedUserMap} */ (new Map());
    this.friendStore = new FriendStore();
    this.friendStorageBound = false;
    this.panelOpen = false;
    this.renderScheduled = false;
    /** @type {number | null} */
    this.staleTickId = null;
  }

  clearConnectedUsers() {
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
    /** @type {Map<string, ConnectedUserRow>} */
    const rowsBySocketId = new Map();
    Array.from(list.children).forEach((child) => {
      if (
        child instanceof HTMLLIElement &&
        child.dataset.socketId &&
        child.classList.contains("connected-user-row")
      ) {
        rowsBySocketId.set(
          child.dataset.socketId,
          /** @type {ConnectedUserRow} */ (child),
        );
      }
    });

    const currentSocketId = Tools.connection.socket?.id;
    const users = Array.from(this.users.values()).sort((left, right) =>
      compareConnectedUsersForDisplay(currentSocketId, left, right),
    );

    users.forEach((user, index) => {
      const row =
        rowsBySocketId.get(user.socketId) ||
        createConnectedUserRow(this.getTools, user, this);
      rowsBySocketId.delete(user.socketId);
      updateConnectedUserRow(this.getTools, row, user);
      const currentChild = list.children[index];
      if (currentChild !== row) {
        list.insertBefore(row, currentChild || null);
      }
    });

    rowsBySocketId.forEach((row) => {
      row.remove();
    });
    if (
      focusedListControl?.isConnected &&
      document.activeElement !== focusedListControl
    ) {
      focusedListControl.focus({ preventScroll: true });
    }
    syncConnectedUsersSummary(this, Tools);
    schedulePresenceStaleTick(this);
  }

  /** @param {boolean} open */
  setConnectedUsersPanelOpen(open) {
    const shouldOpen = open && getConnectedUsersCount(this.users) > 0;
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
    if (!user) return;
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
   */
  updateConnectedUsersFromActivity(userId, message) {
    const Tools = this.getTools();
    // Presence has three layers:
    // - `socketId`: one live browser tab/socket connection. This is the most precise activity target.
    // - `userId`: derived server-side from the shared user-secret cookie, so multiple tabs from one browser profile can share it.
    // - displayed name: combines an IP-derived word with the `userId`, so it is human-readable but not a stable routing key.
    // When a live message includes `socket`, update that exact row only. Falling back to `userId` keeps older/non-live paths working.
    const messageSocketId = message.socket || null;
    if (!userId && messageSocketId === null) return;
    let changed = false;
    const dom = getAttachedBoardDom(Tools);
    const focusPoint = dom ? getMessageFocusPoint(dom, message) : null;
    Array.from(this.users.values()).forEach((user) => {
      if (!connectedUserMatchesActivity(user, userId, messageSocketId)) return;
      changed =
        applyConnectedUserActivity(
          user,
          message,
          focusPoint,
          messageSocketId,
          () => this.schedulePresenceRender(false),
        ) || changed;
    });
    if (changed) this.schedulePresenceRender(false);
  }

  /** @param {BoardMessage} message */
  updateCurrentConnectedUserFromActivity(message) {
    const Tools = this.getTools();
    if (!Tools.connection.socket?.id) return;
    const current = this.users.get(Tools.connection.socket.id);
    if (!current) return;
    this.updateConnectedUsersFromActivity(
      current.userId,
      Object.assign({}, message, { socket: current.socketId }),
    );
  }

  initConnectedUsersUI() {
    const Tools = this.getTools();
    const toggle = document.getElementById("connectedUsersToggle");
    const panel = document.getElementById("connectedUsersPanel");
    if (!(toggle instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      return;
    }
    this.panelOpen = toggle.getAttribute("aria-expanded") === "true";
    syncConnectedUsersToggleLabel(Tools, this.users);
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
    left.socketId.localeCompare(right.socketId)
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
 * @param {AppToolsState} Tools
 * @returns {AttachedBoardDomModule | null}
 */
function getAttachedBoardDom(Tools) {
  return Tools.dom.status === "attached" ? Tools.dom : null;
}

/**
 * @param {ConnectedUserMap} users
 * @returns {number}
 */
function getConnectedUsersCount(users) {
  return Array.from(users.values()).filter((user) => !user.disconnectedAt)
    .length;
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUserMap} users
 */
function syncConnectedUsersToggleLabel(Tools, users) {
  const toggle = getConnectedUsersToggle();
  const label = /** @type {HTMLElement | null} */ (
    toggle.querySelector(".tool-name")
  );
  const userCount = getConnectedUsersCount(users);
  const accessibleLabel = Tools.i18n.format("users_count", {
    count: String(userCount),
  });
  toggle.setAttribute("aria-label", accessibleLabel);
  toggle.title = accessibleLabel;
  if (!label) return;
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
 * @param {AppToolsState} [Tools]
 */
function syncConnectedUsersSummary(presence, Tools = presence.getTools()) {
  const panel = getConnectedUsersPanel();
  const users = presence.users;
  const userCount = getConnectedUsersCount(users);
  panel.dataset.empty = userCount === 0 ? "true" : "false";
  if (userCount === 0 && presence.panelOpen) {
    presence.setConnectedUsersPanelOpen(false);
  }
  syncConnectedUsersToggleLabel(Tools, users);
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
/** @type {{value: string, labelKey: string}[]} */
const MODERATION_RULE_OPTIONS = [
  { value: "illegal", labelKey: "rules_illegal_title" },
  { value: "violence", labelKey: "rules_violence_title" },
  { value: "pornography", labelKey: "rules_pornography_title" },
  { value: "harassment", labelKey: "rules_harassment_title" },
  { value: "drawings", labelKey: "rules_drawings_title" },
];

/** @type {({durationMs: 0, labelKey: "warn", variant: "secondary"} | {durationMs: number, count: number, unit: ConnectedUserDurationUnit, variant: "secondary" | "warning" | "danger"})[]} */
const BAN_DURATION_OPTIONS = [
  {
    durationMs: 0,
    labelKey: "warn",
    variant: "secondary",
  },
  {
    durationMs: 15 * DURATION_UNIT_MS.minute,
    count: 15,
    unit: "minute",
    variant: "secondary",
  },
  {
    durationMs: 24 * DURATION_UNIT_MS.hour,
    count: 24,
    unit: "hour",
    variant: "warning",
  },
  {
    durationMs: 7 * DURATION_UNIT_MS.day,
    count: 7,
    unit: "day",
    variant: "danger",
  },
];

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
  if (user.friend === true) markers.push("\u2665\uFE0E");
  if (user.canClear === true) markers.push("\u{1F338}");
  return markers.length > 0 ? `${markers.join(" ")} ${user.name}` : user.name;
}

/** @param {ConnectedUser} user */
function getConnectedUserListName(user) {
  return user.canClear === true ? `\u{1F338} ${user.name}` : user.name;
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

/**
 * SVG layout measurement is limited to connected-user focus derivation for the
 * already small set of ids touched by one received activity message.
 * @param {SVGGraphicsElement} element
 * @returns {{minX: number, minY: number, maxX: number, maxY: number} | null}
 */
function getRenderedElementBounds(element) {
  if (typeof element.transformedBBox !== "function") return null;
  /** @type {{r: [number, number], a: [number, number], b: [number, number]} | null} */
  let box = null;
  try {
    box = element.transformedBBox();
  } catch {
    return null;
  }
  /** @type {[number, number][]} */
  const points = [
    box.r,
    [box.r[0] + box.a[0], box.r[1] + box.a[1]],
    [box.r[0] + box.b[0], box.r[1] + box.b[1]],
    [box.r[0] + box.a[0] + box.b[0], box.r[1] + box.a[1] + box.b[1]],
  ];
  const firstPoint = points[0];
  if (!firstPoint) return null;
  return points.reduce(
    /**
     * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds
     * @param {[number, number]} point
     */
    function extend(bounds, point) {
      return {
        minX: Math.min(bounds.minX, point[0]),
        minY: Math.min(bounds.minY, point[1]),
        maxX: Math.max(bounds.maxX, point[0]),
        maxY: Math.max(bounds.maxY, point[1]),
      };
    },
    {
      minX: firstPoint[0],
      minY: firstPoint[1],
      maxX: firstPoint[0],
      maxY: firstPoint[1],
    },
  );
}

/**
 * @param {AttachedBoardDomModule} dom
 * @param {string} elementId
 * @returns {SVGGraphicsElement | null}
 */
function getBoardFocusElementById(dom, elementId) {
  const element = dom.svg.getElementById(elementId);
  if (!(element instanceof SVGGraphicsElement)) return null;
  return dom.drawingArea.contains(element) ? element : null;
}

/**
 * @param {AttachedBoardDomModule} dom
 * @param {HandChildMessage[]} children
 * @returns {{x: number, y: number} | null}
 */
function getBatchFocusPoint(dom, children) {
  /** @type {{minX: number, minY: number, maxX: number, maxY: number} | null} */
  let bounds = null;
  children.forEach((child) => {
    const targetId =
      child.type === MutationType.UPDATE
        ? child.id
        : child.type === MutationType.COPY
          ? child.newid
          : null;
    if (!targetId) return;
    const element = getBoardFocusElementById(dom, targetId);
    if (!element) return;
    const elementBounds = getRenderedElementBounds(element);
    if (!elementBounds) return;
    if (!bounds) {
      bounds = elementBounds;
      return;
    }
    bounds = {
      minX: Math.min(bounds.minX, elementBounds.minX),
      minY: Math.min(bounds.minY, elementBounds.minY),
      maxX: Math.max(bounds.maxX, elementBounds.maxX),
      maxY: Math.max(bounds.maxY, elementBounds.maxY),
    };
  });
  return getBoundsCenter(bounds);
}

/**
 * @param {AttachedBoardDomModule} dom
 * @param {BoardMessage} message
 * @returns {{x: number, y: number} | null}
 */
function getMessageFocusPoint(dom, message) {
  if ("_children" in message) {
    return getBatchFocusPoint(dom, message._children);
  }

  const activityPoint = getMessageActivityPoint(message);
  if (activityPoint) return activityPoint;

  if (message.type === MutationType.UPDATE && "id" in message) {
    const element = getBoardFocusElementById(dom, message.id);
    return element ? getBoundsCenter(getRenderedElementBounds(element)) : null;
  }

  return getBoundsCenter(MessageCommon.getEffectiveGeometryBounds(message));
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
  // The server currently treats clear-capable moderators as report-to-ban users.
  // Keep this UI-only label aligned without broadening the capability model here.
  return Tools.i18n.format(
    Tools.access.canClear === true ? "ban_user" : "report_user",
    { name },
  );
}

/** @returns {string} */
function getReportActionGlyph() {
  return "\u2691\uFE0E";
}

/**
 * @param {() => AppToolsState} getTools
 * @param {ConnectedUserRow} row
 * @param {ConnectedUser} user
 * @returns {void}
 */
function updateConnectedUserRow(getTools, row, user) {
  const Tools = getTools();
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

  const link = /** @type {HTMLAnchorElement | null} */ (
    row.querySelector(".connected-user-main-link")
  );
  if (link) {
    if (focusHash) {
      link.setAttribute("href", focusHash);
      link.removeAttribute("aria-disabled");
      link.tabIndex = 0;
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.tabIndex = -1;
    }
  }

  const toolIcon = /** @type {HTMLImageElement | null} */ (
    row.querySelector(".connected-user-toolIcon")
  );
  if (toolIcon) {
    updateToolIconBadge(
      toolIcon,
      user.lastTool || "hand",
      getConnectedUserToolLabel(Tools, user),
    );
  }

  const toolBadge = /** @type {HTMLSpanElement | null} */ (
    row.querySelector(".connected-user-toolBadge")
  );
  if (toolBadge) {
    const userColor = user.color || "#001f3f";
    toolBadge.style.borderColor = userColor;
    toolBadge.style.setProperty("--connected-user-pulse-color", userColor);
    toolBadge.style.borderWidth = `${getConnectedUserRingWidth(user.size)}px`;
    if (user.pulseUntil && user.pulseUntil > Date.now()) {
      toolBadge.classList.add("active");
      toolBadge.style.setProperty("--pulse-ms", `${user.pulseMs || 700}ms`);
    } else {
      toolBadge.classList.remove("active");
      toolBadge.style.removeProperty("--pulse-ms");
    }
  }

  const name = /** @type {HTMLElement | null} */ (
    row.querySelector(".connected-user-name-text")
  );
  if (name) {
    name.textContent = getConnectedUserListName(user);
  }

  const friend = /** @type {HTMLButtonElement | null} */ (
    row.querySelector(".connected-user-friend")
  );
  if (friend) {
    const currentIdentityUser = isCurrentIdentityUser(
      Tools,
      Tools.presence.users,
      user,
    );
    const isFriend = user.friend === true;
    const friendLabel = Tools.i18n.format(
      isFriend ? "remove_friend" : "mark_friend",
      { name: user.name },
    );
    friend.hidden = currentIdentityUser;
    const friendGlyph = friend.querySelector(".connected-user-friend-glyph");
    if (friendGlyph) {
      friendGlyph.textContent = isFriend ? "\u2665\uFE0E" : "\u2661";
    }
    friend.title = friendLabel;
    friend.setAttribute("aria-label", friendLabel);
    friend.setAttribute("aria-pressed", isFriend ? "true" : "false");
    friend.classList.toggle("connected-user-friend-active", isFriend);
    row.classList.toggle("connected-user-row-friend", isFriend);
    const friendMarker = row.querySelector(".connected-user-friend-marker");
    if (friendMarker instanceof HTMLElement) {
      friendMarker.hidden = !isFriend;
    }
  }

  row.classList.toggle("connected-user-row-readonly", user.canEdit === false);

  const meta = /** @type {HTMLElement | null} */ (
    row.querySelector(".connected-user-meta")
  );
  if (meta) {
    if (user.disconnectedAt) {
      meta.textContent = Tools.i18n.t("connected_user_left");
    } else {
      const relativeTime = getRelativeTimeState(user.joinedAt);
      const joinedTime = document.createElement("span");
      joinedTime.className = "connected-user-time";
      joinedTime.textContent = formatShortRelativeTime(Tools, relativeTime);
      joinedTime.title = formatJoinedTimeTitle(Tools, relativeTime);

      meta.textContent = inactive
        ? `${Tools.i18n.t("connected_user_idle")} · `
        : "";
      meta.appendChild(joinedTime);
    }
  }

  const report = /** @type {HTMLButtonElement | null} */ (
    row.querySelector(".connected-user-report")
  );
  if (report) {
    const currentIdentityUser = isCurrentIdentityUser(
      Tools,
      Tools.presence.users,
      user,
    );
    const reportLabel = getReportActionLabel(Tools, user.name);
    report.textContent = getReportActionGlyph();
    report.title = reportLabel;
    report.setAttribute("aria-label", reportLabel);
    report.hidden =
      Tools.access.canReport === false ||
      currentIdentityUser ||
      !!user.disconnectedAt ||
      user.canClear === true ||
      user.reported === true;
    report.disabled = currentIdentityUser;
    report.classList.toggle("connected-user-report-latched", !!user.reported);
  }
}

/**
 * @param {() => AppToolsState} getTools
 * @param {ConnectedUser} user
 * @param {PresenceModule} presence
 * @returns {ConnectedUserRow}
 */
function createConnectedUserRow(getTools, user, presence) {
  const row = /** @type {ConnectedUserRow} */ (document.createElement("li"));
  row.className = "connected-user-row";

  const visual = document.createElement("span");
  visual.className = "connected-user-visual";
  const { badge: toolBadge } = createToolIconBadge(
    "connected-user-toolBadge",
    "connected-user-toolIcon",
  );
  visual.appendChild(toolBadge);
  row.appendChild(visual);

  const main = document.createElement("div");
  main.className = "connected-user-main";

  const friend = document.createElement("button");
  friend.type = "button";
  friend.className = "connected-user-friend";
  const friendGlyph = document.createElement("span");
  friendGlyph.className = "connected-user-friend-glyph";
  friendGlyph.setAttribute("aria-hidden", "true");
  friend.appendChild(friendGlyph);
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
    presence.toggleFriend(connectedUser.userId);
  });
  const link = document.createElement("a");
  link.className = "connected-user-main-link";

  const name = document.createElement("div");
  name.className = "connected-user-name";
  const friendMarker = document.createElement("span");
  friendMarker.className = "connected-user-friend-marker";
  friendMarker.setAttribute("aria-hidden", "true");
  friendMarker.textContent = "\u2665\uFE0E";
  friendMarker.hidden = true;
  const nameText = document.createElement("bdi");
  nameText.className = "connected-user-name-text";
  nameText.dir = "auto";
  name.append(friendMarker, nameText);
  link.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "connected-user-meta";
  link.appendChild(meta);

  main.appendChild(link);
  row.appendChild(main);

  const actions = document.createElement("span");
  actions.className = "connected-user-actions";
  actions.appendChild(friend);

  const report = document.createElement("button");
  report.type = "button";
  report.className = "connected-user-report";
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
      connectedUser.canClear === true ||
      isCurrentIdentityUser(Tools, presence.users, connectedUser)
    ) {
      return;
    }
    /**
     * @param {number | undefined} banDurationMs
     * @param {string | undefined} moderationRule
     */
    const reportConnectedUser = (banDurationMs, moderationRule) => {
      connectedUser.reported = true;
      updateConnectedUserRow(getTools, row, connectedUser);
      /** @type {import("../../types/app-runtime").ReportUserPayload} */
      const payload = {
        socketId: connectedUser.socketId,
      };
      if (banDurationMs !== undefined) payload.banDurationMs = banDurationMs;
      if (moderationRule !== undefined) payload.moderationRule = moderationRule;
      socket.emit(SocketEvents.REPORT_USER, payload);
    };
    if (Tools.access.canClear === true) {
      void Tools.ui
        .showChoiceDialog({
          message: Tools.i18n.format("moderation_rule_prompt", {
            name: connectedUser.name,
          }),
          cancelLabel: Tools.i18n.t("Cancel"),
          choices: MODERATION_RULE_OPTIONS.map((option) => ({
            label: Tools.i18n.t(option.labelKey),
            value: option.value,
            variant: /** @type {"secondary"} */ ("secondary"),
          })),
        })
        .then((moderationRule) => {
          if (moderationRule === null) return null;
          return Tools.ui
            .showChoiceDialog({
              message: Tools.i18n.format("ban_user_confirmation", {
                name: connectedUser.name,
              }),
              cancelLabel: Tools.i18n.t("Cancel"),
              choices: BAN_DURATION_OPTIONS.map((option) => ({
                label:
                  "labelKey" in option
                    ? Tools.i18n.t(option.labelKey)
                    : formatShortRelativeTime(
                        Tools,
                        getDurationPartState(option.count, option.unit),
                      ),
                value: option.durationMs,
                variant: option.variant,
              })),
            })
            .then((banDurationMs) => ({ banDurationMs, moderationRule }));
        })
        .then((selection) => {
          if (selection !== null && selection?.banDurationMs !== null) {
            reportConnectedUser(
              selection.banDurationMs,
              selection.moderationRule,
            );
          }
        });
      return;
    }
    reportConnectedUser(undefined, undefined);
  });
  actions.appendChild(report);
  row.appendChild(actions);

  updateConnectedUserRow(getTools, row, user);
  return row;
}

/**
 * @param {ConnectedUser} user
 * @param {string | undefined} userId
 * @param {string | null} messageSocketId
 * @returns {boolean}
 */
function connectedUserMatchesActivity(user, userId, messageSocketId) {
  if (messageSocketId !== null) {
    return user.socketId === messageSocketId;
  }
  return user.userId === userId;
}

/**
 * @param {ConnectedUser} user
 * @param {BoardMessage} message
 * @param {{x: number, y: number} | null} focusPoint
 * @param {string | null} messageSocketId
 * @param {() => void} scheduleActivityRender
 * @returns {boolean}
 */
function applyConnectedUserActivity(
  user,
  message,
  focusPoint,
  messageSocketId,
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
  if (
    focusPoint &&
    (!isCursorMessage ||
      messageSocketId === null ||
      messageSocketId === user.socketId)
  ) {
    const nextFocusX = /** @type {{x: number, y: number}} */ (focusPoint).x;
    const nextFocusY = /** @type {{x: number, y: number}} */ (focusPoint).y;
    if (user.position.x !== nextFocusX || user.position.y !== nextFocusY) {
      user.position = { x: nextFocusX, y: nextFocusY };
      changed = true;
    }
  }
  return changed;
}
