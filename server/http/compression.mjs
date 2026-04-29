import * as zlib from "node:zlib";

/** @typedef {"zstd" | "br" | "gzip"} CompressionEncoding */

/** @typedef {import("stream").Writable} WritableStream */

/** @type {Set<string>} */
const SUPPORTED_ENCODINGS = new Set([
  "gzip",
  "br",
  ...(typeof zlib.createZstdCompress === "function" ? ["zstd"] : []),
]);

const COMPRESSION_PREFERENCE = ["zstd", "br", "gzip"];
const BROTLI_QUALITY = 4;
const GZIP_LEVEL = 4;

/**
 * @param {string} encoding
 * @returns {boolean}
 */
function isConfiguredEncodingAvailable(encoding) {
  if (encoding === "zstd") {
    return typeof zlib.createZstdCompress === "function";
  }
  if (encoding === "br") {
    return typeof zlib.createBrotliCompress === "function";
  }
  if (encoding === "gzip") {
    return typeof zlib.createGzip === "function";
  }
  return false;
}

/**
 * @param {string | string[] | undefined} acceptEncoding
 * @returns {{ tokens: string[], wildcard: boolean }}
 */
function parseAcceptEncoding(acceptEncoding) {
  const headerValue = Array.isArray(acceptEncoding)
    ? acceptEncoding.join(",")
    : acceptEncoding || "";
  /** @type {string[]} */
  const tokens = [];
  let wildcard = false;

  for (const rawPart of headerValue.split(",")) {
    const segment = rawPart.trim();
    if (!segment) continue;

    const [encodingPart = "", ...rawParams] = segment.split(";");
    const encoding = encodingPart.trim().toLowerCase();
    if (!encoding) continue;

    let quality = 1;
    for (const rawParam of rawParams) {
      const [rawKey, rawValue] = rawParam.split("=");
      if ((rawKey || "").trim().toLowerCase() !== "q") continue;
      const value = Number.parseFloat(String(rawValue || "").trim());
      quality = Number.isFinite(value) ? value : 1;
      break;
    }

    if (quality <= 0) continue;

    if (encoding === "*") {
      wildcard = true;
      continue;
    }

    if (SUPPORTED_ENCODINGS.has(encoding)) {
      tokens.push(encoding);
    }
  }

  return { tokens, wildcard };
}

/**
 * @param {string | string[] | undefined} acceptEncoding
 * @returns {CompressionEncoding | undefined}
 */
function selectCompressionEncoding(acceptEncoding) {
  const parsed = parseAcceptEncoding(acceptEncoding);

  for (const encoding of COMPRESSION_PREFERENCE) {
    if (
      parsed.tokens.includes(encoding) &&
      isConfiguredEncodingAvailable(encoding)
    ) {
      return /** @type {CompressionEncoding} */ (encoding);
    }
  }

  if (!parsed.wildcard) {
    return undefined;
  }

  for (const encoding of COMPRESSION_PREFERENCE) {
    if (isConfiguredEncodingAvailable(encoding)) {
      return /** @type {CompressionEncoding} */ (encoding);
    }
  }

  return undefined;
}

/**
 * @param {CompressionEncoding} encoding
 * @returns {WritableStream | undefined}
 */
function createCompressionStream(encoding) {
  if (encoding === "zstd" && typeof zlib.createZstdCompress === "function") {
    return zlib.createZstdCompress();
  }
  if (encoding === "br" && typeof zlib.createBrotliCompress === "function") {
    return zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      },
    });
  }
  if (encoding === "gzip" && typeof zlib.createGzip === "function") {
    return zlib.createGzip({ level: GZIP_LEVEL });
  }
  return undefined;
}

/**
 * @param {{ [name: string]: string | number }} headers
 * @param {string} additional
 */
function appendVaryHeader(headers, additional) {
  const current = headers["Vary"];
  if (typeof current !== "string" || current.trim() === "") {
    headers["Vary"] = additional;
    return;
  }
  const next = current
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const lower = next.map((value) => value.toLowerCase());
  if (!lower.includes(additional.toLowerCase())) {
    headers["Vary"] = `${current}, ${additional}`;
  }
}

/**
 * @param {import("http").ServerResponse} response
 * @param {string | string[] | undefined} acceptEncoding
 * @param {{ [name: string]: string | number }} headers
 * @returns {{ stream: import("stream").Writable, encoding: CompressionEncoding | undefined }}
 */
export function applyCompressionForResponse(response, acceptEncoding, headers) {
  appendVaryHeader(headers, "Accept-Encoding");

  const encoding = selectCompressionEncoding(acceptEncoding);
  if (!encoding) {
    return { stream: response, encoding: undefined };
  }

  const stream = createCompressionStream(encoding);
  if (!stream) {
    return { stream: response, encoding: undefined };
  }

  headers["Content-Encoding"] = encoding;
  if ("Content-Length" in headers) {
    delete headers["Content-Length"];
  }
  stream.pipe(response);

  return { stream, encoding };
}

/**
 * @param {import("http").ServerResponse} response
 * @param {string | string[] | undefined} acceptEncoding
 * @param {{ [name: string]: string | number }} headers
 * @returns {{ stream: import("stream").Writable, encoding: CompressionEncoding | undefined }}
 */
export function startCompressedResponse(response, acceptEncoding, headers) {
  const result = applyCompressionForResponse(response, acceptEncoding, headers);
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.writeHead(200);
  return result;
}

export { selectCompressionEncoding };
