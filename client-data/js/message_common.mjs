import { DRAW_TOOL_NAMES, isShapeTool } from "./message_tool_metadata.mjs";

export const LIMITS = {
  MIN_SIZE: 1,
  MAX_SIZE: 50,
  MIN_OPACITY: 0.1,
  MAX_OPACITY: 1,
  MIN_DRAW_ZOOM: 0.4,
  GIANT_SHAPE_VIEWPORT_WIDTH: 1280,
  GIANT_SHAPE_VIEWPORT_HEIGHT: 720,
  DEFAULT_MAX_BOARD_SIZE: 65536,
  MAX_TEXT_LENGTH: 280,
  COORDINATE_DECIMALS: 1,
  DEFAULT_MAX_CHILDREN: 192,
  MAX_ID_LENGTH: 128,
};

export function truncateText(value, maxLength) {
  if (value === undefined || value === null) value = "";
  return String(value).slice(0, maxLength || LIMITS.MAX_TEXT_LENGTH);
}

export function normalizeFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

export function clampSize(value) {
  let size = parseInt(String(value), 10);
  if (!Number.isFinite(size)) size = LIMITS.MIN_SIZE;
  return clamp(size, LIMITS.MIN_SIZE, LIMITS.MAX_SIZE);
}

export function clampOpacity(value) {
  let opacity = normalizeFiniteNumber(value);
  if (opacity === null) opacity = LIMITS.MAX_OPACITY;
  return clamp(opacity, LIMITS.MIN_OPACITY, LIMITS.MAX_OPACITY);
}

export function normalizeColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : null;
}

export function normalizeId(value, maxLength) {
  if (typeof value !== "string") return null;
  const containsControlOrWhitespace = Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || /\s/.test(char);
  });
  return value.length > 0 &&
    value.length <= (maxLength || LIMITS.MAX_ID_LENGTH) &&
    !containsControlOrWhitespace
    ? value
    : null;
}

export function isDrawTool(toolName) {
  return (
    typeof toolName === "string" && DRAW_TOOL_NAMES.indexOf(toolName) !== -1
  );
}

// ... more functions from message_common.js if needed ...
