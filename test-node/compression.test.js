const assert = require("node:assert/strict");
const test = require("node:test");
const zlib = require("node:zlib");
const { selectCompressionEncoding } = require("../server/http/compression.mjs");

test("compression negotiation preserves preference, exclusions, and wildcard fallback", () => {
  const zstd = typeof zlib.createZstdCompress === "function";
  /** @type {[string | string[] | undefined, string | undefined][]} */
  const cases = [
    [undefined, undefined],
    ["", undefined],
    ["identity, compress", undefined],
    ["gzip", "gzip"],
    ["gzip, br", "br"],
    ["br;q=0, gzip", "gzip"],
    ["gzip;q=0", undefined],
    ["gzip;q=invalid", "gzip"],
    ["gzip;q=1, br;q=0.1", "br"],
    ["gzip, *", "gzip"],
    ["*;q=0", undefined],
    ["*", zstd ? "zstd" : "br"],
    ["zstd", zstd ? "zstd" : undefined],
    ["gzip, br, zstd", zstd ? "zstd" : "br"],
    [[" GZip ; Q=0", " BR "], "br"],
  ];
  for (const [header, expected] of cases) {
    assert.equal(selectCompressionEncoding(header), expected, String(header));
  }
});
