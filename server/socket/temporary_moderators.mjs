import { MAX_BAN_TTL_MS } from "./bans.mjs";
import {
  capToMaxSize,
  pruneStaleEntries,
  touchExisting,
} from "./bounded_state_map.mjs";

export const MAX_TEMPORARY_MODERATOR_TTL_MS = MAX_BAN_TTL_MS;
const MAX_GRANTS = 4096;
/** @type {Map<string, number>} */
const grants = new Map();

/** @param {string} boardName @param {string} userSecret */
function grantKey(boardName, userSecret) {
  return `${String(boardName).toLowerCase()}\0${userSecret}`;
}

/** @param {string} boardName @param {string | null | undefined} userSecret @param {number} now @param {number} ttlMs */
export function grantTemporaryModerator(boardName, userSecret, now, ttlMs) {
  if (
    !userSecret ||
    !Number.isFinite(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > MAX_TEMPORARY_MODERATOR_TTL_MS
  ) {
    return null;
  }
  pruneStaleEntries(grants, (expiresAt) => expiresAt <= now, 16);
  const expiresAt = now + Math.floor(ttlMs);
  grants.set(grantKey(boardName, userSecret), expiresAt);
  capToMaxSize(grants, MAX_GRANTS);
  return expiresAt;
}

/** @param {string} boardName @param {string | null | undefined} userSecret */
export function revokeTemporaryModerator(boardName, userSecret) {
  return !!userSecret && grants.delete(grantKey(boardName, userSecret));
}

/** @param {string} boardName @param {string | null | undefined} userSecret @param {number} now */
export function getTemporaryModeratorExpiresAt(boardName, userSecret, now) {
  if (!userSecret) return null;
  const key = grantKey(boardName, userSecret);
  const expiresAt = touchExisting(grants, key);
  if (!expiresAt || expiresAt <= now) {
    grants.delete(key);
    return null;
  }
  return expiresAt;
}

export function resetTemporaryModerators() {
  grants.clear();
}
