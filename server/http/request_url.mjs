const REQUEST_URL_BASE = "http://wbo";

/**
 * @template T
 * @typedef {{ok: true, value: T} | {ok: false, reason: string}} ParseResult
 */

/**
 * @param {string | null | undefined} requestUrl
 * @returns {string}
 */
function normalizeTarget(requestUrl) {
  return typeof requestUrl === "string" && requestUrl !== "" ? requestUrl : "/";
}

/**
 * Parse a request target using the app's expected origin-form contract.
 *
 * @param {string | null | undefined} requestUrl
 * @returns {ParseResult<URL>}
 */
export function validateRequestUrl(requestUrl) {
  const target = normalizeTarget(requestUrl);
  if (!target.startsWith("/")) {
    return { ok: false, reason: "non_origin_form_request_target" };
  }
  if (target.startsWith("//")) {
    return { ok: false, reason: "invalid_request_target" };
  }

  try {
    return { ok: true, value: new URL(`${REQUEST_URL_BASE}${target}`) };
  } catch {
    return { ok: false, reason: "invalid_request_target" };
  }
}

/**
 * Tolerant parser used by observability code so malformed request targets do
 * not crash logging before the handler returns 400.
 *
 * @param {string | null | undefined} requestUrl
 * @returns {URL}
 */
export function parseRequestUrl(requestUrl) {
  const validated = validateRequestUrl(requestUrl);
  if (validated.ok) return validated.value;
  return new URL(`${REQUEST_URL_BASE}/`);
}
