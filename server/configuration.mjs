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

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   IS_DEVELOPMENT: boolean,
 *   PORT: number,
 *   HOST: string | undefined,
 *   HISTORY_DIR: string,
 *   LOG_LEVEL: string,
 *   WEBROOT: string,
 *   SAVE_INTERVAL: number,
 *   MAX_SAVE_DELAY: number,
 *   SEQ_REPLAY_RETENTION_MS: number,
 *   MAX_ITEM_COUNT: number,
 *   MAX_CHILDREN: number,
 *   MAX_BOARD_SIZE: number,
 *   GENERAL_RATE_LIMITS: {limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}},
 *   CONSTRUCTIVE_ACTION_RATE_LIMITS: {limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}},
 *   DESTRUCTIVE_ACTION_RATE_LIMITS: {limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}},
 *   TEXT_CREATION_RATE_LIMITS: {limit: number, periodMs: number, overrides: {[boardName: string]: {limit: number, periodMs: number}}},
 *   IP_SOURCE: string,
 *   TRUST_PROXY_HOPS: number,
 *   BLOCKED_TOOLS: string[],
 *   BLOCKED_SELECTION_BUTTONS: string[],
 *   AUTO_FINGER_WHITEOUT: boolean,
 *   AUTH_SECRET_KEY: string,
 *   TURNSTILE_SECRET_KEY: string | undefined,
 *   TURNSTILE_SITE_KEY: string | undefined,
 *   TURNSTILE_VERIFY_URL: string,
 *   TURNSTILE_VALIDATION_WINDOW_MS: number,
 *   DEFAULT_BOARD: string | undefined,
 * }}
 */
