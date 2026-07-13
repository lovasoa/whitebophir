const assert = require("node:assert/strict");
const test = require("node:test");

/** @param {Record<string, string>} [initialEntries] */
function createLocalStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries));
  return {
    /** @param {string} key */
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    /**
     * @param {string} key
     * @param {string} value
     */
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

/**
 * @template T
 * @param {Record<string, unknown>} windowObject
 * @param {() => T} callback
 * @returns {T}
 */
function withWindow(windowObject, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(global, "window");
  Object.defineProperty(global, "window", {
    configurable: true,
    enumerable: true,
    value: windowObject,
    writable: true,
  });
  try {
    return callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(global, "window", descriptor);
    } else {
      delete (/** @type {any} */ (global).window);
    }
  }
}

test("FriendStore persists normalized visible last names", async () => {
  const {
    FRIEND_LAST_NAMES_STORAGE_KEY,
    FriendStore,
    normalizeFriendLastName,
  } = await import("../client-data/js/board_friend_store.js");
  const storage = createLocalStorage({
    [FRIEND_LAST_NAMES_STORAGE_KEY]: JSON.stringify([
      "  Surname  ",
      "two words",
      42,
    ]),
  });
  const friends = new FriendStore(/** @type {any} */ (storage));

  assert.equal(normalizeFriendLastName("  Surname  "), "surname");
  assert.equal(normalizeFriendLastName("two words"), "");
  assert.equal(normalizeFriendLastName("line\nbreak"), "");
  assert.equal(friends.has("SURNAME"), true);
  assert.equal(friends.has("two words"), false);

  assert.equal(friends.toggle("Newfriend"), true);
  assert.deepEqual(
    JSON.parse(storage.getItem(FRIEND_LAST_NAMES_STORAGE_KEY) || "[]"),
    ["surname", "newfriend"],
  );
  assert.equal(friends.toggle("SURNAME"), false);
  assert.equal(friends.has("surname"), false);
});

test("FriendStore merges writes made by another tab before toggling", async () => {
  const { FRIEND_LAST_NAMES_STORAGE_KEY, FriendStore } = await import(
    "../client-data/js/board_friend_store.js"
  );
  const storage = createLocalStorage();
  const first = new FriendStore(/** @type {any} */ (storage));
  const second = new FriendStore(/** @type {any} */ (storage));

  assert.equal(first.toggle("alice"), true);
  assert.equal(second.toggle("bob"), true);
  assert.deepEqual(
    JSON.parse(storage.getItem(FRIEND_LAST_NAMES_STORAGE_KEY) || "[]"),
    ["alice", "bob"],
  );
});

test("FriendStore keeps in-memory state when storage is malformed or unwritable", async () => {
  const { FriendStore } = await import(
    "../client-data/js/board_friend_store.js"
  );
  const storage = {
    getItem() {
      return "not json";
    },
    setItem() {
      throw new Error("storage disabled");
    },
  };
  const friends = new FriendStore(/** @type {any} */ (storage));

  assert.equal(friends.toggle("durable"), true);
  assert.equal(friends.toggle("another"), true);
  assert.equal(friends.has("durable"), true);
  assert.equal(friends.has("another"), true);
});

test("FriendStore subscriptions refresh changes made by another tab", async () => {
  const { FRIEND_LAST_NAMES_STORAGE_KEY, FriendStore } = await import(
    "../client-data/js/board_friend_store.js"
  );
  const storage = createLocalStorage();
  /** @type {((event: {key: string | null}) => void) | null} */
  let storageListener = null;
  let changeCount = 0;

  withWindow(
    {
      addEventListener(
        /** @type {string} */ eventName,
        /** @type {(event: {key: string | null}) => void} */ listener,
      ) {
        if (eventName === "storage") storageListener = listener;
      },
      removeEventListener() {},
    },
    () => {
      const friends = new FriendStore(/** @type {any} */ (storage));
      friends.subscribe(() => {
        changeCount += 1;
      });
      storage.setItem(
        FRIEND_LAST_NAMES_STORAGE_KEY,
        JSON.stringify(["remotechange"]),
      );
      assert.ok(storageListener);
      storageListener({ key: FRIEND_LAST_NAMES_STORAGE_KEY });
      assert.equal(friends.has("remotechange"), true);
    },
  );

  assert.equal(changeCount, 1);
});
