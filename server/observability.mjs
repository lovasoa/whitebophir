import { randomUUID } from "node:crypto";
import { getToolId } from "../client-data/js/message_tool_metadata.js";
import {
  context,
  isSpanContextValid,
  metrics as otelMetrics,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_URL_SCHEME,
  SEMRESATTRS_SERVICE_NAME,
} from "@opentelemetry/semantic-conventions";
import packageJson from "../package.json" with { type: "json" };

import { readConfiguration } from "./configuration.mjs";
import {
  DEFAULT_SERVICE_NAME,
  flattenError,
  formatCanonicalLogLine,
  styleTerminalLogLine,
} from "./logfmt.mjs";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
const SERVICE_VERSION = packageJson.version;
const DEFAULT_TRACE_SAMPLE_RATIO = 0.05;
const DEFAULT_RUNTIME_METRICS_PRECISION_MS = 5000;
const LOG_LEVEL_RANK = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const MIN_LOG_LEVEL = readConfiguration().LOG_LEVEL;
const TEST_TRACE_EXPORTER = /** @type {{__WBO_TEST_TRACE_EXPORTER__?: any}} */ (
  globalThis
).__WBO_TEST_TRACE_EXPORTER__;

/**
 * @param {"logs"|"metrics"|"traces"} signal
 * @returns {boolean}
 */
function hasConfiguredOtlpEndpoint(signal) {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return true;
  if (signal === "logs" && process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
    return true;
  }
  if (signal === "metrics" && process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) {
    return true;
  }
  if (signal === "traces" && process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return true;
  }
  return false;
}

class LogfmtLogRecordExporter {
  /**
   * @param {{
   *   writeStdout?: (chunk: string) => void,
   *   writeStderr?: (chunk: string) => void,
   *   stdoutSupportsColor?: boolean,
   *   stderrSupportsColor?: boolean,
   * }=} options
   */
  constructor(options) {
    this.writeStdout =
      options?.writeStdout ||
      function writeStdout(chunk) {
        globalThis.console.log(chunk.replace(/\n$/, ""));
      };
    this.writeStderr =
      options?.writeStderr ||
      function writeStderr(chunk) {
        globalThis.console.error(chunk.replace(/\n$/, ""));
      };
    this.stdoutSupportsColor =
      options && options.stdoutSupportsColor !== undefined
        ? options.stdoutSupportsColor
        : streamSupportsColor(process.stdout);
    this.stderrSupportsColor =
      options && options.stderrSupportsColor !== undefined
        ? options.stderrSupportsColor
        : streamSupportsColor(process.stderr);
  }

  /**
   * @param {import("@opentelemetry/sdk-logs").ReadableLogRecord[]} records
   * @param {(result: {code: number}) => void} resultCallback
   */
  export(records, resultCallback) {
    if (process.env.WBO_SILENT === "true") {
      resultCallback({ code: 0 });
      return;
    }

    for (const record of records) {
      const _level = normalizeSeverityText(
        record.severityText,
        record.severityNumber,
      );
      const useStderr =
        record.severityNumber !== undefined &&
        record.severityNumber >= SeverityNumber.ERROR;
      const line = `${formatReadableLogRecord(record, {
        colorizeLevel: useStderr
          ? this.stderrSupportsColor
          : this.stdoutSupportsColor,
      })}\n`;
      if (useStderr) {
        this.writeStderr(line);
      } else {
        this.writeStdout(line);
      }
    }
    resultCallback({ code: 0 });
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}

/**
 * @returns {import("@opentelemetry/sdk-trace-base").SpanProcessor[]}
 */
function buildTraceSpanProcessors() {
  /** @type {import("@opentelemetry/sdk-trace-base").SpanProcessor[]} */
  const processors = [];
  if (TEST_TRACE_EXPORTER) {
    processors.push(new SimpleSpanProcessor(TEST_TRACE_EXPORTER));
  }
  if (hasConfiguredOtlpEndpoint("traces")) {
    processors.push(new BatchSpanProcessor(new OTLPTraceExporter()));
  }
  return processors;
}

/**
 * @returns {import("@opentelemetry/sdk-trace-base").Sampler | undefined}
 */
function buildTracerSampler() {
  if (
    process.env.OTEL_TRACES_SAMPLER !== undefined ||
    process.env.OTEL_TRACES_SAMPLER_ARG !== undefined
  ) {
    return undefined;
  }
  return new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(DEFAULT_TRACE_SAMPLE_RATIO),
  });
}

