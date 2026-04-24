import RateLimitCommon from "../client-data/js/rate_limit_common.js";

/** @import { ServerConfig } from "../types/server-runtime.d.ts" */
/** @typedef {Pick<ServerConfig, "MAX_BOARD_SIZE" | "GENERAL_RATE_LIMITS" | "CONSTRUCTIVE_ACTION_RATE_LIMITS" | "DESTRUCTIVE_ACTION_RATE_LIMITS" | "TEXT_CREATION_RATE_LIMITS" | "BLOCKED_TOOLS" | "BLOCKED_SELECTION_BUTTONS" | "AUTO_FINGER_WHITEOUT" | "TURNSTILE_SITE_KEY" | "TURNSTILE_VALIDATION_WINDOW_MS">} ClientConfigurationSource */
/** @typedef {Pick<import("../types/app-runtime.d.ts").ServerConfig, "MAX_BOARD_SIZE" | "RATE_LIMITS" | "BLOCKED_TOOLS" | "BLOCKED_SELECTION_BUTTONS" | "AUTO_FINGER_WHITEOUT" | "TURNSTILE_SITE_KEY" | "TURNSTILE_VALIDATION_WINDOW_MS">} ClientConfiguration */

const RATE_LIMIT_KINDS =
  /** @type {Array<"general" | "constructive" | "destructive" | "text">} */ (
    RateLimitCommon.RATE_LIMIT_KINDS
  );
const SERVER_RATE_LIMIT_CONFIG_FIELDS =
  /** @type {{[key in "general" | "constructive" | "destructive" | "text"]: keyof ClientConfigurationSource}} */ (
    RateLimitCommon.SERVER_RATE_LIMIT_CONFIG_FIELDS
  );

/**
 * @param {ClientConfigurationSource} config
 * @returns {ClientConfiguration}
 */
export function createClientConfiguration(config) {
  return {
    MAX_BOARD_SIZE: config.MAX_BOARD_SIZE,
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
    BLOCKED_TOOLS: config.BLOCKED_TOOLS,
    BLOCKED_SELECTION_BUTTONS: config.BLOCKED_SELECTION_BUTTONS,
    AUTO_FINGER_WHITEOUT: config.AUTO_FINGER_WHITEOUT,
    TURNSTILE_SITE_KEY: config.TURNSTILE_SITE_KEY,
    TURNSTILE_VALIDATION_WINDOW_MS: config.TURNSTILE_VALIDATION_WINDOW_MS,
  };
}
