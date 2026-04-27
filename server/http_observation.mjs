import * as path from "node:path";

import {
  ATTR_CLIENT_ADDRESS,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_PATH,
  ATTR_URL_SCHEME,
} from "@opentelemetry/semantic-conventions";

import { boundaryReason, boundaryStatusCode } from "./boundary_errors.mjs";
import { STATIC_RESOURCE_EXTENSIONS } from "./http_cache_policy.mjs";
import observability from "./observability.mjs";
import { parseRequestUrl } from "./request_url.mjs";
import { getRequestClientIp } from "./socket_policy.mjs";

const { createRequestId, logger, metrics, tracing } = observability;

const SLOW_REQUEST_LOG_MS = 1000;
const ROUTINE_CLIENT_ERROR_CODES = new Set(["ECONNRESET", "EPIPE"]);

/** @typedef {import("http").IncomingMessage} HttpRequest */
/** @typedef {import("http").ServerResponse} HttpResponse */
/** @import { ServerConfig } from "../types/server-runtime.d.ts" */

/**
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @param {HttpRequest} request
 * @returns {string}
 */
function requestScheme(request) {
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  if (typeof forwardedProto === "string" && forwardedProto.trim() !== "") {
    const protoValue = forwardedProto.split(",")[0];
    if (protoValue) return protoValue.trim().toLowerCase();
  }

  const forwarded = firstHeaderValue(request.headers.forwarded);
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    const forwardedValue = forwarded.split(",")[0];
    const protoPart = forwardedValue
      ? forwardedValue
          .split(";")
          .map((part) => part.trim())
          .find((part) => /^proto=/i.test(part))
      : undefined;
    if (protoPart) {
      return protoPart
        .replace(/^proto=/i, "")
        .trim()
        .toLowerCase();
    }
  }

  return "encrypted" in request.socket && request.socket.encrypted
    ? "https"
    : "http";
}

/**
 * @param {HttpRequest} request
 * @returns {string | undefined}
 */
function requestAuthority(request) {
  const host =
    firstHeaderValue(request.headers["x-forwarded-host"]) ||
    firstHeaderValue(request.headers.host);
  if (typeof host !== "string" || host.trim() === "") return undefined;
  const authority = host.split(",")[0];
  return authority ? authority.trim() : undefined;
}

/**
 * @param {HttpRequest} request
 * @param {ServerConfig} config
 * @returns {string}
 */
function requestServerAddress(request, config) {
  const authority = requestAuthority(request);
  if (authority) {
    try {
      return new URL(`${requestScheme(request)}://${authority}`).hostname;
    } catch {}
  }
  return config.HOST || request.socket.localAddress || "localhost";
}

/**
 * @param {HttpRequest} request
 * @param {ServerConfig} config
 * @returns {number | undefined}
 */