const traceSpanProcessors = buildTraceSpanProcessors();
const tracingEnabled = traceSpanProcessors.length > 0;

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
    "service.version": SERVICE_VERSION,
  }),
  instrumentations: [
    new RuntimeNodeInstrumentation({
      monitoringPrecision: DEFAULT_RUNTIME_METRICS_PRECISION_MS,
    }),
  ],
  metricReaders: hasConfiguredOtlpEndpoint("metrics")
    ? [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
        }),
      ]
    : [],
  logRecordProcessors: buildLogRecordProcessors(),
  sampler: buildTracerSampler(),
  spanProcessors: traceSpanProcessors,
});

sdk.start();

const meter = otelMetrics.getMeter(SERVICE_NAME);
const otelLogger = logs.getLogger(SERVICE_NAME);
const tracer = trace.getTracer(SERVICE_NAME);

const runtimeState = {
  loadedBoards: 0,
  connectedUsers: 0,
  activeSocketConnections: 0,
};

const httpServerRequestDuration = meter.createHistogram(
  "http.server.request.duration",
  {
    description:
      "Elapsed time, in seconds, from the start of an HTTP request until its response finishes or closes.",
    unit: "s",
  },
);
const httpServerActiveRequests = meter.createUpDownCounter(
  "http.server.active_requests",
  {
    description:
      "Current number of HTTP requests that have started but whose responses have not yet finished or closed.",
    unit: "{request}",
  },
);
const socketConnections = meter.createCounter("wbo.socket.connection", {
  description:
    "Count of Socket.IO connection lifecycle events observed by the server; wbo.socket.connection.event distinguishes connected from disconnected.",
  unit: "{connection}",
});
const socketEventDuration = meter.createHistogram("wbo.socket.event.duration", {
  description:
    "Elapsed time, in seconds, spent handling each top-level Socket.IO event callback; histogram count is the number of handled events.",
  unit: "s",
});
const boardMessages = meter.createCounter("wbo.board.message", {
  description:
    "Count of board write-path messages processed by the server after validation and authorization; error.type is set for rejected or failed messages.",
  unit: "{message}",
});
const boardOperationDuration = meter.createHistogram(
  "wbo.board.operation.duration",
  {
    description:
      "Elapsed time, in seconds, for board persistence operations such as load, save, and unload; histogram count is the number of operations and error.type marks non-success outcomes.",
    unit: "s",
  },
);
const rateLimitWindowUtilization = meter.createHistogram(
  "wbo.rate_limit.window.utilization",
  {
    description:
      "Fraction of a completed fixed-window rate-limit allowance that was consumed before that window ended. Each histogram sample represents exactly one completed server-side rate-limit window for a single tracked subject: one socket connection for the general limit, or one resolved client IP for the constructive, destructive, and text limits. The recorded value is used_count / configured_limit for that completed window. A value of 0.5 means half of the allowance was used, 1.0 means the allowance was fully consumed, and values greater than 1.0 mean the window exceeded the configured limit before the server closed the socket or later pruned the stale state.",
    unit: "1",
  },
);
const turnstileVerifications = meter.createCounter(
  "wbo.turnstile.verification",
  {
    description:
      "Count of Turnstile verification attempts performed by the server; error.type is set for rejected or failed verifications.",
    unit: "{verification}",
  },
);
const loadedBoardsGauge = meter.createObservableGauge("wbo.board.loaded", {
  description: "Current number of board instances loaded in server memory.",
  unit: "{board}",
});
const activeSocketConnectionsGauge = meter.createObservableGauge(
  "wbo.socket.connection.active",
  {
    description:
      "Current number of active Socket.IO connections tracked by the server.",
    unit: "{connection}",
  },
);
const connectedUsersGauge = meter.createObservableGauge(
  "wbo.board.user.connected",
  {
    description:
      "Current number of active socket-to-board memberships across loaded boards; one socket joined to two boards contributes 2.",
    unit: "{user}",
  },
);
loadedBoardsGauge.addCallback(function observeLoadedBoards(observer) {
  observer.observe(runtimeState.loadedBoards);
});
activeSocketConnectionsGauge.addCallback(
  function observeSocketConnections(observer) {
    observer.observe(runtimeState.activeSocketConnections);
  },
);
connectedUsersGauge.addCallback(function observeConnectedUsers(observer) {
  observer.observe(runtimeState.connectedUsers);
});

