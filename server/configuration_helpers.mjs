/**
 * @param {string} name
 * @param {number} defaultValue
 * @returns {number}
 */
export function parseIntegerEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * @template {string | undefined} T
 * @param {string} name
 * @param {T} defaultValue
 * @returns {T extends string ? string : string | undefined}
 */
export function parseStringEnv(name, defaultValue) {
  const value = process.env[name];
  return /** @type {T extends string ? string : string | undefined} */ (
    value === undefined || value === "" ? defaultValue : value
  );
}

/**
 * @param {string} name
 * @returns {string[]}
 */
export function parseCommaSeparatedEnv(name) {
  return (process.env[name] || "").split(",");
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function parseDisabledFlagEnv(name) {
  return process.env[name] !== "disabled";
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
 * @param {string} value
 * @returns {{limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}}}
 */
function parseRateLimitProfile(name, value) {
  const entries = value.trim().split(/\s+/);
  /** @type {{limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}}} */
  const parsed = {
    limit: 0,
    periodMs: 0,
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
 * @param {string} name
 * @param {string} defaultValue
 * @returns {{limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}}}
 */
export function parseRateLimitProfileEnv(name, defaultValue) {
  const value = process.env[name];
  return parseRateLimitProfile(
    name,
    value === undefined || value.trim() === "" ? defaultValue : value,
  );
}

/**
 * @template {string} T
 * @param {string} name
 * @param {T[]} allowedValues
 * @param {T} defaultValue
 * @returns {T}
 */
export function parseEnumEnv(name, allowedValues, defaultValue) {
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

/**
 * @returns {{IP_SOURCE: string, TRUST_PROXY_HOPS: number}}
 */
export function parseIpConfigurationEnv() {
  const ipSource = parseStringEnv("WBO_IP_SOURCE", "remoteAddress")?.trim();
  const trustProxyHops = parseIntegerEnv("WBO_TRUST_PROXY_HOPS", 0);

  if (trustProxyHops < 0) {
    throw new Error("Invalid WBO_TRUST_PROXY_HOPS: must be >= 0");
  }

  const normalizedIpSource = (ipSource || "").toLowerCase();
  if (
    trustProxyHops > 0 &&
    normalizedIpSource !== "x-forwarded-for" &&
    normalizedIpSource !== "forwarded"
  ) {
    throw new Error(
      "WBO_TRUST_PROXY_HOPS requires WBO_IP_SOURCE to be X-Forwarded-For or Forwarded",
    );
  }

  return {
    IP_SOURCE: ipSource || "remoteAddress",
    TRUST_PROXY_HOPS: trustProxyHops,
  };
}
