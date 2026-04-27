import observability from "./observability.mjs";
import { getSocketRequest } from "./socket_request.mjs";

const { logger, metrics, tracing } = observability;

/** @import { AppSocket, ServerConfig, TurnstileAck, TurnstileAckCallback, TurnstileEventAck, TurnstileRejectedAck, TurnstileSiteverifyResult, ValidationStatus } from "../types/server-runtime.d.ts" */
/** @typedef {(socket: AppSocket, boardName: string, config: ServerConfig) => string} ResolveClientIp */
/** @typedef {(socket: AppSocket, clientIp: string) => string} ResolveSocketUserName */

/**
 * @param {any} hostname
 * @returns {string | null}
 */
function normalizeTurnstileHostname(hostname) {
  if (!hostname || typeof hostname !== "string") return null;
  return hostname.trim().toLowerCase().replace(/\.$/, "").split(":")[0] || null;
}

/**
 * @param {AppSocket} socket
 * @returns {string | null}
 */
function getExpectedTurnstileHostname(socket) {
  const headers = getSocketRequest(socket).headers || {};
  let host = headers["x-forwarded-host"] || headers.host;
  if (Array.isArray(host)) host = host[0];
  if (!host || typeof host !== "string") return null;
  return normalizeTurnstileHostname(host.split(",")[0]);
}

/**
 * @param {AppSocket} socket
 * @param {number} now
 * @returns {boolean}
 */
function isTurnstileValidationActive(socket, now) {
  return (
    typeof socket.turnstileValidatedUntil === "number" &&
    socket.turnstileValidatedUntil > now
  );
}

/**
 * @param {AppSocket} socket
 * @param {ServerConfig} config
 * @returns {TurnstileAck}
 */
function buildTurnstileAck(socket, config) {
  return {
    success: true,
    validationWindowMs: config.TURNSTILE_VALIDATION_WINDOW_MS,
    validatedUntil: socket.turnstileValidatedUntil,
  };
}

/**
 * @param {AppSocket} socket
 * @param {TurnstileSiteverifyResult} result
 * @returns {ValidationStatus}
 */
function validateTurnstileResult(socket, result) {
  if (!result || result.success !== true) {
    return { ok: false, reason: "siteverify_failed" };
  }

  const expectedHostname = getExpectedTurnstileHostname(socket);
  const actualHostname = normalizeTurnstileHostname(result.hostname);
  if (
    !actualHostname ||
    (expectedHostname &&
      actualHostname !== expectedHostname &&
      !(actualHostname === "example.com" && expectedHostname === "localhost"))
  ) {
    return { ok: false, reason: "hostname_mismatch" };
  }

  return { ok: true };
}

/**
 * @param {TurnstileAckCallback | undefined} ack
 * @param {TurnstileEventAck} payload
 * @returns {void}
 */
function sendTurnstileAck(ack, payload) {
  if (typeof ack === "function") ack(payload);
}

/**
 * @param {string} verifyUrlString
 * @param {string} secret
 * @param {string} token
 * @param {string} clientIp
 * @returns {Promise<TurnstileSiteverifyResult>}
 */
async function verifyTurnstileToken(verifyUrlString, secret, token, clientIp) {
  const requestBody = new URLSearchParams({
    secret,
    response: token,
  });
  requestBody.set("remoteip", clientIp);
  const verifyUrl = new URL(verifyUrlString);
  const verification = await tracing.withActiveSpan(
    "turnstile.verify",
    {
      kind: tracing.SpanKind.CLIENT,
      attributes: {
        "http.request.method": "POST",
        "server.address": verifyUrl.hostname,
        "server.port": verifyUrl.port ? Number(verifyUrl.port) : undefined,
        "url.scheme": verifyUrl.protocol.replace(":", ""),
      },
    },
    async function fetchTurnstileVerification() {
      const response = await fetch(verifyUrlString, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: requestBody,
      });
      const result = await response.json();
      tracing.setActiveSpanAttributes({
        "http.response.status_code": response.status,
      });
      return { response, result };
    },
  );
  return verification.result;
}

/**
 * @param {AppSocket} socket
 * @param {string} clientIp
 * @param {string} userName
 * @param {TurnstileSiteverifyResult} result
 * @param {string} reason
 * @param {TurnstileAckCallback | undefined} ack
 * @returns {void}
 */
function rejectTurnstileVerification(
  socket,
  clientIp,
  userName,
  result,
  reason,
  ack,
) {
  tracing.setActiveSpanAttributes({
    "wbo.turnstile.result": "rejected",
    "wbo.turnstile.reason": reason,
  });
  metrics.recordTurnstileVerification(reason);
  logger.warn("turnstile.rejected", {
    socket: socket.id,
    "client.address": clientIp,
    "user.name": userName,
    error_codes: result["error-codes"],
    reason,
    hostname: result.hostname,
  });
  sendTurnstileAck(
    ack,
    /** @type {TurnstileRejectedAck} */ ({ success: false }),
  );
}

/**
 * @param {AppSocket} socket
 * @param {unknown} err
 * @param {TurnstileAckCallback | undefined} ack
 * @returns {void}
 */
function failTurnstileVerification(socket, err, ack) {
  tracing.recordActiveSpanError(err, {
    "wbo.turnstile.result": "error",
  });
  metrics.recordTurnstileVerification(err);
  logger.error("turnstile.error", {
    socket: socket.id,
    error: err,
  });
  sendTurnstileAck(
    ack,
    /** @type {TurnstileRejectedAck} */ ({ success: false }),
  );
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {string} token
 * @param {TurnstileAckCallback | undefined} ack
 * @param {ServerConfig} config
 * @param {ResolveClientIp} resolveClientIp
 * @param {ResolveSocketUserName} resolveSocketUserName
 * @returns {Promise<void>}
 */
async function handleTurnstileTokenMessage(
  socket,
  boardName,
  token,
  ack,
  config,
  resolveClientIp,
  resolveSocketUserName,
) {
  if (!config.TURNSTILE_SECRET_KEY) {
    sendTurnstileAck(ack, true);
    return;
  }

  try {
    const clientIp = resolveClientIp(socket, boardName, config);
    const userName = resolveSocketUserName(socket, clientIp);
    tracing.setActiveSpanAttributes({
      "user.name": userName,
      "client.address": clientIp,
    });
    const result = await verifyTurnstileToken(
      config.TURNSTILE_VERIFY_URL,
      config.TURNSTILE_SECRET_KEY,
      token,
      clientIp,
    );
    const validation = validateTurnstileResult(socket, result);
    if (validation.ok === true) {
      socket.turnstileValidatedUntil =
        Date.now() + config.TURNSTILE_VALIDATION_WINDOW_MS;
      tracing.setActiveSpanAttributes({
        "wbo.turnstile.result": "success",
      });
      metrics.recordTurnstileVerification();
      sendTurnstileAck(ack, buildTurnstileAck(socket, config));
      return;
    }
    rejectTurnstileVerification(
      socket,
      clientIp,
      userName,
      result,
      validation.reason,
      ack,
    );
  } catch (err) {
    failTurnstileVerification(socket, err, ack);
  }
}

export { handleTurnstileTokenMessage, isTurnstileValidationActive };