/**
 * @returns {import("@opentelemetry/sdk-logs").LogRecordProcessor[]}
 */
function buildLogRecordProcessors() {
  /** @type {import("@opentelemetry/sdk-logs").LogRecordProcessor[]} */
  const processors = [
    new SimpleLogRecordProcessor(new LogfmtLogRecordExporter()),
  ];
  if (hasConfiguredOtlpEndpoint("logs")) {
    processors.push(new BatchLogRecordProcessor(new OTLPLogExporter()));
  }
  return processors;
}

/**
 * @param {import("@opentelemetry/sdk-logs").ReadableLogRecord} record
 * @param {{colorizeLevel?: boolean}=} options
 * @returns {string}
 */
function formatReadableLogRecord(record, options) {
  const level = normalizeSeverityText(
    record.severityText,
    record.severityNumber,
  );
  const spanContext = record.spanContext;
  /** @type {{trace_id?: string, span_id?: string}} */
  const spanFields = {};
  if (spanContext && shouldRenderLogSpanContext(spanContext)) {
    spanFields.trace_id = spanContext.traceId;
    spanFields.span_id = spanContext.spanId;
  }
  const body =
    typeof record.body === "string"
      ? record.body
      : record.body === undefined || record.body === null
        ? undefined
        : String(record.body);
  const line = formatCanonicalLogLine({
    ts: hrTimeToDate(record.hrTime),
    level,
    event: record.eventName || "log",
    ...(body && body !== record.eventName ? { msg: body } : {}),
    ...spanFields,
    ...record.attributes,
  });
  return options?.colorizeLevel ? styleTerminalLogLine(line, level) : line;
}

/**
 * Only render correlation IDs when the attached span context is valid and
 * sampled, otherwise the log line points at traces that will never exist in
 * the backend.
 *
 * @param {import("@opentelemetry/api").SpanContext | undefined} spanContext
 * @returns {boolean}
 */
function shouldRenderLogSpanContext(spanContext) {
  return Boolean(
    spanContext &&
      isSpanContextValid(spanContext) &&
      (spanContext.traceFlags & 0x1) === 0x1,
  );
}

/**
 * @param {NodeJS.WriteStream | undefined} stream
 * @returns {boolean}
 */
function streamSupportsColor(stream) {
  if (process.env.FORCE_COLOR === "0") return false;
  if (
    typeof process.env.FORCE_COLOR === "string" &&
    process.env.FORCE_COLOR !== ""
  ) {
    return true;
  }
  if (process.env.NO_COLOR !== undefined) return false;
  if (!stream || stream.isTTY !== true) return false;
  if (typeof stream.hasColors === "function") {
    try {
      if (stream.hasColors()) return true;
    } catch {}
  }
  return process.env.TERM !== "dumb";
}

/**
 * @param {[number, number]} hrTime
 * @returns {Date}
 */
function hrTimeToDate(hrTime) {
  return new Date(hrTime[0] * 1000 + hrTime[1] / 1e6);
}

/**
 * @param {string | undefined} severityText
 * @param {number | undefined} severityNumber
 * @returns {string}
 */
