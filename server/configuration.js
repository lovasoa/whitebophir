const path = require("node:path");
const {
  parseIntegerEnv,
  parseRateLimitProfileEnv,
} = require("./configuration_helpers.js");
const RateLimitCommon = require("../client-data/js/rate_limit_common.js");
const app_root = path.dirname(__dirname); // Parent of the directory where this file is

const ipSource = (process.env["WBO_IP_SOURCE"] || "remoteAddress").trim();
const trustProxyHops = parseIntegerEnv("WBO_TRUST_PROXY_HOPS", 0);

if (trustProxyHops < 0) {
  throw new Error("Invalid WBO_TRUST_PROXY_HOPS: must be >= 0");
}

const normalizedIpSource = ipSource.toLowerCase();
if (
  trustProxyHops > 0 &&
  normalizedIpSource !== "x-forwarded-for" &&
  normalizedIpSource !== "forwarded"
) {
  throw new Error(
    "WBO_TRUST_PROXY_HOPS requires WBO_IP_SOURCE to be X-Forwarded-For or Forwarded",
  );
}

const DEFAULT_CONSTRUCTIVE_ACTION_RATE_LIMITS = parseRateLimitProfileEnv(
  "WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP",
  {
    limit: 40,
    periodMs: 10 * 1000,
    overrides: {
      anonymous: {
        limit: Math.floor(40 / RateLimitCommon.ANONYMOUS_RATE_LIMIT_DIVISOR),
        periodMs: 10 * 1000,
      },
    },
  },
);

const DEFAULT_DESTRUCTIVE_ACTION_RATE_LIMITS = parseRateLimitProfileEnv(
  "WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP",
  {
    limit: 190,
    periodMs: 60 * 1000,
    overrides: {
      anonymous: {
        limit: Math.floor(190 / RateLimitCommon.ANONYMOUS_RATE_LIMIT_DIVISOR),
        periodMs: 60 * 1000,
      },
    },
  },
);

const DEFAULT_GENERAL_RATE_LIMITS = parseRateLimitProfileEnv(
  "WBO_MAX_EMIT_COUNT",
  {
    limit: 250,
    periodMs: 5 * 1000,
    overrides: {},
  },
);

