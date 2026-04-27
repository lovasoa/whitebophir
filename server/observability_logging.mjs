import { context, isSpanContextValid } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  DEFAULT_SERVICE_NAME,
  flattenError,
  formatCanonicalLogLine,
  styleTerminalLogLine,
} from "./logfmt.mjs";

const LOG_LEVELS = ["debug", "info", "warn", "error"];
const LOG_LEVEL_RANK = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   serviceName: string,
 *   minLogLevel: "debug"|"info"|"warn"|"error",
 *   otlpEndpoint: string,
 *   otlpLogsEndpoint: string,
 *   otlpMetricsEndpoint: string,
 *   otlpTracesEndpoint: string,
 *   tracesSamplerConfigured: boolean,
 *   silent: boolean,
 *   forceColor: string,
 *   noColor: boolean,
 *   term: string,
 *   testTraceExporter?: any,
 * }}
 */
function parseObservabilityOptions(env = process.env) {
  /**
   * @param {unknown} value
   * @returns {string}
   */
  const parseString = (value) => (typeof value === "string" ? value : "");
  const logLevel = parseString(env.LOG_LEVEL);
  return {
    serviceName: parseString(env.OTEL_SERVICE_NAME) || DEFAULT_SERVICE_NAME,
    minLogLevel: /** @type {"debug"|"info"|"warn"|"error"} */ (
      LOG_LEVELS.includes(logLevel) ? logLevel : "info"
    ),
    otlpEndpoint: parseString(env.OTEL_EXPORTER_OTLP_ENDPOINT),
    otlpLogsEndpoint: parseString(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT),
    otlpMetricsEndpoint: parseString(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT),
    otlpTracesEndpoint: parseString(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
    tracesSamplerConfigured:
      env.OTEL_TRACES_SAMPLER !== undefined ||
      env.OTEL_TRACES_SAMPLER_ARG !== undefined,
    silent: env.WBO_SILENT === "true",
    forceColor: parseString(env.FORCE_COLOR),
    noColor: env.NO_COLOR !== undefined,
    term: parseString(env.TERM),
    testTraceExporter: /** @type {{__WBO_TEST_TRACE_EXPORTER__?: any}} */ (
      globalThis
    ).__WBO_TEST_TRACE_EXPORTER__,
  };
}

class LogfmtLogRecordExporter {
  /**
   * @param {{
   *   writeStdout?: (chunk: string) => void,
   *   writeStderr?: (chunk: string) => void,
   *   stdoutSupportsColor?: boolean,
   *   stderrSupportsColor?: boolean,
   * }=} options
   * @param {ReturnType<typeof parseObservabilityOptions>=} observabilityOptions
   */
  constructor(options, observabilityOptions = parseObservabilityOptions()) {
    this.observabilityOptions = observabilityOptions;
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
        : streamSupportsColor(process.stdout, observabilityOptions);
    this.stderrSupportsColor =
      options && options.stderrSupportsColor !== undefined
        ? options.stderrSupportsColor
        : streamSupportsColor(process.stderr, observabilityOptions);
  }

  /**
   * @param {import("@opentelemetry/sdk-logs").ReadableLogRecord[]} records
   * @param {(result: {code: number}) => void} resultCallback
   */
  export(records, resultCallback) {
    if (this.observabilityOptions.silent) {
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
 * @param {ReturnType<typeof parseObservabilityOptions>} observabilityOptions
 * @returns {boolean}
 */
function streamSupportsColor(stream, observabilityOptions) {
  if (observabilityOptions.forceColor === "0") return false;
  if (observabilityOptions.forceColor !== "") {
    return true;
  }
  if (observabilityOptions.noColor) return false;
  if (!stream || stream.isTTY !== true) return false;
  if (typeof stream.hasColors === "function") {
    try {
      if (stream.hasColors()) return true;
    } catch {}
  }
  return observabilityOptions.term !== "dumb";
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
 * @param {"debug"|"info"|"warn"|"error"} minLogLevel
 * @returns {boolean}
 */
function shouldEmitLogAtLevel(level, minLogLevel) {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[minLogLevel];
}

export {
  createLogRecord,
  formatReadableLogRecord,
  LogfmtLogRecordExporter,
  parseObservabilityOptions,
  shouldEmitLogAtLevel,
};
