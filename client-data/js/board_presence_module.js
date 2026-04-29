import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { getRequiredElement } from "./board_page_state.js";
import { VIEWPORT_HASH_SCALE_DECIMALS } from "./board_viewport.js";
import MessageCommon from "./message_common.js";
import { MutationType } from "./message_tool_metadata.js";
import { SocketEvents } from "./socket_events.js";

/** @import { AppToolsState, AttachedBoardDomModule, BoardMessage, ConnectedUser, ConnectedUserMap, HandChildMessage } from "../../types/app-runtime" */
/** @typedef {HTMLLIElement} ConnectedUserRow */

export class PresenceModule {
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
    this.users = /** @type {ConnectedUserMap} */ ({});
    this.panelOpen = false;
  }

  clearConnectedUsers() {
    Object.values(this.users).forEach((user) => {
      if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
    });
    this.users = /** @type {ConnectedUserMap} */ ({});
    this.renderConnectedUsers();
  }

  renderConnectedUsers() {
    const Tools = this.getTools();
    const list = getConnectedUsersList();
    const panel = getConnectedUsersPanel();
    /** @type {{[socketId: string]: ConnectedUserRow}} */
    const rowsBySocketId = {};
    Array.from(list.children).forEach((child) => {
      if (
        child instanceof HTMLLIElement &&
        child.dataset.socketId &&
        child.classList.contains("connected-user-row")
      ) {
        rowsBySocketId[child.dataset.socketId] =
          /** @type {ConnectedUserRow} */ (child);
      }
    });

    const users = Object.values(this.users).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    users.forEach((user, index) => {
      const row =
        rowsBySocketId[user.socketId] ||
        createConnectedUserRow(this.getTools, user, this.users);
      delete rowsBySocketId[user.socketId];
      updateConnectedUserRow(this.getTools, row, user);
      const currentChild = list.children[index];
      if (currentChild !== row) {
        list.insertBefore(row, currentChild || null);
      }
    });

    Object.values(rowsBySocketId).forEach((row) => {
      row.remove();
    });
    panel.dataset.empty = users.length === 0 ? "true" : "false";
    if (users.length === 0 && this.panelOpen) {
      this.setConnectedUsersPanelOpen(false);
    }
    syncConnectedUsersToggleLabel(Tools, this.users);
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
  }

  /** @param {ConnectedUser} user */
  upsertConnectedUser(user) {
    this.users[user.socketId] = Object.assign(
      {},
      this.users[user.socketId] || {},
      user,
    );
    this.renderConnectedUsers();
  }

  /** @param {string} socketId */
  removeConnectedUser(socketId) {
    const user = this.users[socketId];
    if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
    delete this.users[socketId];
    this.renderConnectedUsers();
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
    const renderConnectedUsers = () => this.renderConnectedUsers();
    Object.values(this.users).forEach((user) => {
      if (!connectedUserMatchesActivity(user, userId, messageSocketId)) return;
      changed =
        applyConnectedUserActivity(
          user,
          message,
          focusPoint,
          messageSocketId,
          renderConnectedUsers,
        ) || changed;
    });
    if (changed) this.renderConnectedUsers();
  }

  /** @param {BoardMessage} message */
  updateCurrentConnectedUserFromActivity(message) {
    const Tools = this.getTools();
    if (!Tools.connection.socket?.id) return;
    const current = this.users[Tools.connection.socket.id];
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
    if (toggle.dataset.connectedUsersUiBound !== "true") {
      toggle.dataset.connectedUsersUiBound = "true";
      toggle.addEventListener("click", () => {
        this.setConnectedUsersPanelOpen(!this.panelOpen);
      });
      toggle.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (
            !panel.matches(":hover") &&
            !panel.contains(document.activeElement) &&
            document.activeElement !== toggle
          ) {
            this.setConnectedUsersPanelOpen(false);
          }
        }, 0);
      });
      panel.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape") {
          evt.preventDefault();
          this.setConnectedUsersPanelOpen(false);
          toggle.focus();
        }
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
  return Object.keys(users).length;
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
  const accessibleLabel = `${userCount} ${Tools.i18n.t("users")}`;
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
 * @param {number | undefined} size
 * @returns {number}
 */
function getConnectedUserDotSize(size) {
  const userSize = Number(size);
  if (!Number.isFinite(userSize) || userSize <= 0) return 8;
  return Math.max(8, Math.min(18, 6 + userSize / 30));
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUser} user
 * @returns {string}
 */
function getConnectedUserToolLabel(Tools, user) {
  return Tools.i18n.t(user.lastTool || "hand");
}

/**
 * @param {ConnectedUser} user
 * @returns {boolean}
 */
function hasConnectedUserFocus(user) {
  return Number.isFinite(user.lastFocusX) && Number.isFinite(user.lastFocusY);
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

  if ("x" in message) {
    return { x: message.x, y: message.y };
  }

  if (message.type === MutationType.UPDATE && "id" in message) {
    const element = getBoardFocusElementById(dom, message.id);
    return element ? getBoundsCenter(getRenderedElementBounds(element)) : null;
  }

  return getBoundsCenter(MessageCommon.getEffectiveGeometryBounds(message));
}

/**
 * @param {ConnectedUser} user
 * @param {() => void} renderConnectedUsers
 * @returns {void}
 */
