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
 * @returns {typeof import("./configuration.mjs")}
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
    IS_DEVELOPMENT: env.NODE_ENV !== "production",
    PORT: parseIntegerEnv("PORT", 8080, env),
    HOST: parseStringEnv("HOST", undefined, env),
    HISTORY_DIR: parseStringEnv("WBO_HISTORY_DIR", DEFAULT_HISTORY_DIR, env),
    LOG_LEVEL: parseEnumEnv("LOG_LEVEL", LOG_LEVELS, "info", env),
    WEBROOT: parseStringEnv("WBO_WEBROOT", DEFAULT_WEBROOT, env),
    SAVE_INTERVAL: parseIntegerEnv("WBO_SAVE_INTERVAL", 2000, env),
    MAX_SAVE_DELAY: parseIntegerEnv("WBO_MAX_SAVE_DELAY", 60 * 1000, env),
    SEQ_REPLAY_RETENTION_MS: parseIntegerEnv(
      "WBO_SEQ_REPLAY_RETENTION_MS",
      60 * 1000,
      env,
    ),
    MAX_ITEM_COUNT: parseIntegerEnv("WBO_MAX_ITEM_COUNT", 32768, env),
    MAX_CHILDREN: parseIntegerEnv("WBO_MAX_CHILDREN", 500, env),
    MAX_BOARD_SIZE: parseIntegerEnv("WBO_MAX_BOARD_SIZE", 655360, env),
    GENERAL_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_EMIT_COUNT",
      "*:250/5s",
      env,
    ),
    CONSTRUCTIVE_ACTION_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP",
      "*:40/10s anonymous:20/10s",
      env,
    ),
    DESTRUCTIVE_ACTION_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP",
      "*:190/60s anonymous:95/60s",
      env,
    ),
    TEXT_CREATION_RATE_LIMITS: parseRateLimitProfileEnv(
      "WBO_MAX_TEXT_CREATIONS_PER_IP",
      "*:2/1s anonymous:30/60s",
      env,
    ),
    IP_SOURCE: ipConfiguration.IP_SOURCE,
    TRUST_PROXY_HOPS: ipConfiguration.TRUST_PROXY_HOPS,
    BLOCKED_TOOLS: parseCommaSeparatedEnv("WBO_BLOCKED_TOOLS", env),
    BLOCKED_SELECTION_BUTTONS: parseCommaSeparatedEnv(
      "WBO_BLOCKED_SELECTION_BUTTONS",
      env,
    ),
    AUTO_FINGER_WHITEOUT: parseDisabledFlagEnv("AUTO_FINGER_WHITEOUT", env),
    AUTH_SECRET_KEY: parseStringEnv("AUTH_SECRET_KEY", "", env),
    TURNSTILE_SECRET_KEY: parseStringEnv(
      "TURNSTILE_SECRET_KEY",
      undefined,
      env,
    ),
    TURNSTILE_SITE_KEY: parseStringEnv("TURNSTILE_SITE_KEY", undefined, env),
    TURNSTILE_VERIFY_URL: parseStringEnv(
      "TURNSTILE_VERIFY_URL",
      DEFAULT_TURNSTILE_VERIFY_URL,
      env,
    ),
    TURNSTILE_VALIDATION_WINDOW_MS: parseIntegerEnv(
      "TURNSTILE_VALIDATION_WINDOW_MS",
      4 * 60 * 1000,
      env,
    ),
    DEFAULT_BOARD: parseStringEnv("WBO_DEFAULT_BOARD", undefined, env),
  };
}
