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

export function parseIsDevelopment(env = process.env) {
  return env.NODE_ENV !== "production";
}

export function parsePort(env = process.env) {
  return parseIntegerEnv("PORT", 8080, env);
}

export function parseHost(env = process.env) {
  return parseStringEnv("HOST", undefined, env);
}

export function parseHistoryDir(env = process.env) {
  return parseStringEnv("WBO_HISTORY_DIR", DEFAULT_HISTORY_DIR, env);
}

export function parseLogLevel(env = process.env) {
  return parseEnumEnv("LOG_LEVEL", LOG_LEVELS, "info", env);
}

export function parseWebroot(env = process.env) {
  return parseStringEnv("WBO_WEBROOT", DEFAULT_WEBROOT, env);
}

export function parseSaveInterval(env = process.env) {
  return parseIntegerEnv("WBO_SAVE_INTERVAL", 2000, env);
}

export function parseMaxSaveDelay(env = process.env) {
  return parseIntegerEnv("WBO_MAX_SAVE_DELAY", 60 * 1000, env);
}

export function parseSeqReplayRetentionMs(env = process.env) {
  return parseIntegerEnv("WBO_SEQ_REPLAY_RETENTION_MS", 60 * 1000, env);
}

export function parseMaxItemCount(env = process.env) {
  return parseIntegerEnv("WBO_MAX_ITEM_COUNT", 32768, env);
}

export function parseMaxChildren(env = process.env) {
  return parseIntegerEnv("WBO_MAX_CHILDREN", 500, env);
}

export function parseMaxBoardSize(env = process.env) {
  return parseIntegerEnv("WBO_MAX_BOARD_SIZE", 655360, env);
}

export function parseGeneralRateLimits(env = process.env) {
  return parseRateLimitProfileEnv("WBO_MAX_EMIT_COUNT", "*:250/5s", env);
}

export function parseConstructiveActionRateLimits(env = process.env) {
  return parseRateLimitProfileEnv(
    "WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP",
    "*:40/10s anonymous:20/10s",
    env,
  );
}

export function parseDestructiveActionRateLimits(env = process.env) {
  return parseRateLimitProfileEnv(
    "WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP",
    "*:190/60s anonymous:95/60s",
    env,
  );
}

export function parseTextCreationRateLimits(env = process.env) {
  return parseRateLimitProfileEnv(
    "WBO_MAX_TEXT_CREATIONS_PER_IP",
    "*:2/1s anonymous:30/60s",
    env,
  );
}

export function parseIpConfiguration(env = process.env) {
  return parseIpConfigurationEnv(
    "WBO_IP_SOURCE",
    "WBO_TRUST_PROXY_HOPS",
    "remoteAddress",
    0,
    env,
  );
}

export function parseBlockedTools(env = process.env) {
  return parseCommaSeparatedEnv("WBO_BLOCKED_TOOLS", env);
}

export function parseBlockedSelectionButtons(env = process.env) {
  return parseCommaSeparatedEnv("WBO_BLOCKED_SELECTION_BUTTONS", env);
}

export function parseAutoFingerWhiteout(env = process.env) {
  return parseDisabledFlagEnv("AUTO_FINGER_WHITEOUT", env);
}

export function parseAuthSecretKey(env = process.env) {
  return parseStringEnv("AUTH_SECRET_KEY", "", env);
}

export function parseTurnstileSecretKey(env = process.env) {
  return parseStringEnv("TURNSTILE_SECRET_KEY", undefined, env);
}

export function parseTurnstileSiteKey(env = process.env) {
  return parseStringEnv("TURNSTILE_SITE_KEY", undefined, env);
}

export function parseTurnstileVerifyUrl(env = process.env) {
  return parseStringEnv(
    "TURNSTILE_VERIFY_URL",
    DEFAULT_TURNSTILE_VERIFY_URL,
    env,
  );
}

export function parseTurnstileValidationWindowMs(env = process.env) {
  return parseIntegerEnv("TURNSTILE_VALIDATION_WINDOW_MS", 4 * 60 * 1000, env);
}

export function parseDefaultBoard(env = process.env) {
  return parseStringEnv("WBO_DEFAULT_BOARD", undefined, env);
}

export function parseConfigurationSnapshot(env = process.env) {
  const ipConfiguration = parseIpConfiguration(env);

  return {
    IS_DEVELOPMENT: parseIsDevelopment(env),
    PORT: parsePort(env),
    HOST: parseHost(env),
    HISTORY_DIR: parseHistoryDir(env),
    LOG_LEVEL: parseLogLevel(env),
    WEBROOT: parseWebroot(env),
    SAVE_INTERVAL: parseSaveInterval(env),
    MAX_SAVE_DELAY: parseMaxSaveDelay(env),
    SEQ_REPLAY_RETENTION_MS: parseSeqReplayRetentionMs(env),
    MAX_ITEM_COUNT: parseMaxItemCount(env),
    MAX_CHILDREN: parseMaxChildren(env),
    MAX_BOARD_SIZE: parseMaxBoardSize(env),
    GENERAL_RATE_LIMITS: parseGeneralRateLimits(env),
    CONSTRUCTIVE_ACTION_RATE_LIMITS: parseConstructiveActionRateLimits(env),
    DESTRUCTIVE_ACTION_RATE_LIMITS: parseDestructiveActionRateLimits(env),
    TEXT_CREATION_RATE_LIMITS: parseTextCreationRateLimits(env),
    IP_SOURCE: ipConfiguration.IP_SOURCE,
    TRUST_PROXY_HOPS: ipConfiguration.TRUST_PROXY_HOPS,
    BLOCKED_TOOLS: parseBlockedTools(env),
    BLOCKED_SELECTION_BUTTONS: parseBlockedSelectionButtons(env),
    AUTO_FINGER_WHITEOUT: parseAutoFingerWhiteout(env),
    AUTH_SECRET_KEY: parseAuthSecretKey(env),
    TURNSTILE_SECRET_KEY: parseTurnstileSecretKey(env),
    TURNSTILE_SITE_KEY: parseTurnstileSiteKey(env),
    TURNSTILE_VERIFY_URL: parseTurnstileVerifyUrl(env),
    TURNSTILE_VALIDATION_WINDOW_MS: parseTurnstileValidationWindowMs(env),
    DEFAULT_BOARD: parseDefaultBoard(env),
  };
}
