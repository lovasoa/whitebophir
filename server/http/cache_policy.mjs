import * as path from "node:path";

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=60, must-revalidate";
const STATIC_RESOURCE_EXTENSIONS = [
  ".js",
  ".css",
  ".svg",
  ".ico",
  ".png",
  ".jpg",
  ".gif",
];

/**
 * @param {import("../../types/server-runtime.d.ts").ServerConfig} config
 * @param {string} filePath
 * @returns {string | undefined}
 */
function staticFileCacheControl(config, filePath) {
  if (config.IS_DEVELOPMENT) return "no-store";
  return STATIC_RESOURCE_EXTENSIONS.includes(
    path.extname(filePath).toLowerCase(),
  )
    ? STATIC_ASSET_CACHE_CONTROL
    : undefined;
}

/**
 * @param {import("../../types/server-runtime.d.ts").ServerConfig} config
 * @returns {string}
 */
function boardSvgCacheControl(config) {
  return config.IS_DEVELOPMENT
    ? "no-store"
    : "public, max-age=3, must-revalidate";
}

export {
  CSP,
  STATIC_RESOURCE_EXTENSIONS,
  boardSvgCacheControl,
  staticFileCacheControl,
};
