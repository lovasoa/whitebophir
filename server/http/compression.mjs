import * as zlib from "node:zlib";

/** @typedef {"zstd" | "br" | "gzip"} CompressionEncoding */

/** @typedef {import("stream").Writable} WritableStream */

/** @type {{encoding: CompressionEncoding, create: () => WritableStream}[]} */
const COMPRESSORS = [
  ...(typeof zlib.createZstdCompress === "function"
    ? [
        {
          encoding: /** @type {const} */ ("zstd"),
          create: () => zlib.createZstdCompress(),
        },
      ]
    : []),
  {
    encoding: "br",
    create: () =>
      zlib.createBrotliCompress({
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
      }),
  },
  { encoding: "gzip", create: () => zlib.createGzip({ level: 4 }) },
];

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

    tokens.push(encoding);
  }

  return { tokens, wildcard };
}

/** @param {string | string[] | undefined} acceptEncoding */
function selectCompressor(acceptEncoding) {
  const { tokens, wildcard } = parseAcceptEncoding(acceptEncoding);
  return (
    COMPRESSORS.find(({ encoding }) => tokens.includes(encoding)) ||
    (wildcard ? COMPRESSORS[0] : undefined)
  );
}

/**
 * @param {string | string[] | undefined} acceptEncoding
 * @returns {CompressionEncoding | undefined}
 */
function selectCompressionEncoding(acceptEncoding) {
  return selectCompressor(acceptEncoding)?.encoding;
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
 * @returns {{ stream: WritableStream, encoding: CompressionEncoding | undefined }}
 */
export function startCompressedResponse(response, acceptEncoding, headers) {
  appendVaryHeader(headers, "Accept-Encoding");
  const compressor = selectCompressor(acceptEncoding);
  const stream = compressor ? compressor.create() : response;
  if (compressor) {
    headers["Content-Encoding"] = compressor.encoding;
    delete headers["Content-Length"];
    stream.pipe(response);
  }
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.writeHead(200);
  return { stream, encoding: compressor?.encoding };
}

export { selectCompressionEncoding };
