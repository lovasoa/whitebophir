/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */
/** @typedef {import("../../types/app-runtime").AppBoardState} AppBoardState */
/** @typedef {import("../../types/app-runtime").AppTool} AppTool */
/** @typedef {import("../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../types/app-runtime").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime").ColorPreset} ColorPreset */
/** @typedef {import("../../types/app-runtime").PendingMessages} PendingMessages */
/** @typedef {import("../../types/app-runtime").ServerConfig} ServerConfig */
/** @typedef {import("../../types/app-runtime").CompiledToolListener} CompiledToolListener */
/** @typedef {import("../../types/app-runtime").ToolPalette} ToolPalette */
/** @typedef {import("../../types/app-runtime").ToolPointerListener} ToolPointerListener */
/** @typedef {{board?: string, socketId: string, userId: string, name: string, color: string, size: number, lastTool: string, lastCursorX?: number, lastCursorY?: number, lastActivityAt?: number, pulseMs?: number, pulseUntil?: number, reported?: boolean, pulseTimeoutId?: ReturnType<typeof setTimeout> | null}} ConnectedUser */

var Tools = /** @type {AppToolsState} */ ({});
var MessageCommon = window.WBOMessageCommon;
var BoardConnection = window.WBOBoardConnection;
var BoardMessages = window.WBOBoardMessages;
var BoardState = window.WBOBoardState;
var BoardTurnstile = window.WBOBoardTurnstile;
var BoardTools = window.WBOBoardTools;
var BoardBootstrap = window.WBOBoardBootstrap;

/**
 * @param {string} elementId
 * @returns {HTMLInputElement}
 */
function getRequiredInput(elementId) {
  return /** @type {HTMLInputElement} */ (
    BoardBootstrap.getRequiredElement(elementId)
  );
}

/**
 * @param {string} toolName
 * @returns {{button: HTMLElement, primaryIcon: HTMLImageElement, secondaryIcon: HTMLImageElement | null, label: HTMLElement}}
 */
function getRequiredToolButtonParts(toolName) {
  var button = BoardBootstrap.getRequiredElement("toolID-" + toolName);
  var primaryIcon = /** @type {HTMLImageElement | null} */ (
    button.querySelector(".tool-icon")
  );
  var label = /** @type {HTMLElement | null} */ (
    button.querySelector(".tool-name")
  );
  if (!primaryIcon || !label) {
    throw new Error("Missing required tool button structure for " + toolName);
  }
  return {
    button: button,
    primaryIcon: primaryIcon,
    secondaryIcon: /** @type {HTMLImageElement | null} */ (
      button.querySelector(".secondaryIcon")
    ),
    label: label,
  };
}

/**
 * @param {EventTarget | null} target
 * @returns {target is HTMLInputElement | HTMLTextAreaElement}
 */
function isTextEntryTarget(target) {
  return (
    (target instanceof HTMLInputElement && target.type === "text") ||
    target instanceof HTMLTextAreaElement
  );
}

function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) {
    if (typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }
}

Tools.i18n = (function i18n() {
  var translations = /** @type {{[key: string]: string}} */ (
    BoardBootstrap.parseEmbeddedJson("translations", {})
  );
  return {
    /** @param {string} s */
    t: function translate(s) {
      var key = s.toLowerCase().replace(/ /g, "_");
      return translations[key] || s;
    },
  };
})();

Tools.server_config = /** @type {ServerConfig} */ (
  BoardBootstrap.parseEmbeddedJson("configuration", {})
);
Tools.readOnlyToolNames = new Set(["Hand", "Grid", "Download", "Zoom"]);
Tools.turnstileValidatedUntil = 0;
Tools.turnstileWidgetId = null;
Tools.turnstileRefreshTimeout = null;
Tools.turnstilePending = false;
Tools.turnstilePendingWrites = [];

/** @param {BoardMessage} message */
Tools.cloneMessage = function cloneMessage(message) {
  if (typeof structuredClone === "function") return structuredClone(message);
  return /** @type {BoardMessage} */ (JSON.parse(JSON.stringify(message)));
};

/**
 * @param {BoardMessage} data
 * @param {AppTool} tool
 */
Tools.queueProtectedWrite = function queueProtectedWrite(data, tool) {
  Tools.turnstilePendingWrites.push({
    data: Tools.cloneMessage(data),
    toolName: tool.name,
  });
  Tools.showTurnstileWidget();
};

Tools.flushTurnstilePendingWrites = function flushTurnstilePendingWrites() {
  var pendingWrites = Tools.turnstilePendingWrites;
  Tools.turnstilePendingWrites = [];
  pendingWrites.forEach(function replayPendingWrite(write) {
    var tool = Tools.list[write.toolName];
    if (!tool) return;
    Tools.send(write.data, write.toolName);
  });
};

Tools.scale = 1.0;
Tools.drawToolsAllowed = null;