function normalizeSeverityText(severityText, severityNumber) {
  if (typeof severityText === "string" && severityText !== "") {
    return severityText.toLowerCase();
  }
  if (severityNumber === undefined) return "info";
  if (severityNumber >= SeverityNumber.ERROR) return "error";
  if (severityNumber >= SeverityNumber.WARN) return "warn";
  if (severityNumber >= SeverityNumber.INFO) return "info";
  return "debug";
}

/**
 * @param {"debug"|"info"|"warn"|"error"} level
 * @returns {number}
 */
function severityNumberForLevel(level) {
  switch (level) {
    case "debug":
      return SeverityNumber.DEBUG;
    case "warn":
      return SeverityNumber.WARN;
    case "error":
      return SeverityNumber.ERROR;
    default:
      return SeverityNumber.INFO;
  }
}

/**
 * @param {unknown} value
 * @returns {import("@opentelemetry/api-logs").AnyValue | undefined}
 */
function toLogAttributeValue(value) {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * @param {{[key: string]: unknown}=} fields
 * @returns {import("@opentelemetry/api-logs").AnyValueMap}
 */
function normalizeLogAttributes(fields) {
  /** @type {import("@opentelemetry/api-logs").AnyValueMap} */
  const attributes = {};
  if (!fields) return attributes;
  for (const [key, value] of Object.entries(fields)) {
    const attributeValue = toLogAttributeValue(value);
    if (attributeValue !== undefined) {
      attributes[key] = attributeValue;
    }
  }
  return attributes;
}

/**
 * @param {unknown} value
 * @returns {string | number | boolean | (string | number | boolean)[] | undefined}
 */
function toSpanAttributeValue(value) {
  if (value === undefined) return undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const normalized = value
      .map(function normalizeArrayValue(entry) {
        if (
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        ) {
          return entry;
        }
        if (entry instanceof Date) return entry.toISOString();
        return undefined;
      })
      .filter(function isDefined(entry) {
        return entry !== undefined;
      });
    return normalized.length === value.length ? normalized : undefined;
  }
  return JSON.stringify(value);
}

/**
 * @param {{[key: string]: unknown}=} fields
 * @returns {{[key: string]: any}}
 */
function normalizeSpanAttributes(fields) {
  /** @type {{[key: string]: any}} */
  const attributes = {};
  if (!fields) return attributes;
  for (const [key, value] of Object.entries(fields)) {
    const attributeValue = toSpanAttributeValue(value);
    if (attributeValue !== undefined) {
      attributes[key] = attributeValue;
    }
  }
  return attributes;
}

/**
 * @returns {import("@opentelemetry/api").Span | undefined}
 */
function getActiveSpan() {
  if (!tracingEnabled) return undefined;
  return trace.getActiveSpan();
}

/**
 * @param {import("@opentelemetry/api").Span} span
 * @param {{[key: string]: unknown}=} attributes
 * @returns {void}
 */
function setSpanAttributes(span, attributes) {
  const normalized = normalizeSpanAttributes(attributes);
  if (Object.keys(normalized).length > 0) {
    span.setAttributes(/** @type {any} */ (normalized));
  }
}

/**
 * @param {{[key: string]: unknown}=} attributes
 * @returns {void}
 */
function setActiveSpanAttributes(attributes) {
  const activeSpan = getActiveSpan();
  if (!activeSpan) return;
  setSpanAttributes(activeSpan, attributes);
}

/**
 * @param {import("@opentelemetry/api").Span} span
 * @param {string} name
 * @param {{[key: string]: unknown}=} attributes
 * @returns {void}
 */
function addSpanEvent(span, name, attributes) {
  span.addEvent(name, /** @type {any} */ (normalizeSpanAttributes(attributes)));
}

/**
 * @param {string} name
 * @param {{[key: string]: unknown}=} attributes
 * @returns {void}
 */
function addActiveSpanEvent(name, attributes) {
  const activeSpan = getActiveSpan();
  if (!activeSpan) return;
  addSpanEvent(activeSpan, name, attributes);
}

