import { getToolRuntimeAssetPath } from "../tools/tool-defaults.js";
import RateLimitCommon from "./rate_limit_common.js";

/** @import { AppConfigModule, AppIdentityModule, LiveBoardMessage, RateLimitKind } from "../../types/app-runtime" */

const RATE_LIMIT_KINDS = /** @type {RateLimitKind[]} */ (
  RateLimitCommon.RATE_LIMIT_KINDS
);

export class AssetModule {
  /** @param {string} assetPath */
  resolveAssetPath(assetPath) {
    if (
      assetPath.startsWith("./") ||
      assetPath.startsWith("../") ||
      assetPath.startsWith("/") ||
      assetPath.startsWith("data:") ||
      assetPath.startsWith("http://") ||
      assetPath.startsWith("https://")
    ) {
      return assetPath;
    }
    return `../${assetPath}`;
  }

  /**
   * @param {string} toolName
   * @param {string} assetFile
   */
  getToolAssetUrl(toolName, assetFile) {
    return this.resolveAssetPath(getToolRuntimeAssetPath(toolName, assetFile));
  }
}

export class InteractionModule {
  constructor() {
    this.drawingEvent = true;
    this.showMarker = true;
    this.showOtherCursors = true;
    this.showMyCursor = true;
    this.ownCursorSuppressionOwners = new Set();
  }

  /**
   * @param {string} owner
   * @returns {{release: () => void}}
   */
  suppressOwnCursor(owner) {
    this.ownCursorSuppressionOwners.add(owner);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.ownCursorSuppressionOwners.delete(owner);
      },
    };
  }

  /** @param {string} owner */
  releaseOwner(owner) {
    this.ownCursorSuppressionOwners.delete(owner);
  }

  releaseAll() {
    this.ownCursorSuppressionOwners.clear();
  }

  /** @returns {boolean} */
  isOwnCursorSuppressed() {
    return this.ownCursorSuppressionOwners.size > 0;
  }
}

export class IdModule {
  generateUID(prefix = "") {
    return prefix + crypto.getRandomValues(new Uint32Array(4)).join("-");
  }
}

export class RateLimitModule {
  #config;
  #identity;

  /**
   * @param {AppConfigModule} config
   * @param {AppIdentityModule} identity
   */
  constructor(config, identity) {
    this.#config = config;
    this.#identity = identity;
  }

  /** @param {RateLimitKind} kind */
  getRateLimitDefinition(kind) {
    const configured = this.#config.serverConfig.RATE_LIMITS?.[kind];
    if (configured) return configured;

    return {
      limit: 0,
      anonymousLimit: 0,
      periodMs: 0,
    };
  }

  /** @param {RateLimitKind} kind */
  getEffectiveRateLimit(kind) {
    return RateLimitCommon.getEffectiveRateLimitDefinition(
      this.getRateLimitDefinition(kind),
      this.#identity.boardName,
    );
  }

  /** @param {LiveBoardMessage} message */
  getBufferedWriteCosts(message) {
    return RATE_LIMIT_KINDS.reduce(
      (costs, kind) => {
        costs[kind] = RateLimitCommon.getRateLimitCost(kind, message);
        return costs;
      },
      /** @type {import("../../types/app-runtime").RateLimitCosts} */ ({}),
    );
  }
}