if (Tools.server_config.TURNSTILE_SITE_KEY) {
  var script = document.createElement("script");
  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

Tools.isTurnstileValidated = function isTurnstileValidated() {
  return Tools.turnstileValidatedUntil > Date.now();
};

Tools.clearTurnstileRefreshTimeout = function clearTurnstileRefreshTimeout() {
  if (Tools.turnstileRefreshTimeout) {
    clearTimeout(Tools.turnstileRefreshTimeout);
    Tools.turnstileRefreshTimeout = null;
  }
};

/** @param {number} validationWindowMs */
Tools.scheduleTurnstileRefresh = function scheduleTurnstileRefresh(
  validationWindowMs,
) {
  if (!Tools.server_config.TURNSTILE_SITE_KEY || !(validationWindowMs > 0))
    return;
  Tools.clearTurnstileRefreshTimeout();
  var refreshDelay = Math.floor(validationWindowMs * 0.8);
  if (!(refreshDelay > 0)) return;
  Tools.turnstileRefreshTimeout = setTimeout(function refreshTurnstileToken() {
    Tools.refreshTurnstile();
  }, refreshDelay);
};

/** @param {unknown} result */
Tools.setTurnstileValidation = function setTurnstileValidation(result) {
  Tools.clearTurnstileRefreshTimeout();
  var ack = Tools.normalizeTurnstileAck(result);
  if (ack.success !== true) {
    Tools.turnstileValidatedUntil = 0;
    return;
  }

  var validation = BoardTurnstile.computeTurnstileValidation(
    ack,
    Number(Tools.server_config.TURNSTILE_VALIDATION_WINDOW_MS),
  );
  var validationWindowMs = validation.validationWindowMs;
  Tools.turnstileValidatedUntil = validation.validatedUntil;

  if (validationWindowMs > 0) {
    Tools.scheduleTurnstileRefresh(validationWindowMs);
  }
};

/** @param {unknown} result */
Tools.normalizeTurnstileAck = function normalizeTurnstileAck(result) {
  return BoardTurnstile.normalizeTurnstileAck(
    result,
    Number(Tools.server_config.TURNSTILE_VALIDATION_WINDOW_MS),
  );
};

Tools.ensureTurnstileElements = function ensureTurnstileElements() {
  var overlay = document.getElementById("turnstile-overlay");
  var widget = document.getElementById("turnstile-widget");
  if (overlay && widget) return { overlay: overlay };

  overlay = document.createElement("div");
  overlay.id = "turnstile-overlay";
  overlay.classList.add("turnstile-overlay-hidden");

  var modal = document.createElement("div");
  modal.id = "turnstile-modal";

  widget = document.createElement("div");
  widget.id = "turnstile-widget";
  modal.appendChild(widget);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  return { overlay: overlay };
};

Tools.showTurnstileOverlayTimeout = null;

/** @param {number} delay */
Tools.showTurnstileOverlay = function showTurnstileOverlay(delay) {
  var elements = Tools.ensureTurnstileElements();
  if (delay > 0) {
    Tools.showTurnstileOverlayTimeout = setTimeout(function () {
      elements.overlay.classList.remove("turnstile-overlay-hidden");
    }, delay);
  } else {
    elements.overlay.classList.remove("turnstile-overlay-hidden");
  }
};

Tools.hideTurnstileOverlay = function hideTurnstileOverlay() {
  if (Tools.showTurnstileOverlayTimeout) {
    clearTimeout(Tools.showTurnstileOverlayTimeout);
    Tools.showTurnstileOverlayTimeout = null;
  }
  var overlay = document.getElementById("turnstile-overlay");
  if (overlay) overlay.classList.add("turnstile-overlay-hidden");
};

/** @param {unknown} errorCode */
function handleTurnstileError(errorCode) {
  alert("Turnstile verification failed: " + errorCode);
  location.reload();
}

Tools.refreshTurnstile = function refreshTurnstile() {
  if (!Tools.server_config.TURNSTILE_SITE_KEY) return;
  Tools.ensureTurnstileElements();

  if (typeof turnstile !== "undefined") {
    if (Tools.turnstilePending) return;

    if (Tools.turnstileWidgetId === null) {
      Tools.turnstilePending = true;
      Tools.turnstileWidgetId = turnstile.render("#turnstile-widget", {
        sitekey: Tools.server_config.TURNSTILE_SITE_KEY,
        appearance: "interaction-only",
        theme: "light",
        "refresh-expired": "manual",
        /** @param {string} token */
        callback: function (token) {
          if (!Tools.socket) return;
          Tools.socket.emit(
            "turnstile_token",
            token,
            function (/** @type {unknown} */ result) {
              var turnstileResult = Tools.normalizeTurnstileAck(result);
              Tools.turnstilePending = false;
              if (turnstileResult.success) {
                Tools.setTurnstileValidation(turnstileResult);
                Tools.hideTurnstileOverlay();
                Tools.flushTurnstilePendingWrites();
              } else {
                Tools.setTurnstileValidation(null);
                Tools.refreshTurnstile();
              }
            },
          );
        },
        "before-interactive-callback": function () {
          Tools.showTurnstileOverlay(500);
        },
        "after-interactive-callback": function () {
          if (Tools.isTurnstileValidated()) Tools.hideTurnstileOverlay();
        },
        "error-callback": function (/** @type {unknown} */ err) {
          Tools.turnstilePending = false;
          Tools.setTurnstileValidation(null);
          console.error("Turnstile error:", err);
          handleTurnstileError(err);
        },
        "timeout-callback": function () {
          Tools.turnstilePending = false;
          Tools.setTurnstileValidation(null);
          Tools.refreshTurnstile();
        },
        "expired-callback": function () {
          Tools.turnstilePending = false;
          Tools.refreshTurnstile();
        },
      });
      return;
    }

    Tools.turnstilePending = true;
    turnstile.reset(Tools.turnstileWidgetId);
  } else {
    console.error("Error loading Turnstile. Refreshing the page.");
    location.reload();
  }
};

/** @param {string} toolName */
Tools.shouldDisableTool = function shouldDisableTool(toolName) {
  return (
    MessageCommon.isDrawTool(toolName) &&
    !MessageCommon.isDrawToolAllowedAtScale(Tools.scale || 1)
  );
};

/** @param {string} toolName */
Tools.canUseTool = function canUseTool(toolName) {
  return (
    Tools.shouldDisplayTool(toolName) && !Tools.shouldDisableTool(toolName)
  );
};

/** @param {string} toolName */
Tools.syncToolDisabledState = function syncToolDisabledState(toolName) {
  var toolElem = document.getElementById("toolID-" + toolName);
  if (!toolElem) return;
  var disabled = Tools.shouldDisableTool(toolName);
  toolElem.classList.toggle("disabledTool", disabled);
  toolElem.setAttribute("aria-disabled", disabled ? "true" : "false");
};

/** @param {boolean} force */
Tools.syncDrawToolAvailability = function syncDrawToolAvailability(force) {
  var drawToolsAllowed = MessageCommon.isDrawToolAllowedAtScale(Tools.scale);
  if (!force && drawToolsAllowed === Tools.drawToolsAllowed) return;
  Tools.drawToolsAllowed = drawToolsAllowed;

  Object.keys(Tools.list || {}).forEach(function (toolName) {
    Tools.syncToolDisabledState(toolName);
  });

  if (
    !drawToolsAllowed &&
    Tools.curTool &&
    MessageCommon.isDrawTool(Tools.curTool.name) &&
    Tools.list.Hand
  ) {
    Tools.change("Hand");
  }
};

Tools.showTurnstileWidget = function showTurnstileWidget() {
  Tools.refreshTurnstile();
};

/** @param {unknown} state */
Tools.setBoardState = function setBoardState(state) {
  Tools.boardState = /** @type {AppBoardState} */ (
    BoardState.normalizeBoardState(state)
  );
  Tools.readOnly = Tools.boardState.readonly;
  Tools.canWrite = Tools.boardState.canWrite;

  var hideEditingTools = Tools.readOnly && !Tools.canWrite;
  var settings = document.getElementById("settings");
  if (settings) settings.style.display = hideEditingTools ? "none" : "";

  Object.keys(Tools.list || {}).forEach(function (toolName) {
    var toolElem = document.getElementById("toolID-" + toolName);
    if (!toolElem) return;
    toolElem.style.display = Tools.shouldDisplayTool(toolName) ? "" : "none";
  });

  Tools.syncDrawToolAvailability(true);

  if (
    hideEditingTools &&
    Tools.curTool &&
    !Tools.shouldDisplayTool(Tools.curTool.name) &&
    Tools.list.Hand
  ) {
    Tools.change("Hand");
  }
};

/** @param {string} toolName */
Tools.shouldDisplayTool = function shouldDisplayTool(toolName) {
  return BoardTools.shouldDisplayTool(
    toolName,
    Tools.boardState,
    Tools.readOnlyToolNames,
  );
};

Tools.setBoardState(
  BoardBootstrap.parseEmbeddedJson("board-state", {
    readonly: false,
    canWrite: true,
  }),
);

Tools.resolveBoardName = function resolveBoardName() {
  return BoardState.resolveBoardName(window.location.pathname);
};

Tools.board = BoardBootstrap.getRequiredElement("board");
Tools.svg = /** @type {SVGSVGElement} */ (
  /** @type {unknown} */ (BoardBootstrap.getRequiredElement("canvas"))
);
Tools.drawingArea = Tools.svg.getElementById("drawingArea");

//Initialization
Tools.curTool = null;
Tools.drawingEvent = true;
Tools.showMarker = true;
Tools.showOtherCursors = true;
Tools.showMyCursor = true;

Tools.isIE = /MSIE|Trident/.test(window.navigator.userAgent);

Tools.socket = null;
Tools.hasConnectedOnce = false;
Tools.rateLimitAlertShown = false;
Tools.socketIOExtraHeaders = (function loadSocketIOExtraHeaders() {
  var extraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
    window.socketio_extra_headers,
  );
  if (extraHeaders) {
    window.socketio_extra_headers = extraHeaders;
    return extraHeaders;
  }
  try {
    var storedHeaders = sessionStorage.getItem("socketio_extra_headers");
    if (storedHeaders) {
      extraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
        JSON.parse(storedHeaders),
      );
      if (extraHeaders) {
        window.socketio_extra_headers = extraHeaders;
        return extraHeaders;
      }
    }
  } catch (err) {
    console.warn("Unable to load Socket.IO extra headers", err);
  }
  return null;
})();
Tools.showRateLimitAlert = function showRateLimitAlert() {
  if (Tools.rateLimitAlertShown) return;
  Tools.rateLimitAlertShown = true;
  window.alert(Tools.i18n.t("rate_limit_disconnect_message"));
};