module.exports = {
  /** Port on which the application will listen */
  PORT: parseIntegerEnv("PORT", 8080),

  /** Host on which the application will listen (defaults to undefined,
        hence listen on all interfaces on all IP addresses, but could also be
        '127.0.0.1' **/
  HOST: process.env["HOST"] || undefined,

  /** Path to the directory where boards will be saved by default */
  HISTORY_DIR:
    process.env["WBO_HISTORY_DIR"] || path.join(app_root, "server-data"),

  /** Folder from which static files will be served */
  WEBROOT: process.env["WBO_WEBROOT"] || path.join(app_root, "client-data"),

  /** Number of milliseconds of inactivity after which the board should be saved to a file */
  SAVE_INTERVAL: parseIntegerEnv("WBO_SAVE_INTERVAL", 1000 * 2), // Save after 2 seconds of inactivity

  /** Periodicity at which the board should be saved when it is being actively used (milliseconds)  */
  MAX_SAVE_DELAY: parseIntegerEnv("WBO_MAX_SAVE_DELAY", 1000 * 60), // Save after 60 seconds even if there is still activity

  /** Maximal number of items to keep in the board. When there are more items, the oldest ones are deleted */
  MAX_ITEM_COUNT: parseIntegerEnv("WBO_MAX_ITEM_COUNT", 32768),

  /** Max number of sub-items in an item. This prevents flooding */
  MAX_CHILDREN: parseIntegerEnv("WBO_MAX_CHILDREN", 500),

  /** Maximum value for any x or y on the board */
  MAX_BOARD_SIZE: parseIntegerEnv("WBO_MAX_BOARD_SIZE", 65536),

  /** General socket write limits.
      Use WBO_MAX_EMIT_COUNT with compact profiles such as `*:250/5s anonymous:125/5s`.
      Each profile entry is `board:limit/period`, `*` is the default, and every board keeps one counter per socket connection.
      Every broadcast event costs exactly 1 regardless of tool.
      This is a fixed window: the first write starts the window, every write increments the counter,
      and the counter resets completely once the configured period elapses. */
  GENERAL_RATE_LIMITS: DEFAULT_GENERAL_RATE_LIMITS,

  /** Destructive per-IP fixed-window limits.
      Use WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP with compact profiles such as `*:190/60s anonymous:95/60s`.
      Each profile entry is `board:limit/period`, `*` is the default, and every board keeps one counter per resolved client IP.
      Destructive cost counts deletes and clears, and batched messages sum their destructive children.
      This is a fixed window: the first destructive write starts the window, every matching action increments the counter,
      and the counter resets completely once the configured period elapses. */
  DESTRUCTIVE_ACTION_RATE_LIMITS: DEFAULT_DESTRUCTIVE_ACTION_RATE_LIMITS,

  /** Default destructive per-IP limit derived from WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP. */
  MAX_DESTRUCTIVE_ACTIONS_PER_IP: DEFAULT_DESTRUCTIVE_ACTION_RATE_LIMITS.limit,

  /** Default destructive fixed-window duration in milliseconds derived from WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP. */
  MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS:
    DEFAULT_DESTRUCTIVE_ACTION_RATE_LIMITS.periodMs,

  /** Anonymous-board destructive limit derived from WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP. */
  ANONYMOUS_MAX_DESTRUCTIVE_ACTIONS_PER_IP:
    DEFAULT_DESTRUCTIVE_ACTION_RATE_LIMITS.overrides.anonymous &&
    DEFAULT_DESTRUCTIVE_ACTION_RATE_LIMITS.overrides.anonymous.limit,

  /** Constructive per-IP fixed-window limits.
      Use WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP with compact profiles such as `*:40/10s anonymous:20/10s`.
      Each profile entry is `board:limit/period`, `*` is the default, and every board keeps one counter per resolved client IP.
      Constructive cost counts creates and copies with an id, but excludes child points, updates, deletes, and clears.
      This is a fixed window: the first constructive write starts the window, every matching action increments the counter,
      and the counter resets completely once the configured period elapses. */
  CONSTRUCTIVE_ACTION_RATE_LIMITS: DEFAULT_CONSTRUCTIVE_ACTION_RATE_LIMITS,

  /** Default constructive per-IP limit derived from WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP. */
  MAX_CONSTRUCTIVE_ACTIONS_PER_IP:
    DEFAULT_CONSTRUCTIVE_ACTION_RATE_LIMITS.limit,

  /** Default constructive fixed-window duration in milliseconds derived from WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP. */
  MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS:
    DEFAULT_CONSTRUCTIVE_ACTION_RATE_LIMITS.periodMs,

  /** Anonymous-board constructive limit derived from WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP. */
  ANONYMOUS_MAX_CONSTRUCTIVE_ACTIONS_PER_IP:
    DEFAULT_CONSTRUCTIVE_ACTION_RATE_LIMITS.overrides.anonymous &&
    DEFAULT_CONSTRUCTIVE_ACTION_RATE_LIMITS.overrides.anonymous.limit,

  /** Source used to resolve client IPs for logging and rate limiting.
      Supports remoteAddress, Forwarded, X-Forwarded-For, or any custom header
      such as CF-Connecting-IP. Header lookup is case-insensitive. */
  IP_SOURCE: ipSource,

  /** Number of trusted proxy hops between the app and the client for
      list-style forwarding headers such as X-Forwarded-For and Forwarded.
      When set to a positive value, the app mirrors the common Express
      `trust proxy = <number>` pattern and walks proxy hops from right to left.
      When left at 0, existing single-hop behavior is preserved. */
  TRUST_PROXY_HOPS: trustProxyHops,

  /** Blocked Tools. A comma-separated list of tools that should not appear on boards. */
  BLOCKED_TOOLS: (process.env["WBO_BLOCKED_TOOLS"] || "").split(","),

  /** Selection Buttons. A comma-separated list of selection buttons that should not be available. */
  BLOCKED_SELECTION_BUTTONS: (
    process.env["WBO_BLOCKED_SELECTION_BUTTONS"] || ""
  ).split(","),

  /** Automatically switch to White-out on finger touch after drawing
      with Pencil using a stylus. Only supported on iPad with Apple Pencil. */
  AUTO_FINGER_WHITEOUT: process.env["AUTO_FINGER_WHITEOUT"] !== "disabled",

  /** Secret key for jwt */
  AUTH_SECRET_KEY: process.env["AUTH_SECRET_KEY"] || "",

  /** Cloudflare Turnstile secret key */
  TURNSTILE_SECRET_KEY: process.env["TURNSTILE_SECRET_KEY"],

  /** Cloudflare Turnstile site key */
  TURNSTILE_SITE_KEY: process.env["TURNSTILE_SITE_KEY"],

  /** Override Turnstile verification endpoint, primarily for tests */
  TURNSTILE_VERIFY_URL:
    process.env["TURNSTILE_VERIFY_URL"] ||
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",

  /** Duration for which a successful Turnstile validation authorizes protected writes */
  TURNSTILE_VALIDATION_WINDOW_MS: parseIntegerEnv(
    "TURNSTILE_VALIDATION_WINDOW_MS",
    1000 * 60 * 4,
  ),

  /** If this variable is set, automatically redirect to this board from the root of the application. */
  DEFAULT_BOARD: process.env["WBO_DEFAULT_BOARD"],
};
