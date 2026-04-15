const REQUEST_URL_BASE = "http://wbo";

/**
 * Parse an incoming HTTP request target relative to a sentinel origin.
 *
 * Requests can arrive with malformed origin-form targets like `//`, which the
 * URL constructor interprets as a scheme-relative URL and rejects. For server
 * routing we want to treat those as path-only targets instead of crashing.
 *
 * @param {string | null | undefined} requestUrl
 * @returns {URL}
 */
export function parseRequestUrl(requestUrl) {
  const target =
    typeof requestUrl === "string" && requestUrl !== "" ? requestUrl : "/";

  try {
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(target)) {
      return new URL(target);
    }
    if (target.startsWith("/")) {
      return new URL(`${REQUEST_URL_BASE}${target}`);
    }
    return new URL(target, `${REQUEST_URL_BASE}/`);
  } catch {
    return new URL(`${REQUEST_URL_BASE}/`);
  }
}
