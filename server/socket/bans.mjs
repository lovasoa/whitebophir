import RateLimitCommon from "../../client-data/js/rate_limit_common.js";
import {
  capToMaxSize,
  pruneStaleEntries,
  touchExisting,
} from "./bounded_state_map.mjs";

const BAN_TTL_MS = 30 * 60 * 1000;
const BAN_MAP_MAX_SIZE = 4096;
const BAN_STALE_SCAN_LIMIT = 16;

/** @type {Map<string, {secrets: Map<string, import("../../types/server-runtime.d.ts").RateLimitState>, ips: Map<string, import("../../types/server-runtime.d.ts").RateLimitState>}>} */
const boardBans = new Map();

/**
 * @param {string} boardName
 * @returns {string}
 */
function boardKey(boardName) {
  return String(boardName).toLowerCase();
}

/**
 * @param {string} boardName
 * @returns {{secrets: Map<string, import("../../types/server-runtime.d.ts").RateLimitState>, ips: Map<string, import("../../types/server-runtime.d.ts").RateLimitState>}}
 */
function getBoardBans(boardName) {
  const key = boardKey(boardName);
  let bans = boardBans.get(key);
  if (bans) return bans;
  bans = { secrets: new Map(), ips: new Map() };
  boardBans.set(key, bans);
  return bans;
}

/**
 * @param {Map<string, import("../../types/server-runtime.d.ts").RateLimitState>} map
 * @param {string | undefined | null} key
 * @param {number} now
 * @param {number} ttlMs
 * @returns {void}
 */
function setBan(map, key, now, ttlMs) {
  if (!key) return;
  pruneStaleEntries(
    map,
    (state) => RateLimitCommon.isRateLimitStateStale(state, ttlMs, now),
    BAN_STALE_SCAN_LIMIT,
  );
  map.set(
    key,
    RateLimitCommon.consumeFixedWindowRateLimit(
      RateLimitCommon.createRateLimitState(now),
      1,
      ttlMs,
      now,
    ),
  );
  capToMaxSize(map, BAN_MAP_MAX_SIZE);
}

/**
 * @param {Map<string, import("../../types/server-runtime.d.ts").RateLimitState>} map
 * @param {string | undefined | null} key
 * @param {number} now
 * @param {number} ttlMs
 * @returns {boolean}
 */
function isBanned(map, key, now, ttlMs) {
  if (!key) return false;
  const state = touchExisting(map, key);
  if (!state) return false;
  if (RateLimitCommon.getRateLimitRemainingMs(state, ttlMs, now) > 0) {
    return true;
  }
  map.delete(key);
  return false;
}

/**
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @param {string | undefined | null} ip
 * @param {number} now
 * @param {number} [ttlMs]
 * @returns {void}
 */
export function banBoardUser(
  boardName,
  userSecret,
  ip,
  now,
  ttlMs = BAN_TTL_MS,
) {
  const bans = getBoardBans(boardName);
  setBan(bans.secrets, userSecret, now, ttlMs);
  setBan(bans.ips, ip, now, ttlMs);
}

/**
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @param {string | undefined | null} ip
 * @param {number} now
 * @param {number} [ttlMs]
 * @returns {boolean}
 */
export function isEditBanned(
  boardName,
  userSecret,
  ip,
  now,
  ttlMs = BAN_TTL_MS,
) {
  const bans = boardBans.get(boardKey(boardName));
  if (!bans) return false;
  return (
    isBanned(bans.secrets, userSecret, now, ttlMs) ||
    isBanned(bans.ips, ip, now, ttlMs)
  );
}

export function resetBans() {
  boardBans.clear();
}
