"use strict";

const { randomUUID } = require("node:crypto");
const { metrics } = require("@opentelemetry/api");
const { logs, SeverityNumber } = require("@opentelemetry/api-logs");
const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-http");
const {
  OTLPMetricExporter,
} = require("@opentelemetry/exporter-metrics-otlp-http");
const { resourceFromAttributes } = require("@opentelemetry/resources");
const {
  LoggerProvider,
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} = require("@opentelemetry/sdk-logs");
const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  SEMRESATTRS_SERVICE_NAME,
} = require("@opentelemetry/semantic-conventions");

const {
  DEFAULT_SERVICE_NAME,
  flattenError,
  formatCanonicalLogLine,
  styleTerminalLogLine,
} = require("./logfmt.js");

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;

/**
 * @param {"logs"|"metrics"} signal
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
      (options && options.writeStdout) ||
      function writeStdout(chunk) {
        globalThis.console.log(chunk.replace(/\n$/, ""));
      };
    this.writeStderr =
      (options && options.writeStderr) ||
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
      const level = normalizeSeverityText(
        record.severityText,
        record.severityNumber,
      );
      const useStderr =
        record.severityNumber !== undefined &&
        record.severityNumber >= SeverityNumber.ERROR;
      const line =
        formatReadableLogRecord(record, {
          colorizeLevel: useStderr
            ? this.stderrSupportsColor
            : this.stdoutSupportsColor,
        }) + "\n";
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
});

sdk.start();

const meter = metrics.getMeter(SERVICE_NAME);
const otelLogger = logs.getLogger(SERVICE_NAME);

const runtimeState = {
  loadedBoards: 0,
  connectedUsers: 0,
};

const httpRequests = meter.createCounter("wbo_http_requests_total", {
  description: "Total completed HTTP requests.",
});
const httpRequestDuration = meter.createHistogram(
  "wbo_http_request_duration_ms",
  {
    description: "HTTP request duration in milliseconds.",
    unit: "ms",
  },
);
const socketEvents = meter.createCounter("wbo_socket_events_total", {
  description: "Total handled socket events.",
});
const socketEventDuration = meter.createHistogram(
  "wbo_socket_event_duration_ms",
  {
    description: "Socket event duration in milliseconds.",
    unit: "ms",
  },
);
const boardOperations = meter.createCounter("wbo_board_operations_total", {
  description: "Board operation outcomes.",
});
const rejections = meter.createCounter("wbo_rejections_total", {
  description: "Rejected operations by kind and reason.",
});
const loadedBoardsGauge = meter.createObservableGauge("wbo_boards_loaded", {
  description: "Boards currently loaded in memory.",
});
const connectedUsersGauge = meter.createObservableGauge("wbo_connected_users", {
  description: "Users currently connected across loaded boards.",
});
const heapUsedGauge = meter.createObservableGauge("wbo_heap_used_bytes", {
  description: "Current V8 heap usage in bytes.",
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
  return options && options.colorizeLevel
    ? styleTerminalLogLine(line, level)
    : line;
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
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} name
 * @param {{msg?: string, error?: unknown, [key: string]: unknown}=} fields
 * @returns {void}
 */
function emitLog(level, name, fields) {
  const details = Object.assign({}, fields);
  const message =
    typeof details.msg === "string" && details.msg !== "" ? details.msg : null;
  delete details.msg;

  const error = details.error;
  delete details.error;

  otelLogger.emit({
    eventName: name,
    severityNumber: severityNumberForLevel(level),
    severityText: level.toUpperCase(),
    body: message === null ? undefined : message,
    attributes: normalizeLogAttributes(
      Object.assign(details, flattenError(error)),
    ),
    exception: error,
  });
}

/**
 * @param {number} statusCode
 * @returns {string}
 */
function statusClass(statusCode) {
  return `${Math.floor(statusCode / 100)}xx`;
}

/**
 * @param {{
 *   method: string,
 *   route: string,
 *   statusCode: number,
 *   durationMs: number,
 * }}
 * request
 * @returns {void}
 */
function recordHttpRequest(request) {
  const attributes = {
    method: request.method,
    route: request.route,
    status_class: statusClass(request.statusCode),
  };
  httpRequests.add(1, attributes);
  httpRequestDuration.record(request.durationMs, attributes);
}

/**
 * @param {{event: string, result: string, durationMs: number}} event
 * @returns {void}
 */
function recordSocketEvent(event) {
  const attributes = { event: event.event, result: event.result };
  socketEvents.add(1, attributes);
  socketEventDuration.record(event.durationMs, attributes);
}

/**
 * @param {string} operation
 * @param {string} result
 * @returns {void}
 */
function recordBoardOperation(operation, result) {
  boardOperations.add(1, { operation, result });
}

/**
 * @param {string} kind
 * @param {string} reason
 * @returns {void}
 */
function recordRejection(kind, reason) {
  rejections.add(1, { kind, reason });
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
    recordBoardOperation,
    recordHttpRequest,
    recordRejection,
    recordSocketEvent,
    setConnectedUsers,
    setLoadedBoards,
  },
  shutdownObservability,
};