export function parseConfigurationFromEnv(env = process.env) {
  const ipConfiguration = parseIpConfigurationEnv(
    "WBO_IP_SOURCE",
    "WBO_TRUST_PROXY_HOPS",
    "remoteAddress",
    0,
    env,
  );

  return {
    /** True outside production. */
    IS_DEVELOPMENT: env.NODE_ENV !== "production",

    /** Application listen port. */
    PORT: parseIntegerEnv("PORT", 8080, env),

    /** Application listen host. Empty means all interfaces. */
    HOST: parseStringEnv("HOST", undefined, env),

    /** Board persistence directory. */
    HISTORY_DIR: parseStringEnv("WBO_HISTORY_DIR", DEFAULT_HISTORY_DIR, env),

    /** Minimum emitted server log level: debug, info, warn, or error. */
    LOG_LEVEL: parseEnumEnv("LOG_LEVEL", LOG_LEVELS, "info", env),

    /** Static asset root. */
    WEBROOT: parseStringEnv("WBO_WEBROOT", DEFAULT_WEBROOT, env),

    /** Inactivity delay before saving a board. */
    SAVE_INTERVAL: parseIntegerEnv("WBO_SAVE_INTERVAL", 2000, env),

    /** Maximum active-use delay between saves. */
    MAX_SAVE_DELAY: parseIntegerEnv("WBO_MAX_SAVE_DELAY", 60 * 1000, env),

    /** Replay retention window after save. */
    SEQ_REPLAY_RETENTION_MS: parseIntegerEnv(
      "WBO_SEQ_REPLAY_RETENTION_MS",
      60 * 1000,
      env,
    ),

    /** Maximum persisted item count per board. */
    MAX_ITEM_COUNT: parseIntegerEnv("WBO_MAX_ITEM_COUNT", 32768, env),

    /** Maximum child count inside one item payload. */
    MAX_CHILDREN: parseIntegerEnv("WBO_MAX_CHILDREN", 500, env),

    /** Maximum absolute board coordinate. */
    MAX_BOARD_SIZE: parseIntegerEnv("WBO_MAX_BOARD_SIZE", 655360, env),

    /** Per-socket general write rate limits. Example: `*:250/5s anonymous:125/5s`. */
    GENERAL_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_EMIT_COUNT",
      "*:250/5s",
      env,
    ),

    /** Per-IP constructive write rate limits. Example: `*:40/10s anonymous:20/10s`. */
    CONSTRUCTIVE_ACTION_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP",
      "*:40/10s anonymous:20/10s",
      env,
    ),

    /** Per-IP destructive write rate limits. Example: `*:190/60s anonymous:95/60s`. */
    DESTRUCTIVE_ACTION_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP",
      "*:190/60s anonymous:95/60s",
      env,
    ),

    /** Per-IP text creation rate limits. Example: `*:2/1s anonymous:30/60s`. */
    TEXT_CREATION_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_TEXT_CREATIONS_PER_IP",
      "*:2/1s anonymous:30/60s",
      env,
    ),

    /** IP resolution source: remoteAddress, Forwarded, X-Forwarded-For, or a header name. */
    IP_SOURCE: ipConfiguration.IP_SOURCE,
    TRUST_PROXY_HOPS: ipConfiguration.TRUST_PROXY_HOPS,

    /** Comma-separated blocked tool ids. */
    BLOCKED_TOOLS: parseCommaSeparatedEnv("WBO_BLOCKED_TOOLS", env),

    /** Comma-separated blocked selection button ids. */
    BLOCKED_SELECTION_BUTTONS: parseCommaSeparatedEnv(
      "WBO_BLOCKED_SELECTION_BUTTONS",
      env,
    ),

    /** Enables stylus-then-finger whiteout unless set to `disabled`. */
    AUTO_FINGER_WHITEOUT: parseDisabledFlagEnv("AUTO_FINGER_WHITEOUT", env),

    /** JWT secret key. */
    AUTH_SECRET_KEY: parseStringEnv("AUTH_SECRET_KEY", "", env),

    /** Cloudflare Turnstile secret key. */
    TURNSTILE_SECRET_KEY: parseStringEnv(
      "TURNSTILE_SECRET_KEY",
      undefined,
      env,
    ),

    /** Cloudflare Turnstile site key. */
    TURNSTILE_SITE_KEY: parseStringEnv("TURNSTILE_SITE_KEY", undefined, env),

    /** Turnstile verification endpoint override. */
    TURNSTILE_VERIFY_URL: parseStringEnv(
      "TURNSTILE_VERIFY_URL",
      DEFAULT_TURNSTILE_VERIFY_URL,
      env,
    ),

    /** Successful Turnstile validation lifetime. */
    TURNSTILE_VALIDATION_WINDOW_MS: parseIntegerEnv(
      "TURNSTILE_VALIDATION_WINDOW_MS",
      4 * 60 * 1000,
      env,
    ),

    /** Root-route board redirect target. */
    DEFAULT_BOARD: parseStringEnv("WBO_DEFAULT_BOARD", undefined, env),
  };
}

const configuration = parseConfigurationFromEnv();

export const {
  IS_DEVELOPMENT,
  PORT,
  HOST,
  HISTORY_DIR,
  LOG_LEVEL,
  WEBROOT,
  SAVE_INTERVAL,
  MAX_SAVE_DELAY,
  SEQ_REPLAY_RETENTION_MS,
  MAX_ITEM_COUNT,
  MAX_CHILDREN,
  MAX_BOARD_SIZE,
  GENERAL_RATE_LIMITS,
  CONSTRUCTIVE_ACTION_RATE_LIMITS,
  DESTRUCTIVE_ACTION_RATE_LIMITS,
  TEXT_CREATION_RATE_LIMITS,
  IP_SOURCE,
  TRUST_PROXY_HOPS,
  BLOCKED_TOOLS,
  BLOCKED_SELECTION_BUTTONS,
  AUTO_FINGER_WHITEOUT,
  AUTH_SECRET_KEY,
  TURNSTILE_SECRET_KEY,
  TURNSTILE_SITE_KEY,
  TURNSTILE_VERIFY_URL,
  TURNSTILE_VALIDATION_WINDOW_MS,
  DEFAULT_BOARD,
} = configuration;
