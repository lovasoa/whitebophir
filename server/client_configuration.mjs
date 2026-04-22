import config from "./configuration.mjs";
import RateLimitCommon from "../client-data/js/rate_limit_common.js";

const RATE_LIMIT_KINDS =
  /** @type {Array<"general" | "constructive" | "destructive" | "text">} */ (
    RateLimitCommon.RATE_LIMIT_KINDS
  );
const SERVER_RATE_LIMIT_CONFIG_FIELDS =
  /** @type {{[key in "general" | "constructive" | "destructive" | "text"]: keyof typeof config}} */ (
    RateLimitCommon.SERVER_RATE_LIMIT_CONFIG_FIELDS
  );

const {
  MAX_BOARD_SIZE,
  BLOCKED_TOOLS,
  BLOCKED_SELECTION_BUTTONS,
  AUTO_FINGER_WHITEOUT,
  TURNSTILE_SITE_KEY,
  TURNSTILE_VALIDATION_WINDOW_MS,
} = config;

/** Settings that should be handed through to the clients */
const clientConfiguration = {
  MAX_BOARD_SIZE,
  RATE_LIMITS: RATE_LIMIT_KINDS.reduce(
    (limits, kind) => {
      limits[kind] =
        /** @type {import("../types/app-runtime.d.ts").ConfiguredRateLimitDefinition | undefined} */ (
          config[SERVER_RATE_LIMIT_CONFIG_FIELDS[kind]]
        );
      return limits;
    },
    /** @type {NonNullable<import("../types/app-runtime.d.ts").ServerConfig["RATE_LIMITS"]>} */ ({}),
  ),
  BLOCKED_TOOLS,
  BLOCKED_SELECTION_BUTTONS,
  AUTO_FINGER_WHITEOUT,
  TURNSTILE_SITE_KEY,
  TURNSTILE_VALIDATION_WINDOW_MS,
};

export default clientConfiguration;