function generateUserSecret() {
  if (
    window.crypto &&
    typeof window.crypto.getRandomValues === "function" &&
    typeof Uint8Array === "function"
  ) {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(function (value) {
        return value.toString(16).padStart(2, "0");
      })
      .join("");
  }

  return (
    Date.now().toString(16) +
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  );
}

Tools.userSecret = (function resolveUserSecret() {
  var key = "wbo-user-secret-v1";
  try {
    var existing = localStorage.getItem(key);
    if (existing) return existing;
    var created = generateUserSecret();
    localStorage.setItem(key, created);
    return created;
  } catch (err) {
    return generateUserSecret();
  }
})();

Tools.getInitialSocketQuery = function getInitialSocketQuery() {
  return {
    userSecret: Tools.userSecret,
    tool: "Hand",
    color: getRequiredInput("chooseColor").value,
    size: getRequiredInput("chooseSize").value,
  };
};

Tools.connectedUsers = {};
Tools.connectedUsersPanelOpen = false;

function isCurrentSocketUser(/** @type {ConnectedUser} */ user) {
  return !!(
    Tools.socket &&
    typeof Tools.socket.id === "string" &&
    user.socketId === Tools.socket.id
  );
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toFiniteCoordinate(value) {
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getConnectedUsersToggle() {
  return BoardBootstrap.getRequiredElement("connectedUsersToggle");
}

function getConnectedUsersPanel() {
  return BoardBootstrap.getRequiredElement("connectedUsersPanel");
}

function getConnectedUsersList() {
  return BoardBootstrap.getRequiredElement("connectedUsersList");
}

/**
 * @param {number | undefined} size
 * @returns {number}
 */
function getConnectedUserDotSize(size) {
  var userSize = Number(size);
  if (!Number.isFinite(userSize) || userSize <= 0) return 8;
  return Math.max(8, Math.min(18, 6 + userSize / 3));
}

/**
 * @param {ConnectedUser} user
 * @returns {string}
 */
function getConnectedUserToolLabel(user) {
  return Tools.i18n.t(user.lastTool || "Hand");
}

/**
 * @param {ConnectedUser} user
 * @returns {boolean}
 */
function hasConnectedUserCursor(user) {
  return (
    typeof user.lastCursorX === "number" &&
    Number.isFinite(user.lastCursorX) &&
    typeof user.lastCursorY === "number" &&
    Number.isFinite(user.lastCursorY)
  );
}

/**
 * @param {ConnectedUser} user
 * @returns {void}
 */
function scheduleConnectedUserPulseEnd(user) {
  if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  if (!user.pulseUntil) {
    user.pulseTimeoutId = null;
    return;
  }
  var remainingMs = Math.max(0, user.pulseUntil - Date.now());
  user.pulseTimeoutId = setTimeout(function () {
    if (user.pulseUntil && user.pulseUntil <= Date.now()) {
      user.pulseUntil = 0;
      user.pulseTimeoutId = null;
      Tools.renderConnectedUsers();
    }
  }, remainingMs + 20);
}

/**
 * @param {ConnectedUser} user
 * @returns {void}
 */
function markConnectedUserActivity(user) {
  var now = Date.now();
  var interval = user.lastActivityAt ? now - user.lastActivityAt : 700;
  user.lastActivityAt = now;
  user.pulseMs = Math.max(160, Math.min(1200, interval));
  user.pulseUntil = now + user.pulseMs * 2;
  scheduleConnectedUserPulseEnd(user);
}

/**
 * @param {ConnectedUser} user
 * @returns {void}
 */
function focusConnectedUser(user) {
  if (!hasConnectedUserCursor(user)) return;
  var scale = Tools.getScale();
  var x = /** @type {number} */ (user.lastCursorX);
  var y = /** @type {number} */ (user.lastCursorY);
  window.scrollTo(
    Math.max(0, x * scale - window.innerWidth / 2),
    Math.max(0, y * scale - window.innerHeight / 2),
  );
}

Tools.renderConnectedUsers = function renderConnectedUsers() {
  var list = getConnectedUsersList();
  list.textContent = "";

  var users = Object.values(Tools.connectedUsers).sort(function (left, right) {
    return left.name.localeCompare(right.name);
  });

  users.forEach(function (user) {
    var row = document.createElement("li");
    row.className = "connected-user-row";
    row.dataset.socketId = user.socketId;
    row.tabIndex = hasConnectedUserCursor(user) ? 0 : -1;
    if (isCurrentSocketUser(user)) row.classList.add("connected-user-row-self");
    if (hasConnectedUserCursor(user)) {
      row.classList.add("connected-user-row-jumpable");
      row.addEventListener("click", function () {
        focusConnectedUser(user);
      });
      row.addEventListener("keydown", function (evt) {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          focusConnectedUser(user);
        }
      });
    }

    var color = document.createElement("span");
    color.className = "connected-user-color";
    color.style.backgroundColor = user.color || "#001f3f";
    var dotSize = getConnectedUserDotSize(user.size);
    color.style.width = dotSize + "px";
    color.style.height = dotSize + "px";
    if (user.pulseUntil && user.pulseUntil > Date.now()) {
      color.classList.add("active");
      color.style.setProperty("--pulse-ms", (user.pulseMs || 700) + "ms");
    }
    row.appendChild(color);

    var main = document.createElement("div");
    main.className = "connected-user-main";

    var name = document.createElement("div");
    name.className = "connected-user-name";
    name.textContent = user.name;
    main.appendChild(name);

    var meta = document.createElement("span");
    meta.className = "connected-user-meta";
    meta.textContent = getConnectedUserToolLabel(user);
    main.appendChild(meta);

    row.appendChild(main);

    if (!user.reported || isCurrentSocketUser(user)) {
      var report = document.createElement("button");
      report.type = "button";
      report.className = "connected-user-report";
      report.textContent = "!";
      report.title = Tools.i18n.t("report");
      report.setAttribute("aria-label", Tools.i18n.t("report"));
      if (isCurrentSocketUser(user)) {
        report.disabled = true;
      } else {
        report.addEventListener("click", function (evt) {
          evt.stopPropagation();
          if (!Tools.socket) return;
          user.reported = true;
          Tools.renderConnectedUsers();
          Tools.socket.emit("report_user", {
            board: Tools.boardName,
            socketId: user.socketId,
          });
        });
      }
      row.appendChild(report);
    }

    list.appendChild(row);
  });
};

Tools.setConnectedUsersPanelOpen = function setConnectedUsersPanelOpen(
  /** @type {boolean} */ open,
) {
  Tools.connectedUsersPanelOpen = open;
  getConnectedUsersPanel().classList.toggle(
    "connected-users-panel-hidden",
    !open,
  );
  getConnectedUsersToggle().classList.toggle("curTool", open);
};

Tools.upsertConnectedUser = function upsertConnectedUser(
  /** @type {ConnectedUser} */ user,
) {
  Tools.connectedUsers[user.socketId] = Object.assign(
    {},
    Tools.connectedUsers[user.socketId] || {},
    user,
  );
  Tools.renderConnectedUsers();
};

Tools.removeConnectedUser = function removeConnectedUser(
  /** @type {string} */ socketId,
) {
  var user = Tools.connectedUsers[socketId];
  if (user && user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  delete Tools.connectedUsers[socketId];
  Tools.renderConnectedUsers();
};

Tools.updateConnectedUsersFromActivity =
  function updateConnectedUsersFromActivity(
    /** @type {string | undefined} */ userId,
    /** @type {BoardMessage} */ message,
  ) {
    if (!userId) return;
  var changed = false;
  var cursorX = toFiniteCoordinate(message.x);
  var cursorY = toFiniteCoordinate(message.y);
  var cursorSocket =
    typeof message.socket === "string" ? message.socket : null;
  var shouldPulse = message.tool !== "Cursor";
  Object.values(Tools.connectedUsers).forEach(function (user) {
    if (user.userId !== userId) return;
    if (shouldPulse) {
      markConnectedUserActivity(user);
      changed = true;
    }
    if (typeof message.color === "string") {
      user.color = message.color;
      changed = true;
    }
    if (message.size !== undefined) {
      user.size = Number(message.size) || user.size;
      changed = true;
    }
    if (typeof message.tool === "string" && message.tool !== "Cursor") {
      user.lastTool = message.tool;
      changed = true;
    }
    if (
      message.tool === "Cursor" &&
      cursorX !== null &&
      cursorY !== null &&
      (cursorSocket === null || cursorSocket === user.socketId)
    ) {
      user.lastCursorX = cursorX;
      user.lastCursorY = cursorY;
      changed = true;
    }
  });
    if (changed) Tools.renderConnectedUsers();
  };

Tools.updateCurrentConnectedUserFromActivity =
  function updateCurrentConnectedUserFromActivity(
    /** @type {BoardMessage} */ message,
  ) {
    if (!Tools.socket || typeof Tools.socket.id !== "string") return;
    var current = Tools.connectedUsers[Tools.socket.id];
    if (!current) return;
    Tools.updateConnectedUsersFromActivity(current.userId, message);
  };

Tools.initConnectedUsersUI = function initConnectedUsersUI() {
  var toggle = getConnectedUsersToggle();
  var label = /** @type {HTMLElement | null} */ (
    toggle.querySelector(".tool-name")
  );
  toggle.title = Tools.i18n.t("users");
  toggle.setAttribute("aria-label", Tools.i18n.t("users"));
  if (label) label.textContent = Tools.i18n.t("users");
  toggle.addEventListener("click", function () {
    Tools.setConnectedUsersPanelOpen(!Tools.connectedUsersPanelOpen);
  });
  toggle.addEventListener("keydown", function (evt) {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      Tools.setConnectedUsersPanelOpen(!Tools.connectedUsersPanelOpen);
    }
  });
  Tools.renderConnectedUsers();
};

Tools.initConnectedUsersUI();

Tools.connect = function () {
  // Destroy socket if one already exists
  if (Tools.socket) {
    BoardConnection.closeSocket(Tools.socket);
    Tools.socket = null;
  }
  Object.values(Tools.connectedUsers).forEach(function (user) {
    if (user.pulseTimeoutId) clearTimeout(user.pulseTimeoutId);
  });
  Tools.connectedUsers = {};
  Tools.renderConnectedUsers();

  var url = new URL(window.location.href);
  var params = new URLSearchParams(url.search);
  var socketParams = BoardConnection.buildSocketParams(
    window.location.pathname,
    Tools.socketIOExtraHeaders,
    params.get("token"),
    Tools.getInitialSocketQuery(),
  );

  var socket = io.connect("", socketParams);
  Tools.socket = socket;

  //Receive draw instructions from the server
  socket.on("connect", function onConnection() {
    if (Tools.hasConnectedOnce && Tools.server_config.TURNSTILE_SITE_KEY) {
      Tools.setTurnstileValidation(null);
      BoardTurnstile.resetTurnstileWidget(
        typeof turnstile !== "undefined" ? turnstile : undefined,
        Tools.turnstileWidgetId,
      );
    }
    Tools.hasConnectedOnce = true;
    if (Tools.socket) Tools.socket.emit("getboard", Tools.boardName);
  });
  socket.on("broadcast", function (/** @type {BoardMessage} */ msg) {
    Tools.updateConnectedUsersFromActivity(
      typeof msg.userId === "string" ? msg.userId : undefined,
      msg,
    );
    handleMessage(msg).finally(function afterload() {
      var loadingEl = document.getElementById("loadingMessage");
      if (loadingEl) loadingEl.classList.add("hidden");
    });
  });
  socket.on("boardstate", Tools.setBoardState);
  socket.on(
    "user_joined",
    function onUserJoined(/** @type {ConnectedUser} */ user) {
      Tools.upsertConnectedUser(user);
    },
  );
  socket.on(
    "user_left",
    function onUserLeft(/** @type {{socketId?: string}} */ user) {
      if (typeof user.socketId !== "string") return;
      Tools.removeConnectedUser(user.socketId);
    },
  );
  socket.on("rate-limited", function onRateLimited() {
    Tools.showRateLimitAlert();
  });
};
Tools.boardName = Tools.resolveBoardName();

Tools.token = (function () {
  var url = new URL(window.location.href);
  var params = new URLSearchParams(url.search);
  return params.get("token");
})();

Tools.connect();

function saveBoardNametoLocalStorage() {
  var boardName = Tools.boardName;
  var recentBoards,
    key = "recent-boards";
  try {
    var storedBoards = localStorage.getItem(key);
    recentBoards = storedBoards ? JSON.parse(storedBoards) : [];
  } catch (e) {
    // On localstorage or json error, reset board list
    recentBoards = [];
    console.log("Board history loading error", e);
  }
  recentBoards = BoardState.updateRecentBoards(recentBoards, boardName);
  localStorage.setItem(key, JSON.stringify(recentBoards));
}
// Refresh recent boards list on each page show
window.addEventListener("pageshow", saveBoardNametoLocalStorage);

Tools.HTML = /** @type {ToolPalette} */ ({
  template: new Minitpl("#tools > .tool"),
  addShortcut: function addShortcut(key, callback) {
    window.addEventListener("keydown", function (e) {
      if (e.key === key && !isTextEntryTarget(e.target)) {
        callback();
      }
    });
  },
  addTool: function addTool(
    toolName,
    toolIcon,
    toolIconHTML,
    toolShortcut,
    oneTouch,
  ) {
    var callback = function () {
      if (!Tools.canUseTool(toolName)) return;
      Tools.change(toolName);
    };
    this.addShortcut(toolShortcut, function () {
      if (!Tools.canUseTool(toolName)) return;
      Tools.change(toolName);
      blurActiveElement();
    });
    return this.template.add(function (/** @type {HTMLElement} */ elem) {
      elem.addEventListener("click", callback);
      elem.id = "toolID-" + toolName;
      var label = /** @type {HTMLElement | undefined} */ (
        elem.getElementsByClassName("tool-name")[0]
      );
      var toolIconElem = /** @type {HTMLImageElement | undefined} */ (
        elem.getElementsByClassName("tool-icon")[0]
      );
      if (!label || !toolIconElem) {
        throw new Error("Invalid tool template structure");
      }
      label.textContent = Tools.i18n.t(toolName);
      toolIconElem.src = toolIcon;
      toolIconElem.alt = toolIcon;
      if (oneTouch) elem.classList.add("oneTouch");
      var tool = Tools.list[toolName];
      if (!tool) {
        throw new Error("Tool not registered before rendering: " + toolName);
      }
      elem.title =
        Tools.i18n.t(toolName) +
        " (" +
        Tools.i18n.t("keyboard shortcut") +
        ": " +
        toolShortcut +
        ")" +
        (tool.secondary ? " [" + Tools.i18n.t("click_to_toggle") + "]" : "");
      if (tool.secondary) {
        elem.classList.add("hasSecondary");
        var secondaryIcon = /** @type {HTMLImageElement | undefined} */ (
          elem.getElementsByClassName("secondaryIcon")[0]
        );
        if (!secondaryIcon) {
          throw new Error("Missing secondary icon for tool " + toolName);
        }
        secondaryIcon.src = tool.secondary.icon;
        toolIconElem.classList.add("primaryIcon");
      }
      Tools.syncToolDisabledState(toolName);
    });
  },
  changeTool: function (oldToolName, newToolName) {
    var oldTool = document.getElementById("toolID-" + oldToolName);
    var newTool = document.getElementById("toolID-" + newToolName);
    if (oldTool) oldTool.classList.remove("curTool");
    if (newTool) newTool.classList.add("curTool");
  },
  toggle: function toggle(toolName, name, icon) {
    var parts = getRequiredToolButtonParts(toolName);
    var secondaryIcon = parts.secondaryIcon;
    if (!secondaryIcon) {
      throw new Error("Missing secondary icon for tool " + toolName);
    }

    var primaryIconSrc = parts.primaryIcon.src;
    var secondaryIconSrc = secondaryIcon.src;
    parts.primaryIcon.src = secondaryIconSrc;
    secondaryIcon.src = primaryIconSrc;
    parts.primaryIcon.src = icon;
    parts.label.textContent = Tools.i18n.t(name);
  },
  addStylesheet: function addStylesheet(href) {
    //Adds a css stylesheet to the html or svg document
    var link = document.createElement("link");
    link.href = href;
    link.rel = "stylesheet";
    link.type = "text/css";
    document.head.appendChild(link);
  },
  colorPresetTemplate: new Minitpl("#colorPresetSel .colorPresetButton"),
  addColorButton: function addColorButton(button) {
    var setColor = Tools.setColor.bind(Tools, button.color);
    if (button.key) this.addShortcut(button.key, setColor);
    return this.colorPresetTemplate.add(
      function (/** @type {HTMLElement} */ elem) {
        elem.addEventListener("click", setColor);
        elem.id = "color_" + button.color.replace(/^#/, "");
        elem.style.backgroundColor = button.color;
        if (button.key) {
          elem.title = Tools.i18n.t("keyboard shortcut") + ": " + button.key;
        }
      },
    );
  },
});

Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

/** @param {AppTool} tool */
Tools.isBlocked = function toolIsBanned(tool) {
  return BoardTools.isBlockedToolName(
    tool.name,
    Tools.server_config.BLOCKED_TOOLS || [],
  );
};

/**
 * Register a new tool, without touching the User Interface
 */
/** @param {AppTool} newTool */
Tools.register = function registerTool(newTool) {
  if (Tools.isBlocked(newTool)) return;

  if (newTool.name in Tools.list) {
    console.log(
      "Tools.add: The tool '" +
        newTool.name +
        "' is already" +
        "in the list. Updating it...",
    );
  }

  //Format the new tool correctly
  Tools.applyHooks(Tools.toolHooks, newTool);

  //Add the tool to the list
  Tools.list[newTool.name] = newTool;

  // Register the change handlers
  if (newTool.onSizeChange) Tools.sizeChangeHandlers.push(newTool.onSizeChange);

  //There may be pending messages for the tool
  var pending = BoardTools.drainPendingMessages(
    Tools.pendingMessages,
    newTool.name,
  );
  if (pending.length > 0) {
    console.log("Drawing pending messages for '%s'.", newTool.name);
    pending.forEach(function (/** @type {BoardMessage} */ msg) {
      //Transmit the message to the tool (precising that it comes from the network)
      newTool.draw(msg, false);
    });
  }
};

/**
 * Add a new tool to the user interface
 */
/** @param {AppTool} newTool */
Tools.add = function (newTool) {
  if (Tools.isBlocked(newTool)) return;

  Tools.register(newTool);

  if (newTool.stylesheet) {
    Tools.HTML.addStylesheet(newTool.stylesheet);
  }

  //Add the tool to the GUI
  if (Tools.shouldDisplayTool(newTool.name)) {
    Tools.HTML.addTool(
      newTool.name,
      newTool.icon,
      newTool.iconHTML,
      newTool.shortcut || "",
      newTool.oneTouch,
    );
  }

  Tools.syncToolDisabledState(newTool.name);
};

/** @param {string} toolName */
Tools.change = function (toolName) {
  var newTool = Tools.list[toolName];
  var oldTool = Tools.curTool;
  if (!newTool)
    throw new Error("Trying to select a tool that has never been added!");
  if (Tools.shouldDisableTool(toolName)) return false;
  if (newTool === oldTool) {
    if (newTool.secondary) {
      newTool.secondary.active = !newTool.secondary.active;
      var props = newTool.secondary.active ? newTool.secondary : newTool;
      Tools.HTML.toggle(newTool.name, props.name, props.icon);
      if (newTool.secondary.switch) newTool.secondary.switch();
    }
    return;
  }
  if (!newTool.oneTouch) {
    //Update the GUI
    var curToolName = Tools.curTool ? Tools.curTool.name : "";
    try {
      Tools.HTML.changeTool(curToolName, toolName);
    } catch (e) {
      console.error("Unable to update the GUI with the new tool. " + e);
    }
    Tools.svg.style.cursor = newTool.mouseCursor || "auto";
    Tools.board.title = Tools.i18n.t(newTool.helpText || "");

    //There is not necessarily already a curTool
    if (Tools.curTool !== null) {
      //It's useless to do anything if the new tool is already selected
      if (newTool === Tools.curTool) return;

      //Remove the old event listeners
      Tools.removeToolListeners(Tools.curTool);

      //Call the callbacks of the old tool
      Tools.curTool.onquit && Tools.curTool.onquit(newTool);
    }

    //Add the new event listeners
    Tools.addToolListeners(newTool);
    Tools.curTool = newTool;
  }

  //Call the start callback of the new tool
  if (newTool.onstart) newTool.onstart(oldTool);
  return true;
};

/** @param {AppTool} tool */
Tools.addToolListeners = function addToolListeners(tool) {
  if (!tool.compiledListeners) return;
  for (var event in tool.compiledListeners) {
    var listener = tool.compiledListeners[event];
    if (!listener) continue;
    var target = listener.target || Tools.board;
    target.addEventListener(event, listener, { passive: false });
  }
};

/** @param {AppTool} tool */
Tools.removeToolListeners = function removeToolListeners(tool) {
  if (!tool.compiledListeners) return;
  for (var event in tool.compiledListeners) {
    var listener = tool.compiledListeners[event];
    if (!listener) continue;
    var target = listener.target || Tools.board;
    target.removeEventListener(event, listener);
    // also attempt to remove with capture = true in IE
    if (Tools.isIE) target.removeEventListener(event, listener, true);
  }
};

(function () {
  // Handle secondary tool switch with shift (key code 16)
  /**
   * @param {boolean} active
   * @param {KeyboardEvent} evt
   */
  function handleShift(active, evt) {
    if (
      evt.keyCode === 16 &&
      Tools.curTool &&
      Tools.curTool.secondary &&
      Tools.curTool.secondary.active !== active
    ) {
      Tools.change(Tools.curTool.name);
    }
  }
  window.addEventListener("keydown", handleShift.bind(null, true));
  window.addEventListener("keyup", handleShift.bind(null, false));
})();

/**
 * @param {BoardMessage} data
 * @param {string | undefined} toolName
 */
Tools.send = function (data, toolName) {
  if (!toolName) {
    if (!Tools.curTool) throw new Error("No current tool selected");
    toolName = Tools.curTool.name;
  }
  data.tool = toolName;
  Tools.applyHooks(Tools.messageHooks, data);
  var message = {
    board: Tools.boardName,
    data: data,
  };
  if (!Tools.socket) throw new Error("Socket is not connected");
  Tools.updateCurrentConnectedUserFromActivity(data);
  Tools.socket.emit("broadcast", message);
};

/**
 * @param {BoardMessage} data
 * @param {AppTool | null | undefined} tool
 */
Tools.drawAndSend = function (data, tool) {
  if (tool == null) tool = Tools.curTool;
  if (!tool) throw new Error("No active tool available");
  if (tool && Tools.shouldDisableTool(tool.name)) return false;

  // Optimistically render the drawing immediately
  tool.draw(data, true);

  if (
    MessageCommon.requiresTurnstile(Tools.boardName, tool.name) &&
    Tools.server_config.TURNSTILE_SITE_KEY &&
    !Tools.isTurnstileValidated()
  ) {
    Tools.queueProtectedWrite(data, tool);
    return;
  }

  Tools.send(data, tool.name);
  return true;
};

//Object containing the messages that have been received before the corresponding tool
//is loaded. keys : the name of the tool, values : array of messages for this tool
Tools.pendingMessages = {};

/**
 * Send a message to the corresponding tool.
 * @param {BoardMessage} message
 * @returns {void}
 */
function messageForTool(message) {
  var name = message.tool,
    tool = name ? Tools.list[name] : undefined;

  if (tool) {
    Tools.applyHooks(Tools.messageHooks, message);
    tool.draw(message, false);
  } else {
    ///We received a message destinated to a tool that we don't have
    //So we add it to the pending messages
    if (name)
      BoardMessages.queuePendingMessage(Tools.pendingMessages, name, message);
  }

  if (message.tool !== "Hand" && message.transform != null) {
    //this message has special info for the mover
    messageForTool({
      tool: "Hand",
      type: "update",
      transform: message.transform,
      id: message.id,
    });
  }
}

/**
 * Call messageForTool recursively on the message and its children.
 * @param {BoardMessage} message
 * @returns {Promise<void>}
 */
function handleMessage(message) {
  //Check if the message is in the expected format
  if (!message.tool && !message._children) {
    console.error("Received a badly formatted message (no tool). ", message);
  }
  if (message.tool) messageForTool(message);
  if (BoardMessages.hasChildMessages(message))
    return BoardMessages.batchCall(
      childMessageHandler(message),
      message._children,
    );
  if (message._children) {
    console.error(
      "Received a badly formatted message (_children must be an array). ",
      message,
    );
    return Promise.resolve();
  }
  return Promise.resolve();
}

/**
 * Takes a parent message, and returns a function that will handle a single child message.
 * @param {BoardMessage} parent
 * @returns {(child: BoardMessage) => Promise<void>}
 */
function childMessageHandler(parent) {
  if (!parent.id) return handleMessage;
  return function handleChild(child) {
    return handleMessage(BoardMessages.normalizeChildMessage(parent, child));
  };
}

Tools.unreadMessagesCount = 0;
Tools.newUnreadMessage = function () {
  Tools.unreadMessagesCount++;
  updateDocumentTitle();
};

window.addEventListener("focus", function () {
  Tools.unreadMessagesCount = 0;
  updateDocumentTitle();
});

function updateDocumentTitle() {
  document.title =
    (Tools.unreadMessagesCount ? "(" + Tools.unreadMessagesCount + ") " : "") +
    Tools.boardName +
    " | WBO";
}

(function () {
  // Scroll and hash handling
  /** @type {ReturnType<typeof setTimeout> | null} */
  var scrollTimeout = null,
    lastStateUpdate = Date.now();

  window.addEventListener("scroll", function onScroll() {
    var scale = Tools.getScale();
    var x = document.documentElement.scrollLeft / scale,
      y = document.documentElement.scrollTop / scale;

    if (scrollTimeout !== null) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function updateHistory() {
      var hash =
        "#" + (x | 0) + "," + (y | 0) + "," + Tools.getScale().toFixed(1);
      if (
        Date.now() - lastStateUpdate > 5000 &&
        hash !== window.location.hash
      ) {
        window.history.pushState({}, "", hash);
        lastStateUpdate = Date.now();
      } else {
        window.history.replaceState({}, "", hash);
      }
    }, 100);
  });

  function setScrollFromHash() {
    var coords = window.location.hash.slice(1).split(",");
    var x = Number(coords[0]) || 0;
    var y = Number(coords[1]) || 0;
    var scale = Number.parseFloat(coords[2] || "");
    resizeCanvas({ x: x, y: y });
    Tools.setScale(scale);
    window.scrollTo(x * scale, y * scale);
  }

  window.addEventListener("hashchange", setScrollFromHash, false);
  window.addEventListener("popstate", setScrollFromHash, false);
  window.addEventListener("DOMContentLoaded", setScrollFromHash, false);
})();

/** @param {BoardMessage} m */
function resizeCanvas(m) {
  //Enlarge the canvas whenever something is drawn near its border
  var x = Number(m.x) | 0,
    y = Number(m.y) | 0;
  var MAX_BOARD_SIZE = Tools.server_config.MAX_BOARD_SIZE || 65536; // Maximum value for any x or y on the board
  if (x > Tools.svg.width.baseVal.value - 2000) {
    Tools.svg.width.baseVal.value = Math.min(x + 2000, MAX_BOARD_SIZE);
  }
  if (y > Tools.svg.height.baseVal.value - 2000) {
    Tools.svg.height.baseVal.value = Math.min(y + 2000, MAX_BOARD_SIZE);
  }
}

/** @param {BoardMessage} m */
function updateUnreadCount(m) {
  if (
    document.hidden &&
    ["child", "update"].indexOf(typeof m.type === "string" ? m.type : "") === -1
  ) {
    Tools.newUnreadMessage();
  }
}

// List of hook functions that will be applied to messages before sending or drawing them
Tools.messageHooks = [resizeCanvas, updateUnreadCount];

/** @type {ReturnType<typeof setTimeout> | null} */
var scaleTimeout = null;
/** @param {number} scale */
Tools.setScale = function setScale(scale) {
  var fullScale =
    Math.max(window.innerWidth, window.innerHeight) /
    (Number(Tools.server_config.MAX_BOARD_SIZE) || 65536);
  var minScale = Math.max(0.1, fullScale);
  var maxScale = 10;
  if (isNaN(scale)) scale = 1;
  scale = Math.max(minScale, Math.min(maxScale, scale));
  Tools.svg.style.willChange = "transform";
  Tools.svg.style.transform = "scale(" + scale + ")";
  if (scaleTimeout !== null) clearTimeout(scaleTimeout);
  scaleTimeout = setTimeout(function () {
    Tools.svg.style.willChange = "auto";
  }, 1000);
  Tools.scale = scale;
  Tools.syncDrawToolAvailability(false);
  return scale;
};
Tools.getScale = function getScale() {
  return Tools.scale;
};

//List of hook functions that will be applied to tools before adding them
Tools.toolHooks = [
  /** @param {AppTool} tool */
  function checkToolAttributes(tool) {
    if (typeof tool.name !== "string") throw "A tool must have a name";
    if (typeof tool.listeners !== "object") {
      tool.listeners = {};
    }
    if (typeof tool.onstart !== "function") {
      tool.onstart = function () {};
    }
    if (typeof tool.onquit !== "function") {
      tool.onquit = function () {};
    }
  },
  /** @param {AppTool} tool */
  function compileListeners(tool) {
    //compile listeners into compiledListeners
    var listeners = tool.listeners || {};

    //A tool may provide precompiled listeners
    var compiled = tool.compiledListeners || {};
    tool.compiledListeners = compiled;

    /**
     * @param {ToolPointerListener} listener
     * @returns {CompiledToolListener}
     */
    function compile(listener) {
      //closure
      return function listen(evt) {
        var mouseEvent = /** @type {MouseEvent} */ (evt);
        var x = mouseEvent.pageX / Tools.getScale(),
          y = mouseEvent.pageY / Tools.getScale();
        return listener(x, y, mouseEvent, false);
      };
    }

    /**
     * @param {ToolPointerListener} listener
     * @returns {CompiledToolListener}
     */
    function compileTouch(listener) {
      //closure
      return function touchListen(evt) {
        var touchEvent = /** @type {TouchEvent} */ (evt);
        //Currently, we don't handle multitouch
        if (touchEvent.changedTouches.length === 1) {
          //evt.preventDefault();
          var touch = touchEvent.changedTouches[0];
          if (!touch) return true;
          var x = touch.pageX / Tools.getScale(),
            y = touch.pageY / Tools.getScale();
          return listener(x, y, touchEvent, true);
        }
        return true;
      };
    }

    /**
     * @param {CompiledToolListener} f
     * @returns {CompiledToolListener}
     */
    function wrapUnsetHover(f) {
      return function unsetHover(evt) {
        blurActiveElement();
        return f(evt);
      };
    }

    if (listeners.press) {
      compiled["mousedown"] = wrapUnsetHover(compile(listeners.press));
      compiled["touchstart"] = wrapUnsetHover(compileTouch(listeners.press));
    }
    if (listeners.move) {
      compiled["mousemove"] = compile(listeners.move);
      compiled["touchmove"] = compileTouch(listeners.move);
    }
    if (listeners.release) {
      var release = compile(listeners.release),
        releaseTouch = compileTouch(listeners.release);
      compiled["mouseup"] = release;
      if (!Tools.isIE) compiled["mouseleave"] = release;
      compiled["touchleave"] = releaseTouch;
      compiled["touchend"] = releaseTouch;
      compiled["touchcancel"] = releaseTouch;
    }
  },
];

/**
 * @template T
 * @param {((value: T) => void)[]} hooks
 * @param {T} object
 * @returns {void}
 */
Tools.applyHooks = function applyHooks(hooks, object) {
  //Apply every hooks on the object
  hooks.forEach(function (hook) {
    hook(object);
  });
};

// Utility functions

/**
 * @param {string | undefined} prefix
 * @param {string | undefined} suffix
 */
Tools.generateUID = function generateUID(prefix, suffix) {
  var uid = Date.now().toString(36); //Create the uids in chronological order
  uid += Math.round(Math.random() * 36).toString(36); //Add a random character at the end
  if (prefix) uid = prefix + uid;
  if (suffix) uid = uid + suffix;
  return uid;
};

/**
 * @param {string} name
 * @param {{[key: string]: string | number} | undefined} attrs
 * @returns {SVGElement}
 */
Tools.createSVGElement = function createSVGElement(name, attrs) {
  var elem = /** @type {SVGElement} */ (
    document.createElementNS(Tools.svg.namespaceURI, name)
  );
  if (!attrs || typeof attrs !== "object") return elem;
  Object.keys(attrs).forEach(function (key) {
    elem.setAttributeNS(null, key, String(attrs[key]));
  });
  return elem;
};

/**
 * @param {HTMLElement} elem
 * @param {number} x
 * @param {number} y
 */
Tools.positionElement = function positionElement(elem, x, y) {
  elem.style.top = y + "px";
  elem.style.left = x + "px";
};

Tools.colorPresets = [
  { color: "#001f3f", key: "1" },
  { color: "#FF4136", key: "2" },
  { color: "#0074D9", key: "3" },
  { color: "#FF851B", key: "4" },
  { color: "#FFDC00", key: "5" },
  { color: "#3D9970", key: "6" },
  { color: "#91E99B", key: "7" },
  { color: "#90468b", key: "8" },
  { color: "#7FDBFF", key: "9" },
  { color: "#AAAAAA", key: "0" },
  { color: "#E65194" },
];

Tools.color_chooser = getRequiredInput("chooseColor");

/** @param {string} color */
Tools.setColor = function setColor(color) {
  Tools.color_chooser.value = color;
};

Tools.getColor = (function color() {
  var color_index = (Math.random() * Tools.colorPresets.length) | 0;
  var initialPreset = Tools.colorPresets[color_index] ||
    Tools.colorPresets[0] || { color: "#001f3f" };
  var initial_color = initialPreset.color;
  Tools.setColor(initial_color);
  return function () {
    return Tools.color_chooser.value;
  };
})();

Tools.colorPresets.forEach(Tools.HTML.addColorButton.bind(Tools.HTML));

Tools.sizeChangeHandlers = [];
Tools.setSize = (function size() {
  var chooser = getRequiredInput("chooseSize");

  function update() {
    var size = MessageCommon.clampSize(chooser.value);
    chooser.value = String(size);
    Tools.sizeChangeHandlers.forEach(function (handler) {
      handler(size);
    });
  }
  update();

  chooser.onchange = chooser.oninput = update;
  /**
   * @param {number | string | null | undefined} value
   * @returns {number}
   */
  return function (value) {
    if (value !== null && value !== undefined) {
      chooser.value = String(value);
      update();
    }
    return parseInt(chooser.value);
  };
})();

Tools.getSize = function () {
  return Tools.setSize();
};

Tools.getOpacity = (function opacity() {
  var chooser = getRequiredInput("chooseOpacity");
  var opacityIndicator = BoardBootstrap.getRequiredElement("opacityIndicator");

  function update() {
    chooser.value = String(MessageCommon.clampOpacity(chooser.value));
    opacityIndicator.setAttribute("opacity", chooser.value);
  }
  update();

  chooser.onchange = chooser.oninput = update;
  return function () {
    return MessageCommon.clampOpacity(chooser.value);
  };
})();

//Scale the canvas on load
Tools.svg.width.baseVal.value = document.body.clientWidth;
Tools.svg.height.baseVal.value = document.body.clientHeight;

/**
 What does a "tool" object look like?
 newtool = {
	  "name" : "SuperTool",
	  "listeners" : {
			"press" : function(x,y,evt){...},
			"move" : function(x,y,evt){...},
			"release" : function(x,y,evt){...},
	  },
	  "draw" : function(data, isLocal){
			//Print the data on Tools.svg
	  },
	  "onstart" : function(oldTool){...},
	  "onquit" : function(newTool){...},
	  "stylesheet" : "style.css",
}
*/

(function () {
  var pos = { top: 0, scroll: 0 };
  var menu = BoardBootstrap.getRequiredElement("menu");
  /** @param {MouseEvent} evt */
  function menu_mousedown(evt) {
    pos = {
      top: menu.scrollTop,
      scroll: evt.clientY,
    };
    menu.addEventListener("mousemove", menu_mousemove);
    document.addEventListener("mouseup", menu_mouseup);
  }
  /** @param {MouseEvent} evt */
  function menu_mousemove(evt) {
    var dy = evt.clientY - pos.scroll;
    menu.scrollTop = pos.top - dy;
  }
  /** @param {MouseEvent} evt */
  function menu_mouseup(evt) {
    menu.removeEventListener("mousemove", menu_mousemove);
    document.removeEventListener("mouseup", menu_mouseup);
  }
  menu.addEventListener("mousedown", menu_mousedown);
})();
