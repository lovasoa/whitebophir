import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import MessageCommon from "./message_common.js";
import { SocketEvents } from "./socket_events.js";

/** @typedef {import("../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../types/app-runtime").ClientTrackedMessage} ClientTrackedMessage */
/** @typedef {import("../../types/app-runtime").PendingWrite} PendingWrite */
/** @typedef {import("../../types/app-runtime").TurnstileAck} TurnstileAck */
/** @typedef {import("../../types/app-runtime").TurnstileGlobal} TurnstileGlobal */
/** @typedef {{logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void}} TurnstileModuleOptions */

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_ACK_TIMEOUT_MS = 10_000;
const TURNSTILE_RETRY_DELAY_MS = 1_500;
const PENDING_WRITE_PRESERVED =
  "Your pending write is preserved while the client retries.";

/** @type {Promise<TurnstileGlobal> | null} */
let turnstileScriptPromise = null;

/**
 * @returns {TurnstileGlobal | undefined}
 */
function getTurnstileApi() {
  return typeof turnstile !== "undefined" ? turnstile : undefined;
}

/**
 * @param {unknown} result
 * @param {number | undefined} defaultValidationWindowMs
 * @returns {TurnstileAck}
 */
function normalizeTurnstileAck(result, defaultValidationWindowMs) {
  if (result === true) {
    return {
      success: true,
      validationWindowMs: defaultValidationWindowMs,
      validatedUntil: Date.now() + Number(defaultValidationWindowMs || 0),
    };
  }
  if (result && typeof result === "object") {
    return /** @type {TurnstileAck} */ (result);
  }
  return { success: false };
}

/**
 * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logBoardEvent
 * @returns {Promise<TurnstileGlobal>}
 */
