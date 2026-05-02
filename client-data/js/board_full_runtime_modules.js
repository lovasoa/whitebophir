import { getToolRuntimeAssetPath } from "../tools/tool-defaults.js";
import RateLimitCommon from "./rate_limit_common.js";

/** @import { ConfigModule, IdentityModule } from "./board_runtime_core.js" */
/** @import { LiveBoardMessage, RateLimitKind } from "../../types/app-runtime" */

const RATE_LIMIT_KINDS = /** @type {RateLimitKind[]} */ (
  RateLimitCommon.RATE_LIMIT_KINDS
);

/**
 * @param {string} assetPath
 * @returns {string}
 */
export function normalizeBoardAssetPath(assetPath) {
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

export class AssetModule {
  /** @param {(assetPath: string) => string} resolveAssetPath */
  constructor(resolveAssetPath) {
    this.resolveAssetPath = resolveAssetPath;
  }

  /**
   * @param {string} toolName
   * @param {string} assetFile
   */
  getToolAssetUrl(toolName, assetFile) {
    return this.resolveAssetPath(getToolRuntimeAssetPath(toolName, assetFile));
  }
}

/**
 * @typedef {{
 *   suppressOwnCursor?: boolean,
 * }} InteractionLeaseOptions
 * @typedef {{
 *   owner: string,
 *   suppressOwnCursor: boolean,
 * }} InteractionLeaseEntry
 */

export class InteractionModule {
  constructor() {
    this.drawingEvent = true;
    this.showMarker = true;
    this.showOtherCursors = true;
    this.showMyCursor = true;
    this.nextLeaseToken = 0;
    this.leases = /** @type {Map<string, InteractionLeaseEntry>} */ (new Map());
    this.ownCursorSuppressed = false;
  }

  /**
   * @param {string} owner
   * @param {InteractionLeaseOptions} options
   * @returns {{release: () => void}}
   */
  acquire(owner, options) {
    const token = `lease-${++this.nextLeaseToken}`;
    this.leases.set(token, {
      owner,
      suppressOwnCursor: options.suppressOwnCursor === true,
    });
    this.syncLeaseEffects();
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (this.leases.delete(token)) this.syncLeaseEffects();
      },
    };
  }

  /** @param {string} owner */
  releaseOwner(owner) {
    let changed = false;
    this.leases.forEach((lease, token) => {
      if (lease.owner !== owner) return;
      this.leases.delete(token);
      changed = true;
    });
    if (changed) this.syncLeaseEffects();
  }

  releaseAll() {
    if (this.leases.size === 0) return;
    this.leases.clear();
    this.syncLeaseEffects();
  }

  /** @returns {boolean} */
  isOwnCursorSuppressed() {
    return this.ownCursorSuppressed;
  }

  syncLeaseEffects() {
    let suppressOwnCursor = false;
    this.leases.forEach((lease) => {
      suppressOwnCursor = suppressOwnCursor || lease.suppressOwnCursor;
    });

    this.ownCursorSuppressed = suppressOwnCursor;
  }
}

export class IdModule {
  /**
   * @param {string} [prefix]
   * @param {string} [suffix]
   */
  generateUID(prefix, suffix) {
    let uid = Date.now().toString(36);
    uid += Math.round(Math.random() * 36).toString(36);
    if (prefix) uid = prefix + uid;
    if (suffix) uid = uid + suffix;
    return uid;
  }
}

const rateLimitModuleState = new WeakMap();

export class RateLimitModule {
  /**
   * @param {ConfigModule} config
   * @param {IdentityModule} identity
   */
  constructor(config, identity) {
    rateLimitModuleState.set(this, { config, identity });
  }

  /** @param {RateLimitKind} kind */
  getRateLimitDefinition(kind) {
    const state =
      /** @type {{config: ConfigModule, identity: IdentityModule}} */ (
        rateLimitModuleState.get(this)
      );
    const configured = state.config.serverConfig.RATE_LIMITS || {};
    if (configured && configured[kind]) return configured[kind];

    return {
      limit: 0,
      anonymousLimit: 0,
      periodMs: 0,
    };
  }

  /** @param {RateLimitKind} kind */
  getEffectiveRateLimit(kind) {
    const state =
      /** @type {{config: ConfigModule, identity: IdentityModule}} */ (
        rateLimitModuleState.get(this)
      );
    return RateLimitCommon.getEffectiveRateLimitDefinition(
      this.getRateLimitDefinition(kind),
      state.identity.boardName,
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
