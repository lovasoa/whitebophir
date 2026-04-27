const ESCAPE_PATTERN = /[&"'<>]/g;
const ENTITY_PATTERN = /&(lt|gt|amp|quot|#(?:34|38|39|60|62));/g;
const ESCAPED_LENGTH_PATTERN = /&(lt|gt|amp|quot|#(?:34|38|39|60|62));/g;

/** @type {Record<string, string>} */
const ESCAPED_BY_CHAR = {
  '"': "&#34;",
  "&": "&#38;",
  "'": "&#39;",
  "<": "&#60;",
  ">": "&#62;",
};

/** @type {Record<string, string>} */
const CHAR_BY_ENTITY = {
  "&#34;": '"',
  "&#38;": "&",
  "&#39;": "'",
  "&#60;": "<",
  "&#62;": ">",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};

/**
 * @param {string} value
 * @returns {string}
 */
const escapeHtml = (value) =>
  value.search(ESCAPE_PATTERN) === -1
    ? value
    : value.replace(ESCAPE_PATTERN, (char) => ESCAPED_BY_CHAR[char] || char);

/**
 * @param {string} value
 * @returns {string}
 */
const unescapeHtml = (value) =>
  value.includes("&")
    ? value.replace(
        ENTITY_PATTERN,
        (entity) => CHAR_BY_ENTITY[entity] || entity,
      )
    : value;

/**
 * @param {string | undefined} value
 * @returns {number}
 */
function decodedTextLength(value) {
  if (typeof value !== "string" || value.length === 0) return 0;
  return value.includes("&")
    ? value.replace(ESCAPED_LENGTH_PATTERN, "_").length
    : value.length;
}

export { decodedTextLength, escapeHtml, unescapeHtml };
