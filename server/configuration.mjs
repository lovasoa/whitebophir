import path from "node:path";

import {
  parseCommaSeparatedEnv,
  parseDisabledFlagEnv,
  parseEnumEnv,
  parseIntegerEnv,
  parseIpConfigurationEnv,
  parseRateLimitProfileEnv,
  parseStringEnv,
} from "./configuration/helpers.mjs";

const APP_ROOT = process.cwd();
const LOG_LEVELS = ["debug", "info", "warn", "error"];
const DEFAULT_HISTORY_DIR = path.join(APP_ROOT, "server-data");
const DEFAULT_WEBROOT = path.join(APP_ROOT, "client-data");
const DEFAULT_TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const IP_CONFIGURATION = parseIpConfigurationEnv(
  "WBO_IP_SOURCE",
  "WBO_TRUST_PROXY_HOPS",
  "remoteAddress",
  0,
);

/** True outside production. */
export const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

/** Listen port for the HTTP server. */
export const PORT = parseIntegerEnv("PORT", 8080);

/** Listen host for the HTTP server. Empty means all interfaces. */
export const HOST = parseStringEnv("HOST", undefined);

/** Directory where board history and persisted SVG files are stored. */
export const HISTORY_DIR = parseStringEnv(
  "WBO_HISTORY_DIR",
  DEFAULT_HISTORY_DIR,
);

/** Minimum emitted server log level. Accepted values: `debug`, `info`, `warn`, `error`. */
export const LOG_LEVEL = parseEnumEnv("LOG_LEVEL", LOG_LEVELS, "info");

/** Static web root used to serve the client application files. */
export const WEBROOT = parseStringEnv("WBO_WEBROOT", DEFAULT_WEBROOT);

/** Optional HTML snippet inserted before `</head>` in rendered HTML pages. */
export const HTML_HEAD_SNIPPET_PATH = parseStringEnv(
  "WBO_HTML_HEAD_SNIPPET_PATH",
  undefined,
);

/** Idle delay before a dirty board is saved. */
export const SAVE_INTERVAL = parseIntegerEnv("WBO_SAVE_INTERVAL", 2000);

/** Maximum save delay while a board keeps receiving writes. */
export const MAX_SAVE_DELAY = parseIntegerEnv("WBO_MAX_SAVE_DELAY", 60 * 1000);

if (MAX_SAVE_DELAY < SAVE_INTERVAL) {
  throw new Error(
    `Invalid save timing config: WBO_MAX_SAVE_DELAY (${MAX_SAVE_DELAY}) must be greater than or equal to WBO_SAVE_INTERVAL (${SAVE_INTERVAL}).`,
  );
}

/** How long persisted replay entries stay available after a save. */
export const SEQ_REPLAY_RETENTION_MS = parseIntegerEnv(
  "WBO_SEQ_REPLAY_RETENTION_MS",
  60 * 1000,
);

/** Hard cap on authoritative persisted items per board. */
export const MAX_ITEM_COUNT = parseIntegerEnv("WBO_MAX_ITEM_COUNT", 32768);

/** Hard cap on child payload entries inside one message or stored item. */
export const MAX_CHILDREN = parseIntegerEnv("WBO_MAX_CHILDREN", 500);

/** Maximum absolute board coordinate accepted by the server. */
export const MAX_BOARD_SIZE = parseIntegerEnv("WBO_MAX_BOARD_SIZE", 655360);

/** Per-socket general write rate limits. Example: `*:250/5s anonymous:125/5s`. */
export const GENERAL_RATE_LIMITS = parseRateLimitProfileEnv(
  "WBO_MAX_EMIT_COUNT",
  "*:250/5s",
);

/** Per-IP constructive write rate limits. Example: `*:40/10s anonymous:20/10s`. */
export const CONSTRUCTIVE_ACTION_RATE_LIMITS = parseRateLimitProfileEnv(
  "WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP",
  "*:40/10s anonymous:20/10s",
);

/** Per-IP destructive write rate limits. Example: `*:190/60s anonymous:95/60s`. */
export const DESTRUCTIVE_ACTION_RATE_LIMITS = parseRateLimitProfileEnv(
  "WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP",
  "*:190/60s anonymous:95/60s",
);

/** Per-IP text creation rate limits. Example: `*:2/1s anonymous:30/60s`. */
export const TEXT_CREATION_RATE_LIMITS = parseRateLimitProfileEnv(
  "WBO_MAX_TEXT_CREATIONS_PER_IP",
  "*:2/1s anonymous:30/60s",
);

/** Source used to resolve the client IP. Accepted values: `remoteAddress`, `Forwarded`, `X-Forwarded-For`, or a header name. */
export const IP_SOURCE = IP_CONFIGURATION.IP_SOURCE;

/** Number of trusted proxy hops when `WBO_IP_SOURCE` uses forwarded headers. */
export const TRUST_PROXY_HOPS = IP_CONFIGURATION.TRUST_PROXY_HOPS;

/** Comma-separated blocked tool ids. */
export const BLOCKED_TOOLS = parseCommaSeparatedEnv("WBO_BLOCKED_TOOLS");

/** Comma-separated blocked selection button ids. */
export const BLOCKED_SELECTION_BUTTONS = parseCommaSeparatedEnv(
  "WBO_BLOCKED_SELECTION_BUTTONS",
);

/** Finger whiteout stays enabled unless this env var is explicitly set to `disabled`. */
export const AUTO_FINGER_WHITEOUT = parseDisabledFlagEnv(
  "AUTO_FINGER_WHITEOUT",
);

/** Shared JWT secret used by board auth helpers. Empty disables JWT auth. */
export const AUTH_SECRET_KEY = parseStringEnv("AUTH_SECRET_KEY", "");

/** Cloudflare Turnstile secret key. */
export const TURNSTILE_SECRET_KEY = parseStringEnv(
  "TURNSTILE_SECRET_KEY",
  undefined,
);

/** Cloudflare Turnstile site key. */
export const TURNSTILE_SITE_KEY = parseStringEnv(
  "TURNSTILE_SITE_KEY",
  undefined,
);

/** Turnstile verification endpoint override. */
export const TURNSTILE_VERIFY_URL = parseStringEnv(
  "TURNSTILE_VERIFY_URL",
  DEFAULT_TURNSTILE_VERIFY_URL,
);

/** How long a successful Turnstile validation remains valid for a socket. */
export const TURNSTILE_VALIDATION_WINDOW_MS = parseIntegerEnv(
  "TURNSTILE_VALIDATION_WINDOW_MS",
  4 * 60 * 1000,
);

/** Optional board name used by the root route redirect. */
export const DEFAULT_BOARD = parseStringEnv("WBO_DEFAULT_BOARD", undefined);
