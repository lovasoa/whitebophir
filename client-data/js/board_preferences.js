/** @import { AppInitialPreferences, ColorPreset } from "../../types/app-runtime" */

const DEFAULT_INITIAL_SIZE = 40;
const DEFAULT_INITIAL_OPACITY = 1;
const LOCAL_STORAGE_COLOR_KEY = "wbo.currentColor";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_COLOR_PRESETS = [
  { color: "#001f3f", key: "1" },
  { color: "#FF4136", key: "2" },
  { color: "#0074D9", key: "3" },
  { color: "#FF851B", key: "4" },
  { color: "#FFDC00", key: "5" },
  { color: "#3D9970", key: "6" },
  { color: "#91E99B", key: "7" },
  { color: "#90468b", key: "8" },
  { color: "#7FDBFF", key: "9" },
  { color: "#AAAAAA", key: "0" },
  { color: "#E65194" },
];

/**
 * @param {unknown} color
 * @returns {color is string}
 */
function isStoredColor(color) {
  return typeof color === "string" && HEX_COLOR_RE.test(color);
}

/**
 * @returns {Storage | null}
 */
function getLocalStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * @returns {string | null}
 */
export function readStoredColorPreference() {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const color = storage.getItem(LOCAL_STORAGE_COLOR_KEY);
    return isStoredColor(color) ? color : null;
  } catch {
    return null;
  }
}

/** @param {string} color */
export function saveStoredColorPreference(color) {
  if (!isStoredColor(color)) return;
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(LOCAL_STORAGE_COLOR_KEY, color);
  } catch {
    // Ignore browsers that make localStorage unavailable.
  }
}

/**
 * @param {ColorPreset[]} colorPresets
 * @returns {AppInitialPreferences}
 */
export function createInitialPreferences(colorPresets = DEFAULT_COLOR_PRESETS) {
  const storedColor = readStoredColorPreference();
  if (storedColor) {
    return {
      tool: "hand",
      color: storedColor,
      size: DEFAULT_INITIAL_SIZE,
      opacity: DEFAULT_INITIAL_OPACITY,
    };
  }
  const colorIndex = (Math.random() * colorPresets.length) | 0;
  const initialPreset = colorPresets[colorIndex] || colorPresets[0];
  return {
    tool: "hand",
    color: initialPreset?.color || "#001f3f",
    size: DEFAULT_INITIAL_SIZE,
    opacity: DEFAULT_INITIAL_OPACITY,
  };
}
