import crypto from "node:crypto";

export const USER_SECRET_COOKIE_NAME = "wbo-user-secret-v1";
const USER_SECRET_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const USER_SECRET_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * @param {string | string[] | undefined} value
 * @returns {{[name: string]: string}}
 */
export function parseCookieHeader(value) {
  const headerValue = Array.isArray(value) ? value[0] : value;
  if (typeof headerValue !== "string" || headerValue.trim() === "") {
    return {};
  }
  /** @type {{[name: string]: string}} */
  const cookies = {};
  headerValue.split(";").forEach((part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) return;
    const name = part.slice(0, separatorIndex).trim();
    if (name === "") return;
    const rawValue = part.slice(separatorIndex + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  });
  return cookies;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeUserSecret(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!USER_SECRET_PATTERN.test(trimmed)) return "";
  return trimmed.toLowerCase();
}

/**
 * @param {string | string[] | undefined} cookieHeader
 * @returns {string}
 */
export function getUserSecretFromCookieHeader(cookieHeader) {
  return normalizeUserSecret(
    parseCookieHeader(cookieHeader)[USER_SECRET_COOKIE_NAME],
  );
}

/**
 * @returns {string}
 */
export function generateUserSecret() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * @param {string} pathname
 * @returns {string}
 */
export function getUserSecretCookiePath(pathname) {
  const marker = "/boards/";
  const markerIndex = pathname.indexOf(marker);
  const prefix = markerIndex >= 0 ? pathname.slice(0, markerIndex) : "";
  if (prefix === "") return "/";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

/**
 * @param {string} userSecret
 * @param {{path: string, secure?: boolean}} options
 * @returns {string}
 */
export function serializeUserSecretCookie(userSecret, options) {
  const path = options.path || "/";
  const parts = [
    `${USER_SECRET_COOKIE_NAME}=${encodeURIComponent(userSecret)}`,
    `Max-Age=${USER_SECRET_MAX_AGE_SECONDS}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * @param {import("http").ServerResponse} response
 * @param {string} cookieValue
 * @returns {void}
 */
export function appendSetCookieHeader(response, cookieValue) {
  const existing = response.getHeader("Set-Cookie");
  if (existing === undefined) {
    response.setHeader("Set-Cookie", cookieValue);
    return;
  }
  if (Array.isArray(existing)) {
    response.setHeader("Set-Cookie", existing.concat(cookieValue));
    return;
  }
  response.setHeader("Set-Cookie", [String(existing), cookieValue]);
}