function loadTurnstileScript(logBoardEvent) {
  const api = getTurnstileApi();
  if (api) return Promise.resolve(api);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    logBoardEvent("log", "turnstile.script_loading");
    script.addEventListener(
      "load",
      () => {
        const loadedApi = getTurnstileApi();
        if (loadedApi) {
          logBoardEvent("log", "turnstile.script_loaded");
          resolve(loadedApi);
          return;
        }
        turnstileScriptPromise = null;
        script.remove();
        reject(new Error("Turnstile API unavailable after script load."));
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        turnstileScriptPromise = null;
        script.remove();
        reject(new Error("Turnstile script failed to load."));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

const turnstileModuleState = new WeakMap();

export class TurnstileModule {
  /**
   * @param {AppToolsState} Tools
   * @param {TurnstileModuleOptions} options
   */
  constructor(Tools, options) {
    this.validatedUntil = 0;
    this.widgetId = /** @type {unknown | null} */ (null);
    this.activeToolGesture = false;
    this.retryTimeout = null;
    this.pending = false;
    this.pendingWrites = /** @type {PendingWrite[]} */ ([]);
    this.interactive = false;
    this.overlay = /** @type {HTMLElement | null} */ (null);
    turnstileModuleState.set(this, { Tools, ...options });
  }

  isValidated() {
    return this.validatedUntil > Date.now();
  }

  /** @param {string} toolName */
  needsValidation(toolName) {
    const { Tools } = getTurnstileModuleState(this);
    return (
      !!Tools.config.serverConfig.TURNSTILE_SITE_KEY &&
      Tools.access.canClear !== true &&
      MessageCommon.requiresTurnstile(Tools.identity.boardName, toolName) &&
      !this.isValidated()
    );
  }

  needsSelectedToolValidation() {
    const { Tools } = getTurnstileModuleState(this);
    const tool = Tools.toolRegistry.current;
    return (
      !!tool?.requiredCapability &&
      this.needsValidation(tool.name) &&
      Tools.toolRegistry.canInteractWithTool(tool.name)
    );
  }

  hasChallengeDemand() {
    return this.pendingWrites.length > 0 || this.needsSelectedToolValidation();
  }

  requestSelectedToolValidation() {
    const needed = this.needsSelectedToolValidation();
    if (needed && !this.retryTimeout) this.refresh();
    if (!needed && this.pendingWrites.length === 0) this.hideOverlay();
    return needed;
  }

  // If validation expires during a stroke, queue its edits until release.
  startToolGesture() {
    this.activeToolGesture = true;
  }

  finishToolGesture() {
    if (!this.activeToolGesture) return;
    this.activeToolGesture = false;
    if (this.pendingWrites.length > 0) this.refresh();
  }

  clearRetryTimeout() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  resetConnection() {
    this.validatedUntil = 0;
    this.pending = false;
    this.activeToolGesture = false;
    this.interactive = false;
    this.pendingWrites = [];
    this.clearRetryTimeout();
    this.hideOverlay();
  }

  /**
   * @param {string} reason
   * @param {number=} [delayMs]
   */
  scheduleRetry(reason, delayMs = TURNSTILE_RETRY_DELAY_MS) {
    const { logBoardEvent } = getTurnstileModuleState(this);
    if (!this.hasChallengeDemand()) return;
    this.clearRetryTimeout();
    logBoardEvent("warn", "turnstile.retry_scheduled", {
      reason,
      delayMs,
    });
    this.retryTimeout = window.setTimeout(() => {
      this.retryTimeout = null;
      this.refresh();
    }, delayMs);
  }

  /** @param {unknown} result */
  setValidation(result) {
    const { Tools } = getTurnstileModuleState(this);
    const ack = this.normalizeAck(result);
    this.validatedUntil = 0;
    if (ack.success !== true) return;

    const validationWindowMs =
      Number(ack.validationWindowMs) ||
      Number(Tools.config.serverConfig.TURNSTILE_VALIDATION_WINDOW_MS) ||
      0;
    const safetyMarginMs = Math.min(5000, Math.floor(validationWindowMs / 2));
    const safeWindowMs = validationWindowMs - safetyMarginMs;
    if (safeWindowMs > 0) this.validatedUntil = Date.now() + safeWindowMs;
    this.clearRetryTimeout();
  }

  /** @param {unknown} result */
  normalizeAck(result) {
    const { Tools } = getTurnstileModuleState(this);
    return normalizeTurnstileAck(
      result,
      Number(Tools.config.serverConfig.TURNSTILE_VALIDATION_WINDOW_MS),
    );
  }

  ensureElements() {
    if (this.overlay) return this.overlay;
    const overlay = document.createElement("div");
    overlay.id = "turnstile-overlay";
    overlay.className = "wbo-modal-backdrop turnstile-overlay-hidden";
    const panel = document.createElement("div");
    panel.id = "turnstile-modal";
    panel.className = "wbo-dialog";
    panel.dir =
      document.documentElement.dataset.uiDirection === "rtl" ? "rtl" : "ltr";
    const widget = document.createElement("div");
    widget.id = "turnstile-widget";
    panel.appendChild(widget);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }

  showOverlay() {
    this.ensureElements().classList.remove("turnstile-overlay-hidden");
  }

  hideOverlay() {
    this.overlay?.classList.add("turnstile-overlay-hidden");
  }

  refresh() {
    const { logBoardEvent } = getTurnstileModuleState(this);
    if (this.activeToolGesture || !this.hasChallengeDemand()) return;
    if (this.pending) {
      if (this.interactive) this.showOverlay();
      return;
    }
    this.interactive = false;
    this.ensureElements();
    this.clearRetryTimeout();

    const api = getTurnstileApi();
    if (api) {
      if (this.widgetId === null) renderTurnstileWidget(this, api);
      else resetTurnstileChallenge(this, api);
      return;
    }
    if (turnstileScriptPromise) return;

    logBoardEvent("warn", "turnstile.script_unavailable");
    void loadTurnstileScript(logBoardEvent)
      .then(() => {
        this.refresh();
      })
      .catch((error) => {
        logBoardEvent("error", "turnstile.script_load_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        showTurnstileFailureStatus(this, "Security check could not load.");
        this.scheduleRetry("script_load_failed");
      });
  }

  /** @param {ClientTrackedMessage} data */
  queueProtectedWrite(data) {
    const { logBoardEvent } = getTurnstileModuleState(this);
    const hadPendingWrites = this.pendingWrites.length > 0;
    this.pendingWrites.push({ data });
    if (hadPendingWrites) return;
    const toolName = TOOL_ID_BY_CODE[data.tool];
    logBoardEvent("log", "turnstile.write_queued", {
      toolName,
      clientMutationId: data.clientMutationId,
    });
    this.refresh();
  }

  flushPendingWrites() {
    const { Tools, logBoardEvent } = getTurnstileModuleState(this);
    const pendingWrites = this.pendingWrites;
    this.pendingWrites = [];
    logBoardEvent("log", "turnstile.write_flush", {
      count: pendingWrites.length,
    });
    Tools.status.clearBoardStatus();
    pendingWrites.forEach(function replayPendingWrite(write) {
      const pendingWrite = /** @type {PendingWrite} */ (write);
      Tools.writes.send(pendingWrite.data);
    });
  }
}

/**
 * @param {TurnstileModule} module
 * @returns {{Tools: AppToolsState} & TurnstileModuleOptions}
 */
function getTurnstileModuleState(module) {
  return /** @type {{Tools: AppToolsState} & TurnstileModuleOptions} */ (
    turnstileModuleState.get(module)
  );
}

/**
 * @param {TurnstileModule} module
 * @param {string} reason
 */
function showTurnstileFailureStatus(module, reason) {
  if (!module.hasChallengeDemand()) return;
  const { Tools } = getTurnstileModuleState(module);
  Tools.status.showBoardStatus({
    hidden: false,
    state: "paused",
    title: `${Tools.i18n.t("turnstile_status_prefix")} ${reason}`,
    detail: module.pendingWrites.length > 0 ? PENDING_WRITE_PRESERVED : "",
  });
}

/**
 * @param {TurnstileModule} module
 * @param {unknown} errorCode
 */
function handleTurnstileError(module, errorCode) {
  const { logBoardEvent } = getTurnstileModuleState(module);
  const detailPrefix =
    typeof errorCode === "string" && errorCode
      ? `Security check failed (${errorCode}).`
      : "Security check failed.";
  logBoardEvent("error", "turnstile.error", {
    errorCode,
  });
  showTurnstileFailureStatus(module, detailPrefix);
  module.scheduleRetry("widget_error");
}

/**
 * @param {TurnstileModule} module
 * @param {string} token
 * @returns {Promise<unknown>}
 */
function emitTurnstileToken(module, token) {
  const { Tools } = getTurnstileModuleState(module);
  return new Promise((resolve, reject) => {
    const socket = Tools.connection.socket;
    if (!socket) {
      reject(new Error("Socket unavailable while submitting Turnstile token."));
      return;
    }
    const timeoutId = setTimeout(() => {
      reject(new Error("Timed out waiting for Turnstile acknowledgement."));
    }, TURNSTILE_ACK_TIMEOUT_MS);

    try {
      socket.emit(
        SocketEvents.TURNSTILE_TOKEN,
        token,
        (/** @type {unknown} */ result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
      );
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

/**
 * @param {TurnstileModule} module
 * @param {string} token
 * @returns {Promise<void>}
 */
async function submitTurnstileToken(module, token) {
  const { Tools, logBoardEvent } = getTurnstileModuleState(module);
  const generation = Tools.connection.generation;
  try {
    const result = await emitTurnstileToken(module, token);
    if (generation !== Tools.connection.generation) return;
    const turnstileResult = module.normalizeAck(result);
    module.pending = false;
    if (turnstileResult.success) {
      logBoardEvent("log", "turnstile.submit_succeeded");
      module.setValidation(turnstileResult);
      module.hideOverlay();
      module.flushPendingWrites();
      return;
    }
    logBoardEvent("warn", "turnstile.submit_rejected", {
      result: turnstileResult,
    });
  } catch (error) {
    if (generation !== Tools.connection.generation) return;
    module.pending = false;
    module.setValidation(null);
    logBoardEvent("error", "turnstile.submit_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    showTurnstileFailureStatus(module, "Security check could not be verified.");
    module.scheduleRetry("submit_failed");
    return;
  }

  module.setValidation(null);
  showTurnstileFailureStatus(module, "Security check was not accepted.");
  module.scheduleRetry("submit_rejected");
}

/**
 * @param {TurnstileModule} module
 * @param {TurnstileGlobal} api
 */
function renderTurnstileWidget(module, api) {
  const { Tools, logBoardEvent } = getTurnstileModuleState(module);
  try {
    module.pending = true;
    module.widgetId = api.render("#turnstile-widget", {
      sitekey: Tools.config.serverConfig.TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      theme: "light",
      "refresh-expired": "manual",
      /** @param {string} token */
      callback: (token) => {
        if (!Tools.connection.socket?.connected) {
          module.pending = false;
          logBoardEvent("warn", "turnstile.submit_skipped", {
            reason: "socket_unavailable",
          });
          module.scheduleRetry("socket_unavailable");
          return;
        }
        void submitTurnstileToken(module, token);
      },
      "before-interactive-callback": () => {
        module.interactive = true;
        if (!module.hasChallengeDemand()) return;
        logBoardEvent("log", "turnstile.widget_shown");
        module.showOverlay();
      },
      "after-interactive-callback": () => {
        if (module.isValidated()) module.hideOverlay();
      },
      "error-callback": (/** @type {unknown} */ err) => {
        module.pending = false;
        module.setValidation(null);
        handleTurnstileError(module, err);
      },
      "timeout-callback": () => {
        module.pending = false;
        module.setValidation(null);
        logBoardEvent("warn", "turnstile.widget_timeout");
        showTurnstileFailureStatus(module, "Security check timed out.");
        module.scheduleRetry("widget_timeout");
      },
      "expired-callback": () => {
        module.pending = false;
        module.setValidation(null);
        logBoardEvent("warn", "turnstile.widget_expired");
        module.scheduleRetry("widget_expired");
      },
    });
  } catch (error) {
    module.pending = false;
    module.widgetId = null;
    logBoardEvent("error", "turnstile.render_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    showTurnstileFailureStatus(module, "Security check could not start.");
    module.scheduleRetry("render_failed");
  }
}

/**
 * @param {TurnstileModule} module
 * @param {TurnstileGlobal} api
 */
function resetTurnstileChallenge(module, api) {
  const { logBoardEvent } = getTurnstileModuleState(module);
  try {
    module.pending = true;
    api.reset(module.widgetId);
  } catch (error) {
    module.pending = false;
    logBoardEvent("error", "turnstile.reset_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    showTurnstileFailureStatus(module, "Security check could not reset.");
    module.scheduleRetry("reset_failed");
  }
}
