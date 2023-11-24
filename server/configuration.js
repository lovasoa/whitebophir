const path = require("path");
const app_root = path.dirname(__dirname); // Parent of the directory where this file is

module.exports = {
  /** Port on which the application will listen */
  PORT: parseInt(process.env["PORT"]) || 8080,

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
  SAVE_INTERVAL: parseInt(process.env["WBO_SAVE_INTERVAL"]) || 1000 * 2, // Save after 2 seconds of inactivity

  /** Periodicity at which the board should be saved when it is being actively used (milliseconds)  */
  MAX_SAVE_DELAY: parseInt(process.env["WBO_MAX_SAVE_DELAY"]) || 1000 * 60, // Save after 60 seconds even if there is still activity

  /** Maximal number of items to keep in the board. When there are more items, the oldest ones are deleted */
  MAX_ITEM_COUNT: parseInt(process.env["WBO_MAX_ITEM_COUNT"]) || 32768,

  /** Max number of sub-items in an item. This prevents flooding */
  MAX_CHILDREN: parseInt(process.env["WBO_MAX_CHILDREN"]) || 192,

  /** Maximum value for any x or y on the board */
  MAX_BOARD_SIZE: parseInt(process.env["WBO_MAX_BOARD_SIZE"]) || 65536,

  /** Maximum messages per user over the given time period before banning them  */
  MAX_EMIT_COUNT: parseInt(process.env["WBO_MAX_EMIT_COUNT"]) || 192,

  /** Duration after which the emit count is reset in miliseconds */
  MAX_EMIT_COUNT_PERIOD:
    parseInt(process.env["WBO_MAX_EMIT_COUNT_PERIOD"]) || 4096,

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