function requestServerPort(request, config) {
  const authority = requestAuthority(request);
  const scheme = requestScheme(request);
  if (authority) {
    try {
      const parsed = new URL(`${scheme}://${authority}`);
      if (parsed.port) return Number(parsed.port);
      return scheme === "https" ? 443 : 80;
    } catch {}
  }
  if (typeof request.socket.localPort === "number") {
    return request.socket.localPort;
  }
  const configuredPort = Number(config.PORT);
  return Number.isFinite(configuredPort) ? configuredPort : undefined;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  if (!error || typeof error !== "object") return undefined;
  if (!("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * @param {unknown} error
 * @returns {number | undefined}
 */
function requestErrorStatusCode(error) {
  const boundaryCode = boundaryStatusCode(error);
  if (boundaryCode !== undefined) return boundaryCode;
  const code = errorCode(error);
  if (code === "ENOENT") return 404;
  if (code === "ENAMETOOLONG") return 400;
  return undefined;
}

/**
 * @param {HttpResponse} response
 * @param {number} statusCode
 * @param {string} errorPage
 * @returns {void}
 */
function respondWithErrorPage(response, statusCode, errorPage) {
  response.writeHead(statusCode, { "Content-Length": errorPage.length });
  response.end(errorPage);
}

/**
 * @param {string} route
 * @param {number} statusCode
 * @param {number} durationMs
 * @returns {{level: "info" | "warn" | "error", event: string} | null}
 */
function classifyRequestLog(route, statusCode, durationMs) {
  if (statusCode >= 500) {
    return { level: "error", event: "http.request_failed" };
  }
  if (route === "static_file") return null;
  if (statusCode >= 400) {
    return { level: "info", event: "http.request_rejected" };
  }
  if (durationMs >= SLOW_REQUEST_LOG_MS) {
    return { level: "warn", event: "http.request_slow" };
  }
  return null;
}

/**
 * @param {string} route
 * @returns {string | undefined}
 */
function requestRouteTemplate(route) {
  switch (route) {
    case "boards_redirect":
      return "/boards";
    case "board_page":
      return "/boards/{board}";
    case "download_board":
      return "/download/{board}";
    case "preview_board":
      return "/preview/{board}";
    case "random_board":
      return "/random";
    case "index":
      return "/";
    default:
      return undefined;
  }
}

/**
 * @param {string} requestUrl
 * @returns {boolean}
 */
function shouldTraceRequest(requestUrl) {
  const parsedUrl = parseRequestUrl(requestUrl);
  return !STATIC_RESOURCE_EXTENSIONS.includes(path.extname(parsedUrl.pathname));
}

/**
 * @param {{[key: string]: unknown}} fields
 * @returns {{[key: string]: unknown}}
 */
function requestTraceAttributes(fields) {
  /** @type {{[key: string]: unknown}} */
  const attributes = {};
  if (fields.board !== undefined) attributes["wbo.board"] = fields.board;
  if (fields.render_duration_ms !== undefined) {
    attributes["wbo.preview.render_duration_ms"] = fields.render_duration_ms;
  }
  return attributes;
}

/**
 * @param {{
 *   request: HttpRequest,
 *   response: HttpResponse,
 *   requestId: string,
 *   method: string,
 *   scheme: string,
 *   serverAddress: string,
 *   clientAddress: string,
 *   route: string,
 *   startedAt: number,
 *   requestError: unknown,
 *   requestSpan: import("@opentelemetry/api").Span | null,
 *   logFields: {[key: string]: unknown},
 * }} state
 * @returns {void}
 */
function finalizeObservedRequest(state) {
  const statusCode = state.response.statusCode || 200;
  const durationMs = Date.now() - state.startedAt;
  const routeTemplate = requestRouteTemplate(state.route);
  const errorType =
    state.requestError instanceof Error
      ? state.requestError.name || "Error"
      : statusCode >= 500
        ? String(statusCode)
        : undefined;

  metrics.changeHttpActiveRequests({
    change: -1,
    method: state.method,
    scheme: state.scheme,
    serverAddress: state.serverAddress,
  });
  if (state.requestSpan) {
    tracing.setSpanAttributes(state.requestSpan, {
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
    });
    if (statusCode >= 500 && !state.requestError) {
      state.requestSpan.setStatus({ code: tracing.SpanStatusCode.ERROR });
    }
  }

  metrics.recordHttpRequest({
    method: state.method,
    route: routeTemplate,
    scheme: state.scheme,
    statusCode,
    durationSeconds: durationMs / 1000,
    errorType,
  });
  const logTarget = classifyRequestLog(state.route, statusCode, durationMs);
  if (logTarget) {
    /** @type {{[key: string]: unknown}} */
    const fields = {
      request_id: state.requestId,
      [ATTR_HTTP_REQUEST_METHOD]: state.method,
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
      duration_ms: durationMs,
      [ATTR_URL_PATH]: parseRequestUrl(state.request.url).pathname,
      ...(routeTemplate ? { [ATTR_HTTP_ROUTE]: routeTemplate } : {}),
      ...state.logFields,
    };
    if (statusCode >= 400) fields[ATTR_CLIENT_ADDRESS] = state.clientAddress;
    if (state.requestError) fields.error = state.requestError;
    logger[logTarget.level](logTarget.event, fields);
  }
  if (state.requestSpan) state.requestSpan.end();
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {ServerConfig} config
 * @returns {{
 *   requestId: string,
 *   run: (fn: () => void | Promise<void>) => void,
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }}
 */
function observeRequest(request, response, config) {
  const forwardedRequestId = request.headers["x-request-id"];
  const requestId =
    typeof forwardedRequestId === "string" && forwardedRequestId !== ""
      ? forwardedRequestId
      : createRequestId();
  response.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  const method = request.method || "GET";
  const scheme = requestScheme(request);
  const serverAddress = requestServerAddress(request, config);
  const serverPort = requestServerPort(request, config);
  let route = "unknown";
  let clientAddress = request.socket.remoteAddress || "unknown";
  /** @type {unknown} */
  let requestError;
  /** @type {{[key: string]: unknown}} */
  let logFields = {};
  try {
    clientAddress = getRequestClientIp(config, request);
  } catch {}
  const parentContext = tracing.extractContext(request.headers);
  const requestSpan = shouldTraceRequest(request.url || "/")
    ? tracing.startSpan(`${method} request`, {
        kind: tracing.SpanKind.SERVER,
        parentContext,
        attributes: {
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_URL_SCHEME]: scheme,
          [ATTR_SERVER_ADDRESS]: serverAddress,
          [ATTR_SERVER_PORT]: serverPort,
        },
      })
    : null;
  metrics.changeHttpActiveRequests({
    change: 1,
    method,
    scheme,
    serverAddress,
  });
  let finalized = false;

  function finalize() {
    if (finalized) return;
    finalized = true;
    tracing.withSpanContext(
      requestSpan,
      parentContext,
      function finalizeRequestContext() {
        finalizeObservedRequest({
          request,
          response,
          requestId,
          method,
          scheme,
          serverAddress,
          clientAddress,
          route,
          startedAt,
          requestError,
          requestSpan,
          logFields,
        });
      },
    );
  }

  response.once("finish", finalize);
  response.once("close", finalize);

  return {
    requestId,
    run: function run(fn) {
      return tracing.withSpanContext(requestSpan, parentContext, fn);
    },
    setRoute: function setRoute(nextRoute) {
      route = nextRoute;
      if (!requestSpan) return;
      const routeTemplate = requestRouteTemplate(nextRoute);
      requestSpan.updateName(
        routeTemplate ? `${method} ${routeTemplate}` : `${method} request`,
      );
      if (routeTemplate) {
        tracing.setSpanAttributes(requestSpan, {
          [ATTR_HTTP_ROUTE]: routeTemplate,
        });
      }
    },
    noteError: function noteError(error) {
      requestError = error;
      if (requestSpan) tracing.recordSpanError(requestSpan, error);
    },
    annotate: function annotate(fields) {
      logFields = { ...logFields, ...fields };
    },
    setTraceAttributes: function setTraceAttributes(fields) {
      if (!requestSpan) return;
      tracing.setSpanAttributes(requestSpan, requestTraceAttributes(fields));
    },
  };
}

/**
 * @param {HttpResponse} response
 * @param {string} errorPage
 * @param {{
 *   noteError?: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 * }} requestContext
 * @returns {(err?: unknown) => void}
 */
function serveError(response, errorPage, requestContext) {
  return (err) => {
    const statusCode = err ? requestErrorStatusCode(err) || 500 : 404;
    if (statusCode >= 500) {
      if (err !== undefined) requestContext.noteError?.(err);
    } else {
      requestContext.annotate({
        rejection_reason:
          boundaryReason(err) ||
          errorCode(err) ||
          (statusCode === 404 ? "not_found" : undefined) ||
          (err instanceof Error ? err.toString() : String(err)) ||
          "rejected",
      });
    }
    respondWithErrorPage(response, statusCode, errorPage);
  };
}

/**
 * @param {Error} error
 * @param {import("node:net").Socket} socket
 * @returns {void}
 */
function handleClientError(error, socket) {
  const code = errorCode(error);
  const log =
    code !== undefined && ROUTINE_CLIENT_ERROR_CODES.has(code)
      ? logger.debug
      : logger.info;
  log("http.client_error", {
    code,
    message: error.message,
  });
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 11\r\n\r\nBad Request",
  );
}

export {
  errorCode,
  handleClientError,
  observeRequest,
  requestErrorStatusCode,
  requestScheme,
  respondWithErrorPage,
  serveError,
};
