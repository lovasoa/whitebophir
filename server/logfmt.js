const DEFAULT_SERVICE_NAME = "whitebophir-server";
const ENVELOPE_KEYS = ["ts", "level", "event", "msg"];
const ANSI_DIM = "\x1b[2m";
const ANSI_RESET = "\x1b[0m";
/** @type {{[level: string]: string}} */
const LEVEL_COLORS = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

/**
 * @param {unknown} error
 * @returns {{
 *   "exception.type"?: string,
 *   "exception.message"?: string,
 *   "exception.stacktrace"?: string,
 * }}
 */
function flattenError(error) {
  if (!(error instanceof Error)) {
    if (error === undefined) return {};
    return { "exception.message": String(error) };
  }
  return {
    "exception.type": error.name || "Error",
    "exception.message": error.message,
    "exception.stacktrace": error.stack,
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function serializeValue(value) {
  if (value === null) return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatLogfmtValue(value) {
  const serialized = serializeValue(value);
  if (serialized === "") return '""';
  if (/^[A-Za-z0-9._:/@-]+$/.test(serialized)) return serialized;
  return `"${serialized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * @param {{ts?: string|number|Date, level?: string, msg?: string, event?: string, [key: string]: unknown}} fields
 * @returns {string}
 */
function formatCanonicalLogLine(fields) {
  /** @type {{[key: string]: unknown}} */
  const normalized = Object.assign({}, fields);
  normalized.ts =
    normalized.ts instanceof Date
      ? normalized.ts.toISOString()
      : typeof normalized.ts === "number"
        ? new Date(normalized.ts).toISOString()
        : normalized.ts || new Date().toISOString();
  normalized.level =
    typeof normalized.level === "string" ? normalized.level : "info";
  normalized.event =
    typeof normalized.event === "string" && normalized.event !== ""
      ? normalized.event
      : "log";
  if (!(typeof normalized.msg === "string" && normalized.msg !== "")) {
    delete normalized.msg;
  }

  /** @type {string[]} */
  const parts = [];
  for (const key of ENVELOPE_KEYS) {
    const value = normalized[key];
    if (value !== undefined) {
      parts.push(`${key}=${formatLogfmtValue(value)}`);
    }
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (ENVELOPE_KEYS.includes(key) || value === undefined) continue;
    parts.push(`${key}=${formatLogfmtValue(value)}`);
  }
  return parts.join(" ");
}

/**
 * @param {string} line
 * @param {string} level
 * @returns {string}
 */
function colorizeLevelInLogLine(line, level) {
  const color = LEVEL_COLORS[level];
  if (!color) return line;
  return line.replace(
    /(^| )level=([A-Za-z0-9._:/@-]+)(?= |$)/,
    `$1level=${color}$2${ANSI_RESET}`,
  );
}

/**
 * @param {string} line
 * @returns {string}
 */
function dimLogLineKeys(line) {
  return line.replace(
    /(^| )([A-Za-z0-9_.-]+=)/g,
    `$1${ANSI_DIM}$2${ANSI_RESET}`,
  );
}

/**
 * @param {string} line
 * @param {string} level
 * @returns {string}
 */
function styleTerminalLogLine(line, level) {
  return dimLogLineKeys(colorizeLevelInLogLine(line, level));
}

module.exports = {
  DEFAULT_SERVICE_NAME,
  colorizeLevelInLogLine,
  dimLogLineKeys,
  flattenError,
  formatCanonicalLogLine,
  formatLogfmtValue,
  styleTerminalLogLine,
};
