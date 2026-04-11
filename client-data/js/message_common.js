(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WBOMessageCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var LIMITS = {
    MIN_SIZE: 1,
    MAX_SIZE: 50,
    MIN_OPACITY: 0.1,
    MAX_OPACITY: 1,
    DEFAULT_MAX_BOARD_SIZE: 65536,
    MAX_TEXT_LENGTH: 280,
    COORDINATE_DECIMALS: 1,
    DEFAULT_MAX_CHILDREN: 192,
    MAX_ID_LENGTH: 128,
  };

  function toFiniteNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(number, min, max) {
    return Math.min(Math.max(number, min), max);
  }

  function roundToDecimals(number, decimals) {
    var factor = Math.pow(10, decimals);
    return Math.round(number * factor) / factor;
  }

  function resolveMaxBoardSize(maxBoardSize) {
    var resolved = toFiniteNumber(maxBoardSize);
    return resolved === null ? LIMITS.DEFAULT_MAX_BOARD_SIZE : resolved;
  }

  function clampSize(value) {
    var size = parseInt(value, 10);
    if (!Number.isFinite(size)) size = LIMITS.MIN_SIZE;
    return clamp(size, LIMITS.MIN_SIZE, LIMITS.MAX_SIZE);
  }

  function clampOpacity(value) {
    var opacity = toFiniteNumber(value);
    if (opacity === null) opacity = LIMITS.MAX_OPACITY;
    return clamp(opacity, LIMITS.MIN_OPACITY, LIMITS.MAX_OPACITY);
  }

  function clampCoord(value, maxBoardSize) {
    var coord = toFiniteNumber(value);
    if (coord === null) coord = 0;
    return roundToDecimals(
      clamp(coord, 0, resolveMaxBoardSize(maxBoardSize)),
      LIMITS.COORDINATE_DECIMALS,
    );
  }

  function normalizeColor(value) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
      ? value
      : null;
  }

  function truncateText(value, maxLength) {
    if (value === undefined || value === null) value = "";
    return String(value).slice(0, maxLength || LIMITS.MAX_TEXT_LENGTH);
  }

  function normalizeId(value, maxLength) {
    return typeof value === "string" &&
      value.length > 0 &&
      value.length <= (maxLength || LIMITS.MAX_ID_LENGTH) &&
      !/[\u0000-\u001f\u007f\s]/.test(value)
      ? value
      : null;
  }

  function normalizeFiniteNumber(value) {
    return toFiniteNumber(value);
  }

  function isFiniteTransformNumber(value) {
    return toFiniteNumber(value) !== null;
  }

  return {
    LIMITS: LIMITS,
    clampOpacity: clampOpacity,
    clampCoord: clampCoord,
    clampSize: clampSize,
    isFiniteTransformNumber: isFiniteTransformNumber,
    normalizeColor: normalizeColor,
    normalizeFiniteNumber: normalizeFiniteNumber,
    normalizeId: normalizeId,
    resolveMaxBoardSize: resolveMaxBoardSize,
    truncateText: truncateText,
  };
});
