export const FRIEND_LAST_NAMES_STORAGE_KEY = "wbo.friend-last-names.v1";
const MAX_STORED_FRIENDS = 500;
const MAX_FRIEND_LAST_NAME_LENGTH = 128;

/** @returns {Storage | null} */
function getLocalStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** @param {string} value */
function hasWhitespaceOrControlCharacter(value) {
  for (const character of value) {
    const codeUnit = character.charCodeAt(0);
    if (/\s/u.test(character) || codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * The presence `userId` is the secret-derived final word shown in a user's
 * visible name. Friend state deliberately uses that public value rather than a
 * socket id, IP-derived first name, or private user secret.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFriendLastName(value) {
  if (typeof value !== "string") return "";
  const lastName = value.trim().toLowerCase();
  if (
    lastName === "" ||
    lastName.length > MAX_FRIEND_LAST_NAME_LENGTH ||
    hasWhitespaceOrControlCharacter(lastName)
  ) {
    return "";
  }
  return lastName;
}

/** @param {Storage | null} storage @returns {Set<string> | null} */
function readFriendLastNames(storage) {
  if (!storage) return null;
  try {
    const stored = storage.getItem(FRIEND_LAST_NAMES_STORAGE_KEY);
    const parsed = stored === null ? [] : JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;
    const lastNames = new Set();
    for (const value of parsed) {
      const lastName = normalizeFriendLastName(value);
      if (lastName) lastNames.add(lastName);
      if (lastNames.size >= MAX_STORED_FRIENDS) break;
    }
    return lastNames;
  } catch {
    return null;
  }
}

/** @param {Set<string>} left @param {Set<string>} right */
function equalSets(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

/**
 * Browser-local friend preferences, isolated behind a small persistence API.
 * Storage is injectable so malformed data and write failures stay testable.
 */
export class FriendStore {
  /** @param {Storage | null} [storage] */
  constructor(storage = getLocalStorage()) {
    this.storage = storage;
    this.lastNames = readFriendLastNames(storage) || new Set();
  }

  /** @param {unknown} value */
  has(value) {
    const lastName = normalizeFriendLastName(value);
    return lastName !== "" && this.lastNames.has(lastName);
  }

  /** @param {unknown} value @returns {boolean} the new friend state */
  toggle(value) {
    const lastName = normalizeFriendLastName(value);
    if (!lastName) return false;
    // Merge writes from other tabs before this read-modify-write operation.
    // Storage events are asynchronous and may not have fired in this document.
    this.refresh();
    const shouldMark = !this.lastNames.has(lastName);
    if (shouldMark) {
      if (this.lastNames.size >= MAX_STORED_FRIENDS) return false;
      this.lastNames.add(lastName);
    } else {
      this.lastNames.delete(lastName);
    }
    this.persist();
    return shouldMark;
  }

  /** @returns {boolean} whether the stored set changed */
  refresh() {
    const next = readFriendLastNames(this.storage);
    if (next === null) return false;
    if (equalSets(this.lastNames, next)) return false;
    this.lastNames = next;
    return true;
  }

  /** @param {() => void} listener @returns {() => void} */
  subscribe(listener) {
    if (typeof window === "undefined") return () => {};
    const handleStorage = (/** @type {StorageEvent} */ event) => {
      if (event.key !== null && event.key !== FRIEND_LAST_NAMES_STORAGE_KEY) {
        return;
      }
      if (this.refresh()) listener();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }

  persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        FRIEND_LAST_NAMES_STORAGE_KEY,
        JSON.stringify(Array.from(this.lastNames)),
      );
    } catch {
      // Keep the in-memory preference when storage is disabled or full.
    }
  }
}
