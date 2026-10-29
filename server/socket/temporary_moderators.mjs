import { capToMaxSize } from "./bounded_state_map.mjs";

const MAX_GRANTS = 4096;
const grants = /** @type {Map<string, number>} */ (new Map());

/** @param {string} boardName @param {string} userSecret */
function grantKey(boardName, userSecret) {
  return `${String(boardName).toLowerCase()}\0${userSecret}`;
}

/** @param {string} boardName @param {string} userSecret @param {number | null} expiresAt */
export function setTemporaryModerator(boardName, userSecret, expiresAt) {
  const key = grantKey(boardName, userSecret);
  if (expiresAt === null) grants.delete(key);
  else grants.set(key, expiresAt);
  capToMaxSize(grants, MAX_GRANTS);
}

/** @param {string} boardName @param {string | null | undefined} userSecret @param {number} now */
export function getTemporaryModeratorExpiresAt(boardName, userSecret, now) {
  if (!userSecret) return null;
  const key = grantKey(boardName, userSecret);
  const expiresAt = grants.get(key);
  if (!expiresAt || expiresAt <= now) {
    grants.delete(key);
    return null;
  }
  return expiresAt;
}

export function resetTemporaryModerators() {
  grants.clear();
}
