import path from "node:path";

import {
  parseCommaSeparatedEnv,
  parseDisabledFlagEnv,
  parseEnumEnv,
  parseIntegerEnv,
  parseIpConfigurationEnv,
  parseRateLimitProfileEnv,
  parseStringEnv,
} from "./configuration_helpers.mjs";

const APP_ROOT = process.cwd();
const LOG_LEVELS = ["debug", "info", "warn", "error"];
const DEFAULT_HISTORY_DIR = path.join(APP_ROOT, "server-data");
const DEFAULT_WEBROOT = path.join(APP_ROOT, "client-data");
const DEFAULT_TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True outside production. */
export const IS_DEVELOPMENT = () => process.env.NODE_ENV !== "production";

/** Application listen port. */
export const PORT = () => parseIntegerEnv("PORT", 8080);

/** Application listen host. Empty means all interfaces. */
export const HOST = () => parseStringEnv("HOST", undefined);

/** Board persistence directory. */
export const HISTORY_DIR = () =>
  parseStringEnv("WBO_HISTORY_DIR", DEFAULT_HISTORY_DIR);

/** Minimum emitted server log level: debug, info, warn, or error. */
export const LOG_LEVEL = () => parseEnumEnv("LOG_LEVEL", LOG_LEVELS, "info");

/** Static asset root. */
export const WEBROOT = () => parseStringEnv("WBO_WEBROOT", DEFAULT_WEBROOT);

/** Inactivity delay before saving a board. */
export const SAVE_INTERVAL = () => parseIntegerEnv("WBO_SAVE_INTERVAL", 2000);

/** Maximum active-use delay between saves. */
export const MAX_SAVE_DELAY = () =>
  parseIntegerEnv("WBO_MAX_SAVE_DELAY", 60 * 1000);

/** Replay retention window after save. */
export const SEQ_REPLAY_RETENTION_MS = () =>
  parseIntegerEnv("WBO_SEQ_REPLAY_RETENTION_MS", 60 * 1000);

/** Maximum persisted item count per board. */
export const MAX_ITEM_COUNT = () =>
  parseIntegerEnv("WBO_MAX_ITEM_COUNT", 32768);

/** Maximum child count inside one item payload. */
export const MAX_CHILDREN = () => parseIntegerEnv("WBO_MAX_CHILDREN", 500);

/** Maximum absolute board coordinate. */
export const MAX_BOARD_SIZE = () =>
  parseIntegerEnv("WBO_MAX_BOARD_SIZE", 655360);

/** Per-socket general write rate limits. Example: `*:250/5s anonymous:125/5s`. */
export const GENERAL_RATE_LIMITS = () =>
  parseRateLimitProfileEnv("WBO_MAX_EMIT_COUNT", "*:250/5s");

/** Per-IP constructive write rate limits. Example: `*:40/10s anonymous:20/10s`. */
export const CONSTRUCTIVE_ACTION_RATE_LIMITS = () =>
  parseRateLimitProfileEnv(
    "WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP",
    "*:40/10s anonymous:20/10s",
  );

/** Per-IP destructive write rate limits. Example: `*:190/60s anonymous:95/60s`. */
export const DESTRUCTIVE_ACTION_RATE_LIMITS = () =>
  parseRateLimitProfileEnv(
    "WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP",
    "*:190/60s anonymous:95/60s",
  );

/** Per-IP text creation rate limits. Example: `*:2/1s anonymous:30/60s`. */
export const TEXT_CREATION_RATE_LIMITS = () =>
  parseRateLimitProfileEnv(
    "WBO_MAX_TEXT_CREATIONS_PER_IP",
    "*:2/1s anonymous:30/60s",
  );

/** IP resolution source: remoteAddress, Forwarded, X-Forwarded-For, or a header name. */
export const IP_CONFIGURATION = () => parseIpConfigurationEnv();

/** Comma-separated blocked tool ids. */
export const BLOCKED_TOOLS = () => parseCommaSeparatedEnv("WBO_BLOCKED_TOOLS");

/** Comma-separated blocked selection button ids. */
export const BLOCKED_SELECTION_BUTTONS = () =>
  parseCommaSeparatedEnv("WBO_BLOCKED_SELECTION_BUTTONS");

/** Enables stylus-then-finger whiteout unless set to `disabled`. */
export const AUTO_FINGER_WHITEOUT = () =>
  parseDisabledFlagEnv("AUTO_FINGER_WHITEOUT");

/** JWT secret key. */
export const AUTH_SECRET_KEY = () => parseStringEnv("AUTH_SECRET_KEY", "");