function scheduleConnectedUserPulseEnd(user, renderConnectedUsers) {
  if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  if (!user.pulseUntil) {
    user.pulseTimeoutId = null;
    return;
  }
  const remainingMs = Math.max(0, user.pulseUntil - Date.now());
  user.pulseTimeoutId = window.setTimeout(() => {
    if (user.pulseUntil && user.pulseUntil <= Date.now()) {
      user.pulseUntil = 0;
      user.pulseTimeoutId = null;
      renderConnectedUsers();
    }
  }, remainingMs + 20);
}

/**
 * @param {ConnectedUser} user
 * @param {() => void} renderConnectedUsers
 * @returns {void}
 */
function markConnectedUserActivity(user, renderConnectedUsers) {
  const now = Date.now();
  const interval = user.lastActivityAt ? now - user.lastActivityAt : 700;
  user.lastActivityAt = now;
  user.pulseMs = Math.max(160, Math.min(1200, interval));
  user.pulseUntil = now + user.pulseMs * 2;
  scheduleConnectedUserPulseEnd(user, renderConnectedUsers);
}

/**
 * @param {AppToolsState} Tools
 * @param {ConnectedUser} user
 * @returns {string}
 */
function getConnectedUserFocusHash(Tools, user) {
  if (!hasConnectedUserFocus(user)) return "";
  const scale = Tools.viewportState.controller.getScale();
  const x = /** @type {number} */ (user.lastFocusX);
  const y = /** @type {number} */ (user.lastFocusY);
  return `#${Math.max(0, (x - window.innerWidth / (2 * scale)) | 0)},${Math.max(
    0,
    (y - window.innerHeight / (2 * scale)) | 0,
  )},${scale.toFixed(VIEWPORT_HASH_SCALE_DECIMALS)}`;
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
  row.classList.toggle(
    "connected-user-row-self",
    isCurrentSocketUser(Tools, user),
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

  const color = /** @type {HTMLSpanElement | null} */ (
    row.querySelector(".connected-user-color")
  );
  if (color) {
    color.style.backgroundColor = user.color || "#001f3f";
    const dotSize = getConnectedUserDotSize(user.size);
    color.style.width = `${dotSize}px`;
    color.style.height = `${dotSize}px`;
    if (user.pulseUntil && user.pulseUntil > Date.now()) {
      color.classList.add("active");
      color.style.setProperty("--pulse-ms", `${user.pulseMs || 700}ms`);
    } else {
      color.classList.remove("active");
      color.style.removeProperty("--pulse-ms");
    }
  }

  const name = /** @type {HTMLElement | null} */ (
    row.querySelector(".connected-user-name")
  );
  if (name) name.textContent = user.name;

  const meta = /** @type {HTMLElement | null} */ (
    row.querySelector(".connected-user-meta")
  );
  if (meta) meta.textContent = getConnectedUserToolLabel(Tools, user);

  const report = /** @type {HTMLButtonElement | null} */ (
    row.querySelector(".connected-user-report")
  );
  if (report) {
    report.hidden = !!(user.reported && !isCurrentSocketUser(Tools, user));
    report.disabled = isCurrentSocketUser(Tools, user);
    report.classList.toggle("connected-user-report-latched", !!user.reported);
  }
}

/**
 * @param {() => AppToolsState} getTools
 * @param {ConnectedUser} user
 * @param {ConnectedUserMap} users
 * @returns {ConnectedUserRow}
 */
function createConnectedUserRow(getTools, user, users) {
  const row = /** @type {ConnectedUserRow} */ (document.createElement("li"));
  row.className = "connected-user-row";

  const color = document.createElement("span");
  color.className = "connected-user-color";
  row.appendChild(color);

  const main = document.createElement("a");
  main.className = "connected-user-main connected-user-main-link";

  const name = document.createElement("div");
  name.className = "connected-user-name";
  main.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "connected-user-meta";
  main.appendChild(meta);

  row.appendChild(main);

  const report = document.createElement("button");
  report.type = "button";
  report.className = "connected-user-report";
  report.textContent = "!";
  report.title = getTools().i18n.t("report");
  report.setAttribute("aria-label", getTools().i18n.t("report"));
  report.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    const Tools = getTools();
    if (!Tools.connection.socket || !row.dataset.socketId) return;
    const connectedUser = users[row.dataset.socketId];
    if (!connectedUser || isCurrentSocketUser(Tools, connectedUser)) return;
    connectedUser.reported = true;
    updateConnectedUserRow(getTools, row, connectedUser);
    Tools.connection.socket.emit(SocketEvents.REPORT_USER, {
      socketId: connectedUser.socketId,
    });
  });
  row.appendChild(report);

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
 * @param {() => void} renderConnectedUsers
 * @returns {boolean}
 */
function applyConnectedUserActivity(
  user,
  message,
  focusPoint,
  messageSocketId,
  renderConnectedUsers,
) {
  let changed = false;
  const runtimeToolId = TOOL_ID_BY_CODE[message.tool];
  const isCursorMessage = runtimeToolId === "cursor";

  if (!isCursorMessage) {
    markConnectedUserActivity(user, renderConnectedUsers);
    changed = true;
  }
  if ("color" in message) {
    user.color = message.color;
    changed = true;
  }
  if ("size" in message) {
    user.size = message.size || user.size;
    changed = true;
  }
  if (runtimeToolId && !isCursorMessage) {
    user.lastTool = runtimeToolId;
    changed = true;
  }
  if (
    focusPoint &&
    (!isCursorMessage ||
      messageSocketId === null ||
      messageSocketId === user.socketId)
  ) {
    user.lastFocusX = /** @type {{x: number, y: number}} */ (focusPoint).x;
    user.lastFocusY = /** @type {{x: number, y: number}} */ (focusPoint).y;
    changed = true;
  }
  return changed;
}
