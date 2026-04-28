import { SocketEvents } from "./socket_events.js";

/** @typedef {import("../../types/app-runtime").AppToolsState} AppToolsState */
/** @typedef {import("../../types/app-runtime").TurnstileAck} TurnstileAck */
/** @typedef {{logBoardEvent: (level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void}} TurnstileInstallOptions */

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
 * @param {TurnstileInstallOptions} options
 * @returns {void}
 */
export function installTurnstile(Tools, { logBoardEvent }) {
  Tools.isTurnstileValidated = function isTurnstileValidated() {
    return Tools.turnstile.validatedUntil > Date.now();
  };

  Tools.clearTurnstileRefreshTimeout = function clearTurnstileRefreshTimeout() {
    if (Tools.turnstile.refreshTimeout) {
      clearTimeout(Tools.turnstile.refreshTimeout);
      Tools.turnstile.refreshTimeout = null;
    }
  };

  /** @param {number} validationWindowMs */
  Tools.scheduleTurnstileRefresh = function scheduleTurnstileRefresh(
    validationWindowMs,
  ) {
    if (
      !Tools.config.serverConfig.TURNSTILE_SITE_KEY ||
      !(validationWindowMs > 0)
    ) {
      return;
    }
    Tools.clearTurnstileRefreshTimeout();
    const refreshDelay = Math.floor(validationWindowMs * 0.8);
    if (!(refreshDelay > 0)) return;
    Tools.turnstile.refreshTimeout = window.setTimeout(
      function refreshTurnstileToken() {
        Tools.refreshTurnstile();
      },
      refreshDelay,
    );
  };

  /** @param {unknown} result */
  Tools.setTurnstileValidation = function setTurnstileValidation(result) {
    Tools.clearTurnstileRefreshTimeout();
    const ack = Tools.normalizeTurnstileAck(result);
    if (ack.success !== true) {
      Tools.turnstile.validatedUntil = 0;
      return;
    }

    const validation = computeTurnstileValidation(
      ack,
      Number(Tools.config.serverConfig.TURNSTILE_VALIDATION_WINDOW_MS),
    );
    const validationWindowMs = validation.validationWindowMs;
    Tools.turnstile.validatedUntil = validation.validatedUntil;
    Tools.clearTurnstileRetryTimeout();

    if (validationWindowMs > 0) {
      Tools.scheduleTurnstileRefresh(validationWindowMs);
    }
  };

  /** @param {unknown} result */
  Tools.normalizeTurnstileAck = function normalizeTurnstileAckForTools(result) {
    return normalizeTurnstileAck(
      result,
      Number(Tools.config.serverConfig.TURNSTILE_VALIDATION_WINDOW_MS),
    );
  };

  Tools.ensureTurnstileElements = function ensureTurnstileElements() {
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
  };

  /** @param {number} delay */
  Tools.showTurnstileOverlay = function showTurnstileOverlay(delay) {
    const elements = Tools.ensureTurnstileElements();
    if (delay > 0) {
      Tools.turnstile.overlayTimeout = window.setTimeout(() => {
        elements.overlay.classList.remove("turnstile-overlay-hidden");
      }, delay);
    } else {
      elements.overlay.classList.remove("turnstile-overlay-hidden");
    }
  };

  Tools.hideTurnstileOverlay = function hideTurnstileOverlay() {
    if (Tools.turnstile.overlayTimeout) {
      clearTimeout(Tools.turnstile.overlayTimeout);
      Tools.turnstile.overlayTimeout = null;
    }
    const overlay = document.getElementById("turnstile-overlay");
    if (overlay) overlay.classList.add("turnstile-overlay-hidden");
  };

  Tools.clearTurnstileRetryTimeout = function clearTurnstileRetryTimeout() {
    if (Tools.turnstile.retryTimeout) {
      clearTimeout(Tools.turnstile.retryTimeout);
      Tools.turnstile.retryTimeout = null;
    }
  };

  /** @param {string} message */
  function showTurnstileFailureStatus(message) {
    Tools.showBoardStatus({
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
  Tools.scheduleTurnstileRetry = function scheduleTurnstileRetry(
    reason,
    delayMs = TURNSTILE_RETRY_DELAY_MS,
  ) {
    if (!Tools.config.serverConfig.TURNSTILE_SITE_KEY) return;
    if (Tools.turnstile.pendingWrites.length === 0) return;
    Tools.clearTurnstileRetryTimeout();
    logBoardEvent("warn", "turnstile.retry_scheduled", {
      reason,
      delayMs,
    });
    Tools.turnstile.retryTimeout = window.setTimeout(() => {
      Tools.turnstile.retryTimeout = null;
      Tools.refreshTurnstile();
    }, delayMs);
  };

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
    Tools.scheduleTurnstileRetry("widget_error");
  }

  /**
   * @param {string} token
   * @returns {Promise<unknown>}
   */
  function emitTurnstileToken(token) {
    return new Promise((resolve, reject) => {
      const socket = Tools.socket;
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
      const turnstileResult = Tools.normalizeTurnstileAck(result);
      Tools.turnstile.pending = false;
      if (turnstileResult.success) {
        logBoardEvent("log", "turnstile.submit_succeeded");
        Tools.setTurnstileValidation(turnstileResult);
        Tools.hideTurnstileOverlay();
        Tools.flushTurnstilePendingWrites();
        return;
      }
      logBoardEvent("warn", "turnstile.submit_rejected", {
        result: turnstileResult,
      });
    } catch (error) {
      Tools.turnstile.pending = false;
      Tools.setTurnstileValidation(null);
      logBoardEvent("error", "turnstile.submit_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      showTurnstileFailureStatus(
        "Security check could not be verified. Your pending write is preserved while the client retries.",
      );
      Tools.scheduleTurnstileRetry("submit_failed");
      return;
    }

    Tools.setTurnstileValidation(null);
    showTurnstileFailureStatus(
      "Security check was not accepted. Your pending write is preserved while the client retries.",
    );
    Tools.scheduleTurnstileRetry("submit_rejected");
  }

  /**
   * @param {any} api
   * @returns {void}
   */
  function renderTurnstileWidget(api) {
    try {
      Tools.turnstile.pending = true;
      Tools.turnstile.widgetId = api.render("#turnstile-widget", {
        sitekey: Tools.config.serverConfig.TURNSTILE_SITE_KEY,
        appearance: "interaction-only",
        theme: "light",
        "refresh-expired": "manual",
        /** @param {string} token */
        callback: (token) => {
          if (!Tools.socket) {
            Tools.turnstile.pending = false;
            logBoardEvent("warn", "turnstile.submit_skipped", {
              reason: "socket_unavailable",
            });
            Tools.scheduleTurnstileRetry("socket_unavailable");
            return;
          }
          void submitTurnstileToken(token);
        },
        "before-interactive-callback": () => {
          logBoardEvent("log", "turnstile.widget_shown");
          Tools.showTurnstileOverlay(0);
        },
        "after-interactive-callback": () => {
          if (Tools.isTurnstileValidated()) Tools.hideTurnstileOverlay();
        },
        "error-callback": (/** @type {unknown} */ err) => {
          Tools.turnstile.pending = false;
          Tools.setTurnstileValidation(null);
          handleTurnstileError(err);
        },
        "timeout-callback": () => {
          Tools.turnstile.pending = false;
          Tools.setTurnstileValidation(null);
          logBoardEvent("warn", "turnstile.widget_timeout");
          showTurnstileFailureStatus(
            "Security check timed out. Your pending write is preserved while the client retries.",
          );
          Tools.scheduleTurnstileRetry("widget_timeout");
        },
        "expired-callback": () => {
          Tools.turnstile.pending = false;
          Tools.setTurnstileValidation(null);
          logBoardEvent("warn", "turnstile.widget_expired");
          Tools.scheduleTurnstileRetry("widget_expired");
        },
      });
    } catch (error) {
      Tools.turnstile.pending = false;
      Tools.turnstile.widgetId = null;
      logBoardEvent("error", "turnstile.render_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      showTurnstileFailureStatus(
        "Security check could not start. Your pending write is preserved while the client retries.",
      );
      Tools.scheduleTurnstileRetry("render_failed");
    }
  }

  /**
   * @param {any} api
   * @returns {void}
   */
  function resetTurnstileChallenge(api) {
    try {
      Tools.turnstile.pending = true;
      api.reset(Tools.turnstile.widgetId);
    } catch (error) {
      Tools.turnstile.pending = false;
      logBoardEvent("error", "turnstile.reset_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      showTurnstileFailureStatus(
        "Security check could not reset. Your pending write is preserved while the client retries.",
      );
      Tools.scheduleTurnstileRetry("reset_failed");
    }
  }

  Tools.refreshTurnstile = function refreshTurnstile() {
    if (!Tools.config.serverConfig.TURNSTILE_SITE_KEY) return;
    Tools.ensureTurnstileElements();
    Tools.clearTurnstileRetryTimeout();
    if (Tools.turnstile.pending) return;

    const api = getTurnstileApi();
    if (api) {
      if (Tools.turnstile.widgetId === null) renderTurnstileWidget(api);
      else resetTurnstileChallenge(api);
      return;
    }
    if (turnstileScriptPromise) return;

    logBoardEvent("warn", "turnstile.script_unavailable");
    void loadTurnstileScript(logBoardEvent)
      .then((loadedApi) => {
        if (Tools.turnstile.pendingWrites.length === 0) return;
        if (Tools.turnstile.widgetId === null) {
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
        Tools.scheduleTurnstileRetry("script_load_failed");
      });
  };

  Tools.showTurnstileWidget = function showTurnstileWidget() {
    logBoardEvent("log", "turnstile.widget_requested");
    Tools.refreshTurnstile();
  };
}
