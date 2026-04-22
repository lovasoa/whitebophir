import {
  parseAuthSecretKey,
  parseAutoFingerWhiteout,
  parseBlockedSelectionButtons,
  parseBlockedTools,
  parseConstructiveActionRateLimits,
  parseDefaultBoard,
  parseDestructiveActionRateLimits,
  parseGeneralRateLimits,
  parseHistoryDir,
  parseHost,
  parseIpConfiguration,
  parseIsDevelopment,
  parseLogLevel,
  parseMaxBoardSize,
  parseMaxChildren,
  parseMaxItemCount,
  parseMaxSaveDelay,
  parsePort,
  parseSaveInterval,
  parseSeqReplayRetentionMs,
  parseTextCreationRateLimits,
  parseTurnstileSecretKey,
  parseTurnstileSiteKey,
  parseTurnstileValidationWindowMs,
  parseTurnstileVerifyUrl,
  parseWebroot,
} from "./configuration_values.mjs";

/** True outside production. */
export const IS_DEVELOPMENT = parseIsDevelopment();

/** Application listen port. */
export const PORT = parsePort();

/** Application listen host. Empty means all interfaces. */
export const HOST = parseHost();

/** Board persistence directory. */
export const HISTORY_DIR = parseHistoryDir();

/** Minimum emitted server log level: debug, info, warn, or error. */
export const LOG_LEVEL = parseLogLevel();

/** Static asset root. */
export const WEBROOT = parseWebroot();

/** Inactivity delay before saving a board. */
export const SAVE_INTERVAL = parseSaveInterval();

/** Maximum active-use delay between saves. */
export const MAX_SAVE_DELAY = parseMaxSaveDelay();

/** Replay retention window after save. */
export const SEQ_REPLAY_RETENTION_MS = parseSeqReplayRetentionMs();

/** Maximum persisted item count per board. */
export const MAX_ITEM_COUNT = parseMaxItemCount();

/** Maximum child count inside one item payload. */
export const MAX_CHILDREN = parseMaxChildren();

/** Maximum absolute board coordinate. */
export const MAX_BOARD_SIZE = parseMaxBoardSize();

/** Per-socket general write rate limits. Example: `*:250/5s anonymous:125/5s`. */
export const GENERAL_RATE_LIMITS = parseGeneralRateLimits();

/** Per-IP constructive write rate limits. Example: `*:40/10s anonymous:20/10s`. */
export const CONSTRUCTIVE_ACTION_RATE_LIMITS =
  parseConstructiveActionRateLimits();

/** Per-IP destructive write rate limits. Example: `*:190/60s anonymous:95/60s`. */
export const DESTRUCTIVE_ACTION_RATE_LIMITS =
  parseDestructiveActionRateLimits();

/** Per-IP text creation rate limits. Example: `*:2/1s anonymous:30/60s`. */
export const TEXT_CREATION_RATE_LIMITS = parseTextCreationRateLimits();

const IP_CONFIGURATION = parseIpConfiguration();

/** IP resolution source: remoteAddress, Forwarded, X-Forwarded-For, or a header name. */
export const IP_SOURCE = IP_CONFIGURATION.IP_SOURCE;

/** Trusted proxy hop count for forwarded headers. */
export const TRUST_PROXY_HOPS = IP_CONFIGURATION.TRUST_PROXY_HOPS;

/** Comma-separated blocked tool ids. */
export const BLOCKED_TOOLS = parseBlockedTools();

/** Comma-separated blocked selection button ids. */
export const BLOCKED_SELECTION_BUTTONS = parseBlockedSelectionButtons();

/** Enables stylus-then-finger whiteout unless set to `disabled`. */
export const AUTO_FINGER_WHITEOUT = parseAutoFingerWhiteout();

/** JWT secret key. */
export const AUTH_SECRET_KEY = parseAuthSecretKey();

/** Cloudflare Turnstile secret key. */
export const TURNSTILE_SECRET_KEY = parseTurnstileSecretKey();

/** Cloudflare Turnstile site key. */
export const TURNSTILE_SITE_KEY = parseTurnstileSiteKey();

/** Turnstile verification endpoint override. */
export const TURNSTILE_VERIFY_URL = parseTurnstileVerifyUrl();

/** Successful Turnstile validation lifetime. */
export const TURNSTILE_VALIDATION_WINDOW_MS =
  parseTurnstileValidationWindowMs();

/** Root-route board redirect target. */
export const DEFAULT_BOARD = parseDefaultBoard();
