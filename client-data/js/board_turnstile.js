import { SocketEvents } from "./socket_events.js";

/** @typedef {import("../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../types/app-runtime").AppTurnstileModule} AppTurnstileModule */
/** @typedef {import("../../types/app-runtime").TurnstileAck} TurnstileAck */
/** @typedef {{logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void, queueProtectedWrite: AppTurnstileModule["queueProtectedWrite"], flushPendingWrites: AppTurnstileModule["flushPendingWrites"]}} TurnstileModuleOptions */

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_ACK_TIMEOUT_MS = 10_000;
const TURNSTILE_RETRY_DELAY_MS = 1_500;

/** @type {Promise<unknown> | null} */
let turnstileScriptPromise = null;

/**
 * @returns {any}
 */
function getTurnstileApi() {
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
 * @returns {Promise<any>}
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

/**
 * @param {AppToolsState} Tools
 * @param {TurnstileModuleOptions} options
 * @returns {AppTurnstileModule}
 */
export function createTurnstileModule(
  Tools,
  { logBoardEvent, queueProtectedWrite, flushPendingWrites },
) {
  /** @type {AppTurnstileModule} */
  const turnstileModule = {
    validatedUntil: 0,
    widgetId: null,
    refreshTimeout: null,
    retryTimeout: null,
    pending: false,
    pendingWrites: [],
    overlayTimeout: null,
    isValidated,
    clearRefreshTimeout,
    clearRetryTimeout,
    scheduleRefresh,
    scheduleRetry,
    setValidation,
    normalizeAck,
    ensureElements,
    showOverlay,
    hideOverlay,
    refresh,
    showWidget,
    queueProtectedWrite,
    flushPendingWrites,
  };

  function isValidated() {
    return turnstileModule.validatedUntil > Date.now();
  }

  function clearRefreshTimeout() {
    if (turnstileModule.refreshTimeout) {
      clearTimeout(turnstileModule.refreshTimeout);
      turnstileModule.refreshTimeout = null;
    }
  }

  /** @param {number} validationWindowMs */
  function scheduleRefresh(validationWindowMs) {
    if (
      !Tools.config.serverConfig.TURNSTILE_SITE_KEY ||
      !(validationWindowMs > 0)
    ) {
      return;
    }
    turnstileModule.clearRefreshTimeout();
    const refreshDelay = Math.floor(validationWindowMs * 0.8);
    if (!(refreshDelay > 0)) return;
    turnstileModule.refreshTimeout = window.setTimeout(
      function refreshTurnstileToken() {
        turnstileModule.refresh();
      },
      refreshDelay,
    );
  }

  /** @param {unknown} result */
  function setValidation(result) {
    turnstileModule.clearRefreshTimeout();
    const ack = turnstileModule.normalizeAck(result);
    if (ack.success !== true) {
      turnstileModule.validatedUntil = 0;
      return;
    }

    const validation = computeTurnstileValidation(
      ack,
      Number(Tools.config.serverConfig.TURNSTILE_VALIDATION_WINDOW_MS),
    );
    const validationWindowMs = validation.validationWindowMs;
    turnstileModule.validatedUntil = validation.validatedUntil;
    turnstileModule.clearRetryTimeout();

    if (validationWindowMs > 0) {
      turnstileModule.scheduleRefresh(validationWindowMs);
    }
  }

  /** @param {unknown} result */
  function normalizeAck(result) {
    return normalizeTurnstileAck(
      result,
      Number(Tools.config.serverConfig.TURNSTILE_VALIDATION_WINDOW_MS),
    );
  }

  function ensureElements() {
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
  function showOverlay(delay) {
    const elements = turnstileModule.ensureElements();
    if (delay > 0) {
      turnstileModule.overlayTimeout = window.setTimeout(() => {
        elements.overlay.classList.remove("turnstile-overlay-hidden");
      }, delay);
    } else {
      elements.overlay.classList.remove("turnstile-overlay-hidden");
    }
  }

  function hideOverlay() {
    if (turnstileModule.overlayTimeout) {
      clearTimeout(turnstileModule.overlayTimeout);
      turnstileModule.overlayTimeout = null;
    }
    const overlay = document.getElementById("turnstile-overlay");
    if (overlay) overlay.classList.add("turnstile-overlay-hidden");
  }

  function clearRetryTimeout() {
    if (turnstileModule.retryTimeout) {
      clearTimeout(turnstileModule.retryTimeout);
      turnstileModule.retryTimeout = null;
    }
  }

  /** @param {string} message */
  function showTurnstileFailureStatus(message) {
    Tools.status.showBoardStatus({
      hidden: false,
      state: "paused",
      title: message,
      detail: "",
    });
  }

  /**
   * @param {string} reason
   * @param {number=} [delayMs]
   */
  function scheduleRetry(reason, delayMs = TURNSTILE_RETRY_DELAY_MS) {
    if (!Tools.config.serverConfig.TURNSTILE_SITE_KEY) return;
    if (turnstileModule.pendingWrites.length === 0) return;
    turnstileModule.clearRetryTimeout();
    logBoardEvent("warn", "turnstile.retry_scheduled", {
      reason,
      delayMs,
    });
    turnstileModule.retryTimeout = window.setTimeout(() => {
      turnstileModule.retryTimeout = null;
      turnstileModule.refresh();
    }, delayMs);
  }

  /** @param {unknown} errorCode */
  function handleTurnstileError(errorCode) {
    const detailPrefix =
      typeof errorCode === "string" && errorCode
        ? `Security check failed (${errorCode}).`
        : "Security check failed.";
    logBoardEvent("error", "turnstile.error", {
      errorCode,
    });
    showTurnstileFailureStatus(
      `${detailPrefix} Your pending write is preserved while the client retries.`,
    );
    turnstileModule.scheduleRetry("widget_error");
  }

  /**
   * @param {string} token
   * @returns {Promise<unknown>}
   */
  function emitTurnstileToken(token) {
    return new Promise((resolve, reject) => {
      const socket = Tools.connection.socket;
      if (!socket) {
        reject(
          new Error("Socket unavailable while submitting Turnstile token."),
        );
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
   * @param {string} token
   * @returns {Promise<void>}
   */
  async function submitTurnstileToken(token) {
    try {
      const result = await emitTurnstileToken(token);
      const turnstileResult = turnstileModule.normalizeAck(result);
      turnstileModule.pending = false;
      if (turnstileResult.success) {
        logBoardEvent("log", "turnstile.submit_succeeded");
        turnstileModule.setValidation(turnstileResult);
        turnstileModule.hideOverlay();
        turnstileModule.flushPendingWrites();
        return;
      }
      logBoardEvent("warn", "turnstile.submit_rejected", {
        result: turnstileResult,
      });
    } catch (error) {
      turnstileModule.pending = false;
      turnstileModule.setValidation(null);
      logBoardEvent("error", "turnstile.submit_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      showTurnstileFailureStatus(
        "Security check could not be verified. Your pending write is preserved while the client retries.",
      );
      turnstileModule.scheduleRetry("submit_failed");
      return;
    }

    turnstileModule.setValidation(null);
    showTurnstileFailureStatus(
      "Security check was not accepted. Your pending write is preserved while the client retries.",
    );
    turnstileModule.scheduleRetry("submit_rejected");
  }

  /**
   * @param {any} api
   * @returns {void}
   */
  function renderTurnstileWidget(api) {
    try {
      turnstileModule.pending = true;
      turnstileModule.widgetId = api.render("#turnstile-widget", {
        sitekey: Tools.config.serverConfig.TURNSTILE_SITE_KEY,
        appearance: "interaction-only",
        theme: "light",
        "refresh-expired": "manual",
        /** @param {string} token */
        callback: (token) => {
          if (!Tools.connection.socket) {
            turnstileModule.pending = false;
            logBoardEvent("warn", "turnstile.submit_skipped", {
              reason: "socket_unavailable",
            });
            turnstileModule.scheduleRetry("socket_unavailable");
            return;
          }
          void submitTurnstileToken(token);
        },
        "before-interactive-callback": () => {
          logBoardEvent("log", "turnstile.widget_shown");
          turnstileModule.showOverlay(0);
        },
        "after-interactive-callback": () => {
          if (turnstileModule.isValidated()) turnstileModule.hideOverlay();
        },
        "error-callback": (/** @type {unknown} */ err) => {
          turnstileModule.pending = false;
          turnstileModule.setValidation(null);
          handleTurnstileError(err);
        },
        "timeout-callback": () => {
          turnstileModule.pending = false;
          turnstileModule.setValidation(null);
          logBoardEvent("warn", "turnstile.widget_timeout");
          showTurnstileFailureStatus(
            "Security check timed out. Your pending write is preserved while the client retries.",
          );
          turnstileModule.scheduleRetry("widget_timeout");
        },
        "expired-callback": () => {
          turnstileModule.pending = false;
          turnstileModule.setValidation(null);
          logBoardEvent("warn", "turnstile.widget_expired");
          turnstileModule.scheduleRetry("widget_expired");
        },
      });
    } catch (error) {
      turnstileModule.pending = false;
      turnstileModule.widgetId = null;
      logBoardEvent("error", "turnstile.render_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      showTurnstileFailureStatus(
        "Security check could not start. Your pending write is preserved while the client retries.",
      );
      turnstileModule.scheduleRetry("render_failed");
    }
  }

  /**
   * @param {any} api
   * @returns {void}
   */
  function resetTurnstileChallenge(api) {
    try {
      turnstileModule.pending = true;
      api.reset(turnstileModule.widgetId);
    } catch (error) {
      turnstileModule.pending = false;
      logBoardEvent("error", "turnstile.reset_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      showTurnstileFailureStatus(
        "Security check could not reset. Your pending write is preserved while the client retries.",
      );
      turnstileModule.scheduleRetry("reset_failed");
    }
  }

  function refresh() {
    if (!Tools.config.serverConfig.TURNSTILE_SITE_KEY) return;
    turnstileModule.ensureElements();
    turnstileModule.clearRetryTimeout();
    if (turnstileModule.pending) return;

    const api = getTurnstileApi();
    if (api) {
      if (turnstileModule.widgetId === null) renderTurnstileWidget(api);
      else resetTurnstileChallenge(api);
      return;
    }
    if (turnstileScriptPromise) return;

    logBoardEvent("warn", "turnstile.script_unavailable");
    void loadTurnstileScript(logBoardEvent)
      .then((loadedApi) => {
        if (turnstileModule.pendingWrites.length === 0) return;
        if (turnstileModule.widgetId === null) {
          renderTurnstileWidget(loadedApi);
        } else {
          resetTurnstileChallenge(loadedApi);
        }
      })
      .catch((error) => {
        logBoardEvent("error", "turnstile.script_load_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        showTurnstileFailureStatus(
          "Security check could not load. Your pending write is preserved while the client retries.",
        );
        turnstileModule.scheduleRetry("script_load_failed");
      });
  }

  function showWidget() {
    logBoardEvent("log", "turnstile.widget_requested");
    turnstileModule.refresh();
  }

  return turnstileModule;
}
