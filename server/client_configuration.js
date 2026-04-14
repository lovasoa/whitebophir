const config = require("./configuration");

/** Settings that should be handed through to the clients  */
module.exports = {
  MAX_BOARD_SIZE: config.MAX_BOARD_SIZE,
  RATE_LIMITS: {
    general: config.GENERAL_RATE_LIMITS,
    constructive: config.CONSTRUCTIVE_ACTION_RATE_LIMITS,
    destructive: config.DESTRUCTIVE_ACTION_RATE_LIMITS,
  },
  BLOCKED_TOOLS: config.BLOCKED_TOOLS,
  BLOCKED_SELECTION_BUTTONS: config.BLOCKED_SELECTION_BUTTONS,
  AUTO_FINGER_WHITEOUT: config.AUTO_FINGER_WHITEOUT,
  TURNSTILE_SITE_KEY: config.TURNSTILE_SITE_KEY,
  TURNSTILE_VALIDATION_WINDOW_MS: config.TURNSTILE_VALIDATION_WINDOW_MS,
};
