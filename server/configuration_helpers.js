/**
 * @param {string} name
 * @param {number} defaultValue
 * @returns {number}
 */
function parseIntegerEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * @param {string} text
 * @returns {number}
 */
function parseDurationMs(text) {
  const value = String(text || "").trim();
  const match = /^(\d+)(ms|s|m)$/i.exec(value);
  if (!match) {
    throw new Error(
      `Invalid rate-limit duration: ${value}. Expected formats like 500ms, 60s, or 2m.`,
    );
  }
  const amount = parseInt(match[1] || "", 10);
  const unit = (match[2] || "").toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  return amount * 60 * 1000;
}

/**
 * @param {string} name
 * @param {{limit: number, periodMs: number, overrides?: {[boardName: string]: {limit: number, periodMs: number}}}} defaultValue
 * @returns {{limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}}}
 */
function parseRateLimitProfileEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return {
      limit: defaultValue.limit,
      periodMs: defaultValue.periodMs,
      overrides: Object.assign({}, defaultValue.overrides || {}),
    };
  }

  const entries = value.trim().split(/\s+/);
  /** @type {{limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}}} */
  const parsed = {
    limit: defaultValue.limit,
    periodMs: defaultValue.periodMs,
    overrides: {},
  };

  entries.forEach(function parseEntry(entry) {
    const match = /^([^:\s]+):(\d+)\/(\d+(?:ms|s|m))$/i.exec(entry);
    if (!match) {
      throw new Error(
        `Invalid ${name}: ${value}. Expected entries like *:240/60s anonymous:120/60s.`,
      );
    }
    const boardName = match[1] || "";
    const definition = {
      limit: parseInt(match[2] || "", 10),
      periodMs: parseDurationMs(match[3] || ""),
    };
    if (boardName === "*") {
      parsed.limit = definition.limit;
      parsed.periodMs = definition.periodMs;
      return;
    }
    parsed.overrides[boardName.toLowerCase()] = definition;
  });

  return parsed;
}

/**
 * @template {string} T
 * @param {string} name
 * @param {T[]} allowedValues
 * @param {T} defaultValue
 * @returns {T}
 */
function parseEnumEnv(name, allowedValues, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;

  const normalizedValue = value.toLowerCase();
  const match = allowedValues.find(
    function findAllowed(/** @type {T} */ candidate) {
      return candidate.toLowerCase() === normalizedValue;
    },
  );
  if (match) return match;

  throw new Error(
    `Invalid ${name}: ${value}. Expected one of: ${allowedValues.join(", ")}`,
  );
}

module.exports = {
  parseEnumEnv,
  parseIntegerEnv,
  parseRateLimitProfileEnv,
};
