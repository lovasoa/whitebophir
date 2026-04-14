const { randomUUID } = require("node:crypto");
const {
  context,
  isSpanContextValid,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} = require("@opentelemetry/api");
const { logs, SeverityNumber } = require("@opentelemetry/api-logs");
const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-http");
const {
  OTLPTraceExporter,
} = require("@opentelemetry/exporter-trace-otlp-http");
const {
  OTLPMetricExporter,
} = require("@opentelemetry/exporter-metrics-otlp-http");
const { resourceFromAttributes } = require("@opentelemetry/resources");
const {
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} = require("@opentelemetry/sdk-logs");
const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const {
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} = require("@opentelemetry/sdk-trace-base");
const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_URL_SCHEME,
  SEMRESATTRS_SERVICE_NAME,
} = require("@opentelemetry/semantic-conventions");

const {
  DEFAULT_SERVICE_NAME,
  flattenError,
  formatCanonicalLogLine,
  styleTerminalLogLine,
} = require("./logfmt.js");

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
const DEFAULT_TRACE_SAMPLE_RATIO = 0.05;
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
  }),
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

const meter = metrics.getMeter(SERVICE_NAME);
const otelLogger = logs.getLogger(SERVICE_NAME);
const tracer = trace.getTracer(SERVICE_NAME);

const runtimeState = {
  loadedBoards: 0,
  connectedUsers: 0,
};

const httpServerRequestDuration = meter.createHistogram(
  "http.server.request.duration",
  {
    description: "Duration of HTTP server requests.",
    unit: "s",
  },
);
const httpServerActiveRequests = meter.createUpDownCounter(
  "http.server.active_requests",
  {
    description: "Number of active HTTP server requests.",
    unit: "{request}",
  },
);
const socketEvents = meter.createCounter("wbo.socket.events", {
  description: "Socket events handled by the server.",
  unit: "{event}",
});
const socketEventDuration = meter.createHistogram("wbo.socket.event.duration", {
  description: "Duration of socket event handlers.",
  unit: "s",
});
const boardOperations = meter.createCounter("wbo.board.operations", {
  description: "Board operation outcomes.",
  unit: "{operation}",
});
const rejections = meter.createCounter("wbo.rejections", {
  description: "Rejected operations by kind and reason.",
  unit: "{rejection}",
});
const loadedBoardsGauge = meter.createObservableGauge("wbo.board.loaded", {
  description: "Boards currently loaded in memory.",
});
const connectedUsersGauge = meter.createObservableGauge(
  "wbo.board.user.connected",
  {
    description: "Active board memberships connected across loaded boards.",
  },
);
const heapUsedGauge = meter.createObservableGauge("wbo.runtime.heap.used", {
  description: "Current V8 heap memory usage.",
  unit: "By",
});

loadedBoardsGauge.addCallback(function observeLoadedBoards(observer) {
  observer.observe(runtimeState.loadedBoards);
});
connectedUsersGauge.addCallback(function observeConnectedUsers(observer) {
  observer.observe(runtimeState.connectedUsers);
});
heapUsedGauge.addCallback(function observeHeapUsed(observer) {
  observer.observe(process.memoryUsage().heapUsed);
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
  const body =
    typeof record.body === "string"
      ? record.body
      : record.body === undefined || record.body === null
        ? undefined
        : String(record.body);
  const line = formatCanonicalLogLine(
    Object.assign(
      {
        ts: hrTimeToDate(record.hrTime),
        level: level,
        event: record.eventName || "log",
      },
      body && body !== record.eventName ? { msg: body } : {},
      record.attributes,
    ),
  );
  return options?.colorizeLevel ? styleTerminalLogLine(line, level) : line;
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
 * @returns {{trace_id?: string, span_id?: string}}
 */
function getActiveTraceFields() {
  if (!tracingEnabled) return {};
  const activeSpan = getActiveSpan();
  if (!activeSpan?.isRecording()) return {};
  const spanContext = activeSpan.spanContext();
  if (!isSpanContextValid(spanContext)) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
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
    setSpanAttributes(
      span,
      Object.assign(
        {
          "error.type": error.name || "Error",
        },
        attributes,
      ),
    );
    return;
  }
  span.recordException({ message: String(error) });
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: String(error),
  });
  setSpanAttributes(
    span,
    Object.assign({ "error.type": typeof error }, attributes),
  );
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
    return fn();
  }
  return withActiveSpan(
    name,
    {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    },
    function runDetachedSpan() {
      return fn();
    },
  );
}

/**
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} name
 * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
 * @returns {{
 *   eventName: string,
 *   severityNumber: number,
 *   severityText: string,
 *   body: string | undefined,
 *   attributes: import("@opentelemetry/api-logs").AnyValueMap,
 *   exception: unknown,
 * }}
 */
function createLogRecord(level, name, fields) {
  const details = Object.assign({}, fields);
  const message =
    typeof details.msg === "string" && details.msg !== "" ? details.msg : null;
  delete details.msg;

  const error = details.error;
  delete details.error;

  return {
    eventName: name,
    severityNumber: severityNumberForLevel(level),
    severityText: level.toUpperCase(),
    body: message === null ? undefined : message,
    attributes: normalizeLogAttributes(
      Object.assign(getActiveTraceFields(), details, flattenError(error)),
    ),
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
  otelLogger.emit(createLogRecord(level, name, fields));
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
 * @param {{event: string, result: string, durationMs: number}} event
 * @returns {void}
 */
function recordSocketEvent(event) {
  const attributes = {
    "wbo.socket.event": event.event,
    "wbo.socket.result": event.result,
  };
  socketEvents.add(1, attributes);
  socketEventDuration.record(event.durationMs / 1000, attributes);
}

/**
 * @param {string} operation
 * @param {string} result
 * @returns {void}
 */
function recordBoardOperation(operation, result) {
  boardOperations.add(1, {
    "wbo.board.operation": operation,
    "wbo.board.result": result,
  });
}

/**
 * @param {string} kind
 * @param {string} reason
 * @returns {void}
 */
function recordRejection(kind, reason) {
  rejections.add(1, {
    "wbo.rejection.kind": kind,
    "wbo.rejection.reason": reason,
  });
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

function createRequestId() {
  return randomUUID();
}

function shutdownObservability() {
  return sdk.shutdown();
}

const logger = {
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

module.exports = {
  LogfmtLogRecordExporter,
  createRequestId,
  formatReadableLogRecord,
  logger,
  metrics: {
    changeHttpActiveRequests,
    recordBoardOperation,
    recordHttpRequest,
    recordRejection,
    recordSocketEvent,
    setConnectedUsers,
    setLoadedBoards,
  },
  shutdownObservability,
  tracing: {
    addActiveSpanEvent,
    extractContext,
    recordActiveSpanError,
    recordSpanError,
    setSpanAttributes,
    setActiveSpanAttributes,
    startSpan,
    withActiveSpan,
    withDetachedSpan,
    withOptionalActiveSpan,
    withSpanContext,
    SpanKind,
    SpanStatusCode,
  },
  __test: {
    createLogRecord,
    tracingEnabled: function tracingEnabledForTest() {
      return tracingEnabled;
    },
  },
};
