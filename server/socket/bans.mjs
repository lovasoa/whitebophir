// Per-board edit bans, keyed independently by user secret and by IP.
//
// A ban is just an expiry: the key may not perform persistent edits until
// `expiresAt`. This is the "divergent" half of abuse prevention; the bounded,
// self-pruning map it lives in is shared with rate limiting via
// bounded_state_map.mjs.

import {
  capToMaxSize,
  pruneStaleEntries,
  touchExisting,
} from "./bounded_state_map.mjs";

export const DEFAULT_BAN_TTL_MS = 15 * 60 * 1000;
export const MAX_BAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BAN_MAP_MAX_SIZE = 4096;
const BAN_STALE_SCAN_LIMIT = 16;

/** @typedef {{ expiresAt: number }} BanEntry */
/** @typedef {{ secrets: Map<string, BanEntry>, ips: Map<string, BanEntry> }} BoardBans */

/** @type {Map<string, BoardBans>} */
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
 * @returns {BoardBans}
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
 * @param {BanEntry} entry
 * @param {number} now
 * @returns {boolean}
 */
function isExpired(entry, now) {
  return entry.expiresAt <= now;
}

/**
 * Bans a single key until `now + ttlMs`, opportunistically dropping expired
 * leading entries and capping the map so it stays bounded.
 *
 * @param {Map<string, BanEntry>} map
 * @param {string | undefined | null} key
 * @param {number} now
 * @param {number} ttlMs
 * @returns {void}
 */
function banKey(map, key, now, ttlMs) {
  if (!key) return;
  pruneStaleEntries(
    map,
    (entry) => isExpired(entry, now),
    BAN_STALE_SCAN_LIMIT,
  );
  map.set(key, { expiresAt: now + ttlMs });
  capToMaxSize(map, BAN_MAP_MAX_SIZE);
}

/**
 * @param {Map<string, BanEntry>} map
 * @param {string | undefined | null} key
 * @param {number} now
 * @returns {number | null}
 */
function getKeyBanExpiresAt(map, key, now) {
  if (!key) return null;
  const entry = touchExisting(map, key);
  if (!entry) return null;
  if (!isExpired(entry, now)) return entry.expiresAt;
  map.delete(key);
  return null;
}

/**
 * @param {unknown} ttlMs
 * @returns {number}
 */
export function normalizeBanTtlMs(ttlMs) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_BAN_TTL_MS;
  return Math.min(Math.floor(value), MAX_BAN_TTL_MS);
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
  ttlMs = DEFAULT_BAN_TTL_MS,
) {
  const bans = getBoardBans(boardName);
  const normalizedTtlMs = normalizeBanTtlMs(ttlMs);
  banKey(bans.secrets, userSecret, now, normalizedTtlMs);
  banKey(bans.ips, ip, now, normalizedTtlMs);
}

/**
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @param {string | undefined | null} ip
 * @param {number} now
 * @returns {boolean}
 */
export function isEditBanned(boardName, userSecret, ip, now) {
  return getEditBanExpiresAt(boardName, userSecret, ip, now) !== null;
}

/**
 * Returns when every ban matching this identity has expired. Secret and IP
 * bans can overlap with different lifetimes, so access remains restricted
 * until the later active expiry.
 *
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @param {string | undefined | null} ip
 * @param {number} now
 * @returns {number | null}
 */
export function getEditBanExpiresAt(boardName, userSecret, ip, now) {
  const bans = boardBans.get(boardKey(boardName));
  if (!bans) return null;
  const secretExpiresAt = getKeyBanExpiresAt(bans.secrets, userSecret, now);
  const ipExpiresAt = getKeyBanExpiresAt(bans.ips, ip, now);
  if (secretExpiresAt === null) return ipExpiresAt;
  if (ipExpiresAt === null) return secretExpiresAt;
  return Math.max(secretExpiresAt, ipExpiresAt);
}

export function resetBans() {
  boardBans.clear();
}
