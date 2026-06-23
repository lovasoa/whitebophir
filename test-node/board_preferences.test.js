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

/**
 * @template T
 * @param {number} value
 * @param {() => T} callback
 * @returns {T}
 */
function withMathRandom(value, callback) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}

test("createInitialPreferences restores the stored color before choosing a random preset", async () => {
  const { createInitialPreferences } = await import(
    "../client-data/js/board_preferences.js"
  );
  const preferences = withWindow(
    { localStorage: createLocalStorage({ "wbo.currentColor": "#123ABC" }) },
    () =>
      withMathRandom(0.99, () =>
        createInitialPreferences([{ color: "#000000" }, { color: "#ffffff" }]),
      ),
  );

  assert.equal(preferences.color, "#123ABC");
});

test("createInitialPreferences keeps random color choice when localStorage is empty", async () => {
  const { createInitialPreferences } = await import(
    "../client-data/js/board_preferences.js"
  );
  const preferences = withWindow({ localStorage: createLocalStorage() }, () =>
    withMathRandom(0.75, () =>
      createInitialPreferences([{ color: "#000000" }, { color: "#ffffff" }]),
    ),
  );

  assert.equal(preferences.color, "#ffffff");
});

test("PreferenceModule persists color changes", async () => {
  const storage = createLocalStorage();
  const { PreferenceModule } = await import(
    "../client-data/js/board_runtime_core.js"
  );

  withWindow({ localStorage: storage }, () => {
    const preferences = new PreferenceModule([], {
      tool: "hand",
      color: "#000000",
      size: 40,
      opacity: 1,
    });
    preferences.setColor("#ff4136");
  });

  assert.equal(storage.getItem("wbo.currentColor"), "#ff4136");
});