/**
 * @param {import("@opentelemetry/api").Span} span
 * @param {unknown} error
 * @param {{[key: string]: unknown}=} attributes
 * @returns {void}
 */
function recordSpanError(span, error, attributes) {
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    setSpanAttributes(span, {
      "error.type": error.name || "Error",
      ...attributes,
    });
    return;
  }
  span.recordException({ message: String(error) });
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: String(error),
  });
  setSpanAttributes(span, { "error.type": typeof error, ...attributes });
}

/**
 * @param {unknown} error
 * @param {{[key: string]: unknown}=} attributes
 * @returns {void}
 */
function recordActiveSpanError(error, attributes) {
  const activeSpan = getActiveSpan();
  if (!activeSpan) return;
  recordSpanError(activeSpan, error, attributes);
}

/**
 * @param {import("@opentelemetry/api").Context} spanContext
 * @param {() => any} fn
 * @returns {any}
 */
function withContext(spanContext, fn) {
  return context.with(spanContext, fn);
}

/**
 * @param {{[key: string]: string | string[] | undefined}} carrier
 * @returns {import("@opentelemetry/api").Context}
 */
function extractContext(carrier) {
  if (!tracingEnabled) return context.active();
  return propagation.extract(context.active(), carrier);
}

/**
 * @param {string} name
 * @param {{
 *   parentContext?: import("@opentelemetry/api").Context,
 *   kind?: number,
 *   attributes?: {[key: string]: unknown},
 * } | undefined} options
 * @returns {import("@opentelemetry/api").Span | null}
 */
function startSpan(name, options) {
  if (!tracingEnabled) return null;
  return tracer.startSpan(
    name,
    {
      kind: options?.kind,
      attributes: /** @type {any} */ (
        normalizeSpanAttributes(options?.attributes)
      ),
    },
    options?.parentContext || context.active(),
  );
}

/**
 * @param {import("@opentelemetry/api").Span | null} span
 * @param {import("@opentelemetry/api").Context | undefined} parentContext
 * @param {() => any} fn
 * @returns {any}
 */
function withSpanContext(span, parentContext, fn) {
  if (!span) return fn();
  return withContext(
    trace.setSpan(parentContext || context.active(), span),
    fn,
  );
}

/**
 * @param {string} name
 * @param {{
 *   parentContext?: import("@opentelemetry/api").Context,
 *   kind?: number,
 *   attributes?: {[key: string]: unknown},
 * } | undefined} options
 * @param {(span: import("@opentelemetry/api").Span | undefined) => any} fn
 * @returns {any}
 */
function withActiveSpan(name, options, fn) {
  if (!tracingEnabled) return fn(undefined);
  const parentContext = options?.parentContext || context.active();
  return withContext(parentContext, function runSpan() {
    return tracer.startActiveSpan(
      name,
      {
        kind: options?.kind,
        attributes: /** @type {any} */ (
          normalizeSpanAttributes(options?.attributes)
        ),
      },
      function handleSpan(span) {
        try {
          const result = fn(span);
          if (result && typeof result.then === "function") {
            return Promise.resolve(result)
              .catch(function recordAsyncSpanError(error) {
                recordSpanError(span, error);
                throw error;
              })
              .finally(function endAsyncSpan() {
                span.end();
              });
          }
          span.end();
          return result;
        } catch (error) {
          recordSpanError(span, error);
          span.end();
          throw error;
        }
      },
    );
  });
}

/**
 * @param {string} name
 * @param {{
 *   kind?: number,
 *   attributes?: {[key: string]: unknown},
 * } | undefined} options
 * @param {() => any} fn
 * @returns {any}
 */
function withOptionalActiveSpan(name, options, fn) {
  const activeSpan = getActiveSpan();
  if (!activeSpan) return fn();
  return withActiveSpan(
    name,
    {
      kind: options?.kind,
      attributes: options?.attributes,
    },
    function runOptionalSpan() {
      return fn();
    },
  );
}

