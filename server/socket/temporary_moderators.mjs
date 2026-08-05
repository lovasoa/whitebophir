import { randomUUID } from "node:crypto";
import {
  capToMaxSize,
  pruneStaleEntries,
  touchExisting,
} from "./bounded_state_map.mjs";
import { MAX_BAN_TTL_MS } from "./bans.mjs";

export const MAX_TEMPORARY_MODERATOR_TTL_MS = MAX_BAN_TTL_MS;
const GRANT_MAP_MAX_SIZE = 4096;
const GRANT_STALE_SCAN_LIMIT = 16;

/** @typedef {{id: string, expiresAt: number, user: TemporaryModeratorGrantUser | null}} TemporaryModeratorGrant */
/** @typedef {{socketId: string, userId: string, name: string, color: string, size: number, lastTool: string, joinedAt: number, position: {x: number, y: number}}} TemporaryModeratorGrantUser */
/** @typedef {{id: string, expiresAt: number, user: TemporaryModeratorGrantUser | null}} PublicTemporaryModeratorGrant */

/** @type {Map<string, Map<string, TemporaryModeratorGrant>>} */
const boardGrants = new Map();

/** @param {string} boardName */
function boardKey(boardName) {
  return String(boardName).toLowerCase();
}

/**
 * @param {string} boardName
 * @returns {Map<string, TemporaryModeratorGrant>}
 */
function getBoardGrants(boardName) {
  const key = boardKey(boardName);
  let grants = boardGrants.get(key);
  if (grants) return grants;
  grants = new Map();
  boardGrants.set(key, grants);
  return grants;
}

/**
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @param {number} now
 * @param {number} ttlMs
 * @param {TemporaryModeratorGrantUser | null} [user]
 * @returns {number | null}
 */
export function grantTemporaryModerator(
  boardName,
  userSecret,
  now,
  ttlMs,
  user = null,
) {
  if (!userSecret) return null;
  const duration = Number(ttlMs);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > MAX_TEMPORARY_MODERATOR_TTL_MS
  ) {
    return null;
  }
  const grants = getBoardGrants(boardName);
  pruneStaleEntries(
    grants,
    (entry) => entry.expiresAt <= now,
    GRANT_STALE_SCAN_LIMIT,
  );
  const expiresAt = now + Math.floor(duration);
  const existing = grants.get(userSecret);
  grants.set(userSecret, {
    id: existing?.id || randomUUID(),
    expiresAt,
    user: user || existing?.user || null,
  });
  capToMaxSize(grants, GRANT_MAP_MAX_SIZE);
  return expiresAt;
}

/**
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @returns {boolean}
 */
export function revokeTemporaryModerator(boardName, userSecret) {
  if (!userSecret) return false;
  const key = boardKey(boardName);
  const grants = boardGrants.get(key);
  if (!grants) return false;
  const deleted = grants.delete(userSecret);
  if (grants.size === 0) boardGrants.delete(key);
  return deleted;
}

/**
 * @param {string} boardName
 * @param {string} grantId
 * @returns {{userSecret: string, grant: TemporaryModeratorGrant} | null}
 */
export function revokeTemporaryModeratorById(boardName, grantId) {
  if (!grantId) return null;
  const key = boardKey(boardName);
  const grants = boardGrants.get(key);
  if (!grants) return null;
  for (const [userSecret, grant] of grants) {
    if (grant.id !== grantId) continue;
    grants.delete(userSecret);
    if (grants.size === 0) boardGrants.delete(key);
    return { userSecret, grant };
  }
  return null;
}

/**
 * @param {string} boardName
 * @param {number} now
 * @returns {PublicTemporaryModeratorGrant[]}
 */
export function listTemporaryModeratorGrants(boardName, now) {
  const key = boardKey(boardName);
  const grants = boardGrants.get(key);
  if (!grants) return [];
  const result = [];
  for (const [userSecret, grant] of grants) {
    if (grant.expiresAt <= now) {
      grants.delete(userSecret);
      continue;
    }
    result.push({ id: grant.id, expiresAt: grant.expiresAt, user: grant.user });
  }
  if (grants.size === 0) boardGrants.delete(key);
  return result;
}

/**
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @param {number} now
 * @returns {number | null}
 */
export function getTemporaryModeratorExpiresAt(boardName, userSecret, now) {
  if (!userSecret) return null;
  const key = boardKey(boardName);
  const grants = boardGrants.get(key);
  if (!grants) return null;
  const grant = touchExisting(grants, userSecret);
  if (!grant) return null;
  if (grant.expiresAt > now) return grant.expiresAt;
  grants.delete(userSecret);
  if (grants.size === 0) boardGrants.delete(key);
  return null;
}

export function resetTemporaryModerators() {
  boardGrants.clear();
}
