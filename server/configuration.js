const path = require("path");
const {
  parseEnumEnv,
  parseIntegerEnv,
} = require("./configuration_helpers.js");
const app_root = path.dirname(__dirname); // Parent of the directory where this file is

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
  MAX_CHILDREN: parseIntegerEnv("WBO_MAX_CHILDREN", 192),

  /** Maximum value for any x or y on the board */
  MAX_BOARD_SIZE: parseIntegerEnv("WBO_MAX_BOARD_SIZE", 65536),

  /** Maximum messages per user over the given time period before banning them  */
  MAX_EMIT_COUNT: parseIntegerEnv("WBO_MAX_EMIT_COUNT", 192),

  /** Duration after which the emit count is reset in miliseconds */
  MAX_EMIT_COUNT_PERIOD: parseIntegerEnv("WBO_MAX_EMIT_COUNT_PERIOD", 4096),

  /** Maximum destructive actions per resolved client IP over one minute */
  MAX_DESTRUCTIVE_ACTIONS_PER_IP: parseIntegerEnv(
    "WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP",
    100,
  ),

  /** Duration after which the destructive per-IP count is reset in milliseconds */
  MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS: parseIntegerEnv(
    "WBO_MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS",
    60 * 1000,
  ),

  /** Source used to resolve client IPs for logging and rate limiting.
      Allowed values: remoteAddress, X-Forwarded-For, Forwarded */
  IP_SOURCE: parseEnumEnv(
    "WBO_IP_SOURCE",
    ["remoteAddress", "X-Forwarded-For", "Forwarded"],
    "remoteAddress",
  ),

  /** Blocked Tools. A comma-separated list of tools that should not appear on boards. */
  BLOCKED_TOOLS: (process.env["WBO_BLOCKED_TOOLS"] || "").split(","),

  /** Selection Buttons. A comma-separated list of selection buttons that should not be available. */
  BLOCKED_SELECTION_BUTTONS: (
    process.env["WBO_BLOCKED_SELECTION_BUTTONS"] || ""
  ).split(","),

  /** Automatically switch to White-out on finger touch after drawing
      with Pencil using a stylus. Only supported on iPad with Apple Pencil. */
  AUTO_FINGER_WHITEOUT: process.env["AUTO_FINGER_WHITEOUT"] !== "disabled",

  /** If this variable is set, it should point to a statsd listener that will
   * receive WBO's monitoring information.
   * example: udp://127.0.0.1
   */
  STATSD_URL: process.env["STATSD_URL"],

  /** Secret key for jwt */
  AUTH_SECRET_KEY: process.env["AUTH_SECRET_KEY"] || "",

  /** If this variable is set, automatically redirect to this board from the root of the application. */
  DEFAULT_BOARD: process.env["WBO_DEFAULT_BOARD"],
};