/**
 * Create a span when the current trace is already recording, or when the
 * caller explicitly marks the work as large enough to deserve its own root
 * span.
 *
 * @param {string} name
 * @param {{
 *   kind?: number,
 *   attributes?: {[key: string]: unknown},
 *   traceRoot?: boolean,
 * } | undefined} options
 * @param {(span: import("@opentelemetry/api").Span | undefined) => any} fn
 * @returns {any}
 */
function withExpensiveActiveSpan(name, options, fn) {
  const activeSpan = getActiveSpan();
  if (activeSpan?.isRecording()) {
    return withActiveSpan(
      name,
      {
        kind: options?.kind,
        attributes: options?.attributes,
      },
      fn,
    );
  }
  if (!options?.traceRoot) return fn(undefined);
  return withActiveSpan(
    name,
    {
      parentContext: ROOT_CONTEXT,
      kind: options?.kind,
      attributes: options?.attributes,
    },
    fn,
  );
}

/**
 * @param {string} name
 * @param {{
 *   kind?: number,
 *   attributes?: {[key: string]: unknown},
 * } | undefined} options
 * @param {() => any} fn
 * @returns {any}
 */
function withDetachedSpan(name, options, fn) {
  const activeSpan = getActiveSpan();
  if (activeSpan) {
    setSpanAttributes(activeSpan, options?.attributes);
    addSpanEvent(activeSpan, name, options?.attributes);
  }
  return fn();
}

/**
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} name
 * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
 * @returns {{
 *   context: import("@opentelemetry/api").Context,
 *   eventName: string,
 *   severityNumber: number,
 *   severityText: string,
 *   body: string | undefined,
 *   attributes: import("@opentelemetry/api-logs").AnyValueMap,
 *   exception: unknown,
 * }}
 */
function createLogRecord(level, name, fields) {
  const details = { ...fields };
  const message =
    typeof details.msg === "string" && details.msg !== "" ? details.msg : null;
  delete details.msg;

  const error = details.error;
  delete details.error;

  return {
    context: context.active(),
    eventName: name,
    severityNumber: severityNumberForLevel(level),
    severityText: level.toUpperCase(),
    body: message === null ? undefined : message,
    attributes: normalizeLogAttributes({
      ...details,
      ...flattenError(error),
    }),
    exception: error,
  };
}

/**
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} name
 * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
 * @returns {void}
 */
function emitLog(level, name, fields) {
  if (!shouldEmitLog(level)) return;
  otelLogger.emit(createLogRecord(level, name, fields));
}

/**
 * @param {"debug"|"info"|"warn"|"error"} level
 * @returns {boolean}
 */
function shouldEmitLog(level) {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[MIN_LOG_LEVEL];
}

/**
 * @param {{
 *   change: 1 | -1,
 *   method: string,
 *   scheme: string,
 *   serverAddress?: string,
 * }}
 * request
 * @returns {void}
 */
function changeHttpActiveRequests(request) {
  /** @type {{[key: string]: string | number | boolean}} */
  const attributes = {
    [ATTR_HTTP_REQUEST_METHOD]: request.method,
    [ATTR_URL_SCHEME]: request.scheme,
  };
  if (request.serverAddress) {
    attributes[ATTR_SERVER_ADDRESS] = request.serverAddress;
  }
  httpServerActiveRequests.add(request.change, attributes);
}

/**
 * @param {{
 *   method: string,
 *   route?: string,
 *   scheme: string,
 *   statusCode: number,
 *   durationSeconds: number,
 *   errorType?: string,
 * }}
 * request
 * @returns {void}
 */
function recordHttpRequest(request) {
  /** @type {{[key: string]: string | number | boolean}} */
  const attributes = {
    [ATTR_HTTP_REQUEST_METHOD]: request.method,
    [ATTR_URL_SCHEME]: request.scheme,
    [ATTR_HTTP_RESPONSE_STATUS_CODE]: request.statusCode,
  };
  if (request.route) attributes[ATTR_HTTP_ROUTE] = request.route;
  if (request.errorType) attributes[ATTR_ERROR_TYPE] = request.errorType;
  httpServerRequestDuration.record(request.durationSeconds, attributes);
}

