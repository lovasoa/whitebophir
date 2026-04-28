import { SocketEvents } from "./socket_events.js";

/** @typedef {import("../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../types/app-runtime").ClientTrackedMessage} ClientTrackedMessage */
/** @typedef {import("../../types/app-runtime").PendingWrite} PendingWrite */
/** @typedef {import("../../types/app-runtime").TurnstileAck} TurnstileAck */
/** @typedef {import("../../types/app-runtime").TurnstileGlobal} TurnstileGlobal */
/** @typedef {{logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void, queueProtectedWrite: (data: ClientTrackedMessage) => void, flushPendingWrites: () => void}} TurnstileModuleOptions */

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_ACK_TIMEOUT_MS = 10_000;
const TURNSTILE_RETRY_DELAY_MS = 1_500;

/** @type {Promise<TurnstileGlobal> | null} */
let turnstileScriptPromise = null;

/**
 * @returns {TurnstileGlobal | undefined}
 */
export function getTurnstileApi() {
  return typeof turnstile !== "undefined" ? turnstile : undefined;
}

/**
 * @param {unknown} result
 * @param {number | undefined} defaultValidationWindowMs
 * @returns {TurnstileAck}
 */
export function normalizeTurnstileAck(result, defaultValidationWindowMs) {
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
 * @param {unknown} result
 * @param {number | undefined} defaultValidationWindowMs
 * @returns {{validatedUntil: number, validationWindowMs: number}}
 */
export function computeTurnstileValidation(result, defaultValidationWindowMs) {
  const ack = normalizeTurnstileAck(result, defaultValidationWindowMs);
  if (ack.success !== true) {
    return { validatedUntil: 0, validationWindowMs: 0 };
  }
  const validationWindowMs =
    Number(ack.validationWindowMs) || Number(defaultValidationWindowMs) || 0;
  const safeWindowMs = Math.max(0, validationWindowMs - 5000);
  return {
    validatedUntil: safeWindowMs > 0 ? Date.now() + safeWindowMs : 0,
    validationWindowMs: validationWindowMs,
  };
}

/**
 * @param {unknown} api
 * @param {unknown} widgetId
 * @returns {boolean}
 */
export function resetTurnstileWidget(api, widgetId) {
  if (
    api &&
    typeof api === "object" &&
    "reset" in api &&
    typeof api.reset === "function" &&
    widgetId !== null &&
    widgetId !== undefined
  ) {
    api.reset(widgetId);
    return true;
  }
  return false;
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
    this.refreshTimeout = null;
    this.retryTimeout = null;
    this.pending = false;
    this.pendingWrites = /** @type {PendingWrite[]} */ ([]);
    this.overlayTimeout = null;
    turnstileModuleState.set(this, { Tools, ...options });
  }

  isValidated() {
    return this.validatedUntil > Date.now();
  }

  clearRefreshTimeout() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  clearRetryTimeout() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /** @param {number} validationWindowMs */
  scheduleRefresh(validationWindowMs) {
    const { Tools } = getTurnstileModuleState(this);
    if (
      !Tools.config.serverConfig.TURNSTILE_SITE_KEY ||
      !(validationWindowMs > 0)
    ) {
      return;
    }
    this.clearRefreshTimeout();
    const refreshDelay = Math.floor(validationWindowMs * 0.8);
    if (!(refreshDelay > 0)) return;
    this.refreshTimeout = window.setTimeout(() => {
      this.refresh();
    }, refreshDelay);
  }

  /**
   * @param {string} reason
   * @param {number=} [delayMs]
   */
  scheduleRetry(reason, delayMs = TURNSTILE_RETRY_DELAY_MS) {
    const { Tools, logBoardEvent } = getTurnstileModuleState(this);
    if (!Tools.config.serverConfig.TURNSTILE_SITE_KEY) return;
    if (this.pendingWrites.length === 0) return;
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
    this.clearRefreshTimeout();
    const ack = this.normalizeAck(result);
    if (ack.success !== true) {
      this.validatedUntil = 0;
      return;
    }

    const validation = computeTurnstileValidation(
      ack,
      Number(Tools.config.serverConfig.TURNSTILE_VALIDATION_WINDOW_MS),
    );
    const validationWindowMs = validation.validationWindowMs;
    this.validatedUntil = validation.validatedUntil;
    this.clearRetryTimeout();

    if (validationWindowMs > 0) {
      this.scheduleRefresh(validationWindowMs);
    }
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
    let overlay = document.getElementById("turnstile-overlay");
    let widget = document.getElementById("turnstile-widget");
    if (overlay && widget) return { overlay: overlay };

    overlay = document.createElement("div");
    overlay.id = "turnstile-overlay";
    overlay.classList.add("turnstile-overlay-hidden");

    const modal = document.createElement("div");
    modal.id = "turnstile-modal";

    widget = document.createElement("div");
    widget.id = "turnstile-widget";
    modal.appendChild(widget);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return { overlay: overlay };
  }

  /** @param {number} delay */
  showOverlay(delay) {
    const elements = this.ensureElements();
    if (delay > 0) {
      this.overlayTimeout = window.setTimeout(() => {
        elements.overlay.classList.remove("turnstile-overlay-hidden");
      }, delay);
    } else {
      elements.overlay.classList.remove("turnstile-overlay-hidden");
    }
  }

  hideOverlay() {
    if (this.overlayTimeout) {
      clearTimeout(this.overlayTimeout);
      this.overlayTimeout = null;
    }
    const overlay = document.getElementById("turnstile-overlay");
    if (overlay) overlay.classList.add("turnstile-overlay-hidden");
  }

  refresh() {
    const { Tools, logBoardEvent } = getTurnstileModuleState(this);
    if (!Tools.config.serverConfig.TURNSTILE_SITE_KEY) return;
    this.ensureElements();
    this.clearRetryTimeout();
    if (this.pending) return;

    const api = getTurnstileApi();
    if (api) {
      if (this.widgetId === null) renderTurnstileWidget(this, api);
      else resetTurnstileChallenge(this, api);
      return;
    }
    if (turnstileScriptPromise) return;

    logBoardEvent("warn", "turnstile.script_unavailable");
    void loadTurnstileScript(logBoardEvent)
      .then((loadedApi) => {
        if (this.pendingWrites.length === 0) return;
        if (this.widgetId === null) {
          renderTurnstileWidget(this, loadedApi);
        } else {
          resetTurnstileChallenge(this, loadedApi);
        }
      })
      .catch((error) => {
        logBoardEvent("error", "turnstile.script_load_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        showTurnstileFailureStatus(
          this,
          "Security check could not load. Your pending write is preserved while the client retries.",
        );
        this.scheduleRetry("script_load_failed");
      });
  }

  showWidget() {
    const { logBoardEvent } = getTurnstileModuleState(this);
    logBoardEvent("log", "turnstile.widget_requested");
    this.refresh();
  }

  /** @param {ClientTrackedMessage} data */
  queueProtectedWrite(data) {
    getTurnstileModuleState(this).queueProtectedWrite(data);
  }

  flushPendingWrites() {
    getTurnstileModuleState(this).flushPendingWrites();
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
 * @param {string} message
 */
function showTurnstileFailureStatus(module, message) {
  const { Tools } = getTurnstileModuleState(module);
  Tools.status.showBoardStatus({
    hidden: false,
    state: "paused",
    title: message,
    detail: "",
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
  showTurnstileFailureStatus(
    module,
    `${detailPrefix} Your pending write is preserved while the client retries.`,
  );
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
  const { logBoardEvent } = getTurnstileModuleState(module);
  try {
    const result = await emitTurnstileToken(module, token);
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
    module.pending = false;
    module.setValidation(null);
    logBoardEvent("error", "turnstile.submit_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    showTurnstileFailureStatus(
      module,
      "Security check could not be verified. Your pending write is preserved while the client retries.",
    );
    module.scheduleRetry("submit_failed");
    return;
  }

  module.setValidation(null);
  showTurnstileFailureStatus(
    module,
    "Security check was not accepted. Your pending write is preserved while the client retries.",
  );
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
        if (!Tools.connection.socket) {
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
        logBoardEvent("log", "turnstile.widget_shown");
        module.showOverlay(0);
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
        showTurnstileFailureStatus(
          module,
          "Security check timed out. Your pending write is preserved while the client retries.",
        );
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
    showTurnstileFailureStatus(
      module,
      "Security check could not start. Your pending write is preserved while the client retries.",
    );
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
    showTurnstileFailureStatus(
      module,
      "Security check could not reset. Your pending write is preserved while the client retries.",
    );
    module.scheduleRetry("reset_failed");
  }
}