/** Cloudflare Turnstile secret key. */
export const TURNSTILE_SECRET_KEY = () =>
  parseStringEnv("TURNSTILE_SECRET_KEY", undefined);

/** Cloudflare Turnstile site key. */
export const TURNSTILE_SITE_KEY = () =>
  parseStringEnv("TURNSTILE_SITE_KEY", undefined);

/** Turnstile verification endpoint override. */
export const TURNSTILE_VERIFY_URL = () =>
  parseStringEnv("TURNSTILE_VERIFY_URL", DEFAULT_TURNSTILE_VERIFY_URL);

/** Successful Turnstile validation lifetime. */
export const TURNSTILE_VALIDATION_WINDOW_MS = () =>
  parseIntegerEnv("TURNSTILE_VALIDATION_WINDOW_MS", 4 * 60 * 1000);

/** Root-route board redirect target. */
export const DEFAULT_BOARD = () =>
  parseStringEnv("WBO_DEFAULT_BOARD", undefined);

/**
 * Pure `process.env` reader. Every call reparses env and returns fresh rate-limit objects.
 */
export function readConfiguration() {
  const { IP_SOURCE, TRUST_PROXY_HOPS } = IP_CONFIGURATION();
  const generalRateLimits = GENERAL_RATE_LIMITS();
  const destructiveActionRateLimits = DESTRUCTIVE_ACTION_RATE_LIMITS();
  const constructiveActionRateLimits = CONSTRUCTIVE_ACTION_RATE_LIMITS();
  const textCreationRateLimits = TEXT_CREATION_RATE_LIMITS();

  return {
    IS_DEVELOPMENT: IS_DEVELOPMENT(),
    PORT: PORT(),
    HOST: HOST(),
    HISTORY_DIR: HISTORY_DIR(),
    LOG_LEVEL: LOG_LEVEL(),
    WEBROOT: WEBROOT(),
    SAVE_INTERVAL: SAVE_INTERVAL(),
    MAX_SAVE_DELAY: MAX_SAVE_DELAY(),
    SEQ_REPLAY_RETENTION_MS: SEQ_REPLAY_RETENTION_MS(),
    MAX_ITEM_COUNT: MAX_ITEM_COUNT(),
    MAX_CHILDREN: MAX_CHILDREN(),
    MAX_BOARD_SIZE: MAX_BOARD_SIZE(),
    GENERAL_RATE_LIMITS: generalRateLimits,
    DESTRUCTIVE_ACTION_RATE_LIMITS: destructiveActionRateLimits,
    MAX_DESTRUCTIVE_ACTIONS_PER_IP: destructiveActionRateLimits.limit,
    MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS: destructiveActionRateLimits.periodMs,
    ANONYMOUS_MAX_DESTRUCTIVE_ACTIONS_PER_IP:
      destructiveActionRateLimits.overrides.anonymous?.limit,
    CONSTRUCTIVE_ACTION_RATE_LIMITS: constructiveActionRateLimits,
    MAX_CONSTRUCTIVE_ACTIONS_PER_IP: constructiveActionRateLimits.limit,
    MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS: constructiveActionRateLimits.periodMs,
    ANONYMOUS_MAX_CONSTRUCTIVE_ACTIONS_PER_IP:
      constructiveActionRateLimits.overrides.anonymous?.limit,
    TEXT_CREATION_RATE_LIMITS: textCreationRateLimits,
    MAX_TEXT_CREATIONS_PER_IP: textCreationRateLimits.limit,
    MAX_TEXT_CREATIONS_PERIOD_MS: textCreationRateLimits.periodMs,
    ANONYMOUS_MAX_TEXT_CREATIONS_PER_IP:
      textCreationRateLimits.overrides.anonymous?.limit,
    IP_SOURCE,
    TRUST_PROXY_HOPS,
    BLOCKED_TOOLS: BLOCKED_TOOLS(),
    BLOCKED_SELECTION_BUTTONS: BLOCKED_SELECTION_BUTTONS(),
    AUTO_FINGER_WHITEOUT: AUTO_FINGER_WHITEOUT(),
    AUTH_SECRET_KEY: AUTH_SECRET_KEY(),
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET_KEY(),
    TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY(),
    TURNSTILE_VERIFY_URL: TURNSTILE_VERIFY_URL(),
    TURNSTILE_VALIDATION_WINDOW_MS: TURNSTILE_VALIDATION_WINDOW_MS(),
    DEFAULT_BOARD: DEFAULT_BOARD(),
  };
}
