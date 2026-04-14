const config = require("./configuration");

/** Settings that should be handed through to the clients  */
module.exports = {
  MAX_BOARD_SIZE: config.MAX_BOARD_SIZE,
  MAX_EMIT_COUNT: config.MAX_EMIT_COUNT,
  MAX_EMIT_COUNT_PERIOD: config.MAX_EMIT_COUNT_PERIOD,
  RATE_LIMITS: {
    general: {
      limit: config.MAX_EMIT_COUNT,
      periodMs: config.MAX_EMIT_COUNT_PERIOD,
    },
    constructive: config.CONSTRUCTIVE_ACTION_RATE_LIMITS,
    destructive: config.DESTRUCTIVE_ACTION_RATE_LIMITS,
  },
  BLOCKED_TOOLS: config.BLOCKED_TOOLS,
  BLOCKED_SELECTION_BUTTONS: config.BLOCKED_SELECTION_BUTTONS,
  AUTO_FINGER_WHITEOUT: config.AUTO_FINGER_WHITEOUT,
  TURNSTILE_SITE_KEY: config.TURNSTILE_SITE_KEY,
  TURNSTILE_VALIDATION_WINDOW_MS: config.TURNSTILE_VALIDATION_WINDOW_MS,
};