/**
 * @param {unknown} errorType
 * @returns {string | undefined}
 */
function normalizeMetricErrorType(errorType) {
  if (errorType === undefined || errorType === null || errorType === "") {
    return undefined;
  }
  if (typeof errorType === "string") return errorType;
  if (errorType instanceof Error) {
    const errorCode = /** @type {{code?: unknown}} */ (errorType).code;
    if (typeof errorCode === "string" && errorCode !== "") {
      return errorCode;
    }
    if (errorType.name) return errorType.name;
    return "Error";
  }
  return typeof errorType;
}

/**
 * @param {string | undefined} boardName
 * @returns {boolean | undefined}
 */
function metricBoardAnonymous(boardName) {
  if (typeof boardName !== "string" || boardName === "") return undefined;
  return boardName === "anonymous";
}

/**
 * @param {number} limit
 * @param {number} periodMs
 * @returns {string}
 */
function formatRateLimitProfile(limit, periodMs) {
  return `${limit}/${periodMs}ms`;
}

/**
 * @param {{event: string, durationMs: number, errorType?: unknown}} event
 * @returns {void}
 */
function recordSocketEvent(event) {
  /** @type {{[key: string]: string}} */
  const attributes = {
    "wbo.socket.event": event.event,
  };
  const errorType = normalizeMetricErrorType(event.errorType);
  if (errorType) attributes[ATTR_ERROR_TYPE] = errorType;
  socketEventDuration.record(event.durationMs / 1000, attributes);
}

/**
 * @param {"connected"|"disconnected"} event
 * @returns {void}
 */
function recordSocketConnection(event) {
  socketConnections.add(1, {
    "wbo.socket.connection.event": event,
  });
}

/**
 * @param {{board?: string, tool?: string | number, type?: string | number}} message
 * @param {string=} errorType
 * @returns {void}
 */
function recordBoardMessage(message, errorType) {
  /** @type {{[key: string]: string | boolean}} */
  const attributes = {
    "wbo.tool": getToolId(message.tool) || "unknown",
    "wbo.message.type": String(message.type || "unknown"),
  };
  const boardAnonymous = metricBoardAnonymous(message.board);
  if (boardAnonymous !== undefined) {
    attributes["wbo.board.anonymous"] = boardAnonymous;
  }
  const normalizedErrorType = normalizeMetricErrorType(errorType);
  if (normalizedErrorType) {
    attributes[ATTR_ERROR_TYPE] = normalizedErrorType;
  }
  boardMessages.add(1, attributes);
}

/**
 * @param {{
 *   boardAnonymous?: boolean,
 *   kind: "general" | "constructive" | "destructive" | "text",
 *   limit: number,
 *   outcome: "disconnect" | "exceeded" | "expired" | "pruned",
 *   periodMs: number,
 *   scope: "ip" | "socket",
 *   used: number,
 * }} sample
 * @returns {void}
 */
function recordRateLimitWindowUtilization(sample) {
  const limit = Number(sample.limit);
  const used = Number(sample.used);
  const periodMs = Number(sample.periodMs);
  if (!(limit > 0) || used < 0 || !(periodMs > 0)) return;
  /** @type {{[key: string]: string | number | boolean}} */
  const attributes = {
    "wbo.rate_limit.kind": sample.kind,
    "wbo.rate_limit.limit": limit,
    "wbo.rate_limit.period_ms": periodMs,
    "wbo.rate_limit.profile": formatRateLimitProfile(limit, periodMs),
    "wbo.rate_limit.scope": sample.scope,
    "wbo.rate_limit.window.outcome": sample.outcome,
  };
  if (typeof sample.boardAnonymous === "boolean") {
    attributes["wbo.board.anonymous"] = sample.boardAnonymous;
  }
  rateLimitWindowUtilization.record(used / limit, attributes);
}

/**
 * @param {unknown=} errorType
 * @returns {void}
 */
function recordTurnstileVerification(errorType) {
  /** @type {{[key: string]: string}} */
  const attributes = {};
  const normalizedErrorType = normalizeMetricErrorType(errorType);
  if (normalizedErrorType) {
    attributes[ATTR_ERROR_TYPE] = normalizedErrorType;
  }
  turnstileVerifications.add(1, attributes);
}

/**
 * @param {string} operation
 * @param {string | undefined} boardName
 * @param {number} durationSeconds
 * @param {unknown=} errorType
 * @returns {void}
 */
function recordBoardOperationDuration(
  operation,
  boardName,
  durationSeconds,
  errorType,
) {
  /** @type {{[key: string]: string | boolean}} */
  const attributes = {
    "wbo.board.operation": operation,
  };
  const boardAnonymous = metricBoardAnonymous(boardName);
  if (boardAnonymous !== undefined) {
    attributes["wbo.board.anonymous"] = boardAnonymous;
  }
  const normalizedErrorType = normalizeMetricErrorType(errorType);
  if (normalizedErrorType) {
    attributes[ATTR_ERROR_TYPE] = normalizedErrorType;
  }
  boardOperationDuration.record(durationSeconds, attributes);
}

/**
 * @param {number} value
 * @returns {void}
 */
function setLoadedBoards(value) {
  runtimeState.loadedBoards = value;
}

/**
 * @param {number} value
 * @returns {void}
 */
function setConnectedUsers(value) {
  runtimeState.connectedUsers = value;
}

/**
 * @param {number} value
 * @returns {void}
 */
function setActiveSocketConnections(value) {
  runtimeState.activeSocketConnections = value;
}

function createRequestId() {
  return randomUUID();
}

function shutdownObservability() {
  return sdk.shutdown();
}

const logger = {
  /**
   * @param {"debug"|"info"|"warn"|"error"} level
   * @returns {boolean}
   */
  isEnabled: function isEnabled(level) {
    return shouldEmitLog(level);
  },
  /**
   * @param {string} name
   * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
   */
  debug: function debug(name, fields) {
    emitLog("debug", name, fields);
  },
  /**
   * @param {string} name
   * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
   */
  info: function info(name, fields) {
    emitLog("info", name, fields);
  },
  /**
   * @param {string} name
   * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
   */
  warn: function warn(name, fields) {
    emitLog("warn", name, fields);
  },
  /**
   * @param {string} name
   * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
   */
  error: function error(name, fields) {
    emitLog("error", name, fields);
  },
};

const observabilityMetrics = {
  recordBoardMessage,
  changeHttpActiveRequests,
  recordBoardOperationDuration,
  recordHttpRequest,
  recordRateLimitWindowUtilization,
  recordSocketConnection,
  recordSocketEvent,
  recordTurnstileVerification,
  setActiveSocketConnections,
  setConnectedUsers,
  setLoadedBoards,
};

const tracing = {
  addActiveSpanEvent,
  extractContext,
  recordActiveSpanError,
  recordSpanError,
  setSpanAttributes,
  setActiveSpanAttributes,
  startSpan,
  withActiveSpan,
  withDetachedSpan,
  withExpensiveActiveSpan,
  withOptionalActiveSpan,
  withSpanContext,
  SpanKind,
  SpanStatusCode,
};

const __test = {
  createLogRecord,
  shouldEmitLog,
  tracingEnabled: function tracingEnabledForTest() {
    return tracingEnabled;
  },
};

const observability = {
  LogfmtLogRecordExporter,
  __test,
  createRequestId,
  formatReadableLogRecord,
  logger,
  metrics: observabilityMetrics,
  shutdownObservability,
  tracing,
};

export {
  __test,
  createRequestId,
  formatReadableLogRecord,
  LogfmtLogRecordExporter,
  logger,
  observabilityMetrics as metrics,
  shutdownObservability,
  tracing,
};

export default observability;
