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
    MIN_DRAW_ZOOM: 0.4,
    GIANT_SHAPE_VIEWPORT_WIDTH: 1280,
    GIANT_SHAPE_VIEWPORT_HEIGHT: 720,
    DEFAULT_MAX_BOARD_SIZE: 65536,
    MAX_TEXT_LENGTH: 280,
    COORDINATE_DECIMALS: 1,
    DEFAULT_MAX_CHILDREN: 192,
    MAX_ID_LENGTH: 128,
  };
  var DRAW_TOOL_NAMES = [
    "Pencil",
    "Straight line",
    "Rectangle",
    "Ellipse",
    "Text",
  ];

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

  function requiresTurnstile(boardName, toolName) {
    if (boardName !== "anonymous") return false;
    if (!toolName || toolName === "Cursor") return false;
    return true;
  }

  function isDrawTool(toolName) {
    return DRAW_TOOL_NAMES.indexOf(toolName) !== -1;
  }

  function isDrawToolAllowedAtScale(scale) {
    var numericScale = toFiniteNumber(scale);
    return numericScale !== null && numericScale > LIMITS.MIN_DRAW_ZOOM;
  }

  function getMaxShapeSpan() {
    return LIMITS.GIANT_SHAPE_VIEWPORT_WIDTH / LIMITS.MIN_DRAW_ZOOM;
  }

  function cloneBounds(bounds) {
    if (!bounds) return null;
    return {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    };
  }

  function extendBoundsWithPoint(bounds, x, y) {
    var pointX = toFiniteNumber(x);
    var pointY = toFiniteNumber(y);
    if (pointX === null || pointY === null) return cloneBounds(bounds);
    if (!bounds) {
      return {
        minX: pointX,
        minY: pointY,
        maxX: pointX,
        maxY: pointY,
      };
    }
    return {
      minX: Math.min(bounds.minX, pointX),
      minY: Math.min(bounds.minY, pointY),
      maxX: Math.max(bounds.maxX, pointX),
      maxY: Math.max(bounds.maxY, pointY),
    };
  }

  function getPencilBounds(item) {
    if (!item || !Array.isArray(item._children) || item._children.length === 0)
      return null;
    return item._children.reduce(function extend(bounds, child) {
      if (!child) return bounds;
      return extendBoundsWithPoint(bounds, child.x, child.y);
    }, null);
  }

  function getStraightShapeBounds(item) {
    if (!item) return null;
    var x1 = toFiniteNumber(item.x);
    var y1 = toFiniteNumber(item.y);
    var x2 = toFiniteNumber(item.x2);
    var y2 = toFiniteNumber(item.y2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return {
      minX: Math.min(x1, x2),
      minY: Math.min(y1, y2),
      maxX: Math.max(x1, x2),
      maxY: Math.max(y1, y2),
    };
  }

  function getTextBounds(item) {
    if (!item) return null;
    var x = toFiniteNumber(item.x);
    var y = toFiniteNumber(item.y);
    var size = toFiniteNumber(item.size);
    var len = toFiniteNumber(item.txt && item.txt.length);
    if (x === null || y === null || size === null || len === null) return null;
    return {
      minX: x,
      minY: y - size,
      maxX: x + size * len,
      maxY: y,
    };
  }

  function getLocalGeometryBounds(item) {
    if (!item || typeof item.tool !== "string") return null;
    switch (item.tool) {
      case "Pencil":
        return getPencilBounds(item);
      case "Straight line":
      case "Rectangle":
      case "Ellipse":
        return getStraightShapeBounds(item);
      case "Text":
        return getTextBounds(item);
      default:
        return null;
    }
  }

  function applyTransformToPoint(point, transform) {
    var a = toFiniteNumber(transform && transform.a);
    var b = toFiniteNumber(transform && transform.b);
    var c = toFiniteNumber(transform && transform.c);
    var d = toFiniteNumber(transform && transform.d);
    var e = toFiniteNumber(transform && transform.e);
    var f = toFiniteNumber(transform && transform.f);
    if (
      a === null ||
      b === null ||
      c === null ||
      d === null ||
      e === null ||
      f === null
    ) {
      return null;
    }
    return {
      x: a * point.x + c * point.y + e,
      y: b * point.x + d * point.y + f,
    };
  }

  function applyTransformToBounds(bounds, transform) {
    if (!bounds) return null;
    if (!transform) return cloneBounds(bounds);

    var isTranslationOnly =
      transform.a === 1 &&
      transform.b === 0 &&
      transform.c === 0 &&
      transform.d === 1;
    if (isTranslationOnly) {
      var translateX = toFiniteNumber(transform.e);
      var translateY = toFiniteNumber(transform.f);
      if (translateX === null || translateY === null) return null;
      return {
        minX: bounds.minX + translateX,
        minY: bounds.minY + translateY,
        maxX: bounds.maxX + translateX,
        maxY: bounds.maxY + translateY,
      };
    }

    var points = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.maxY },
    ];
    var transformed = null;
    for (var i = 0; i < points.length; i++) {
      var point = applyTransformToPoint(points[i], transform);
      if (point === null) return null;
      transformed = extendBoundsWithPoint(transformed, point.x, point.y);
    }
    return transformed;
  }

  function getEffectiveGeometryBounds(item) {
    if (!item) return null;
    return applyTransformToBounds(getLocalGeometryBounds(item), item.transform);
  }

  function getBoundsWidth(bounds) {
    return bounds ? bounds.maxX - bounds.minX : 0;
  }

  function getBoundsHeight(bounds) {
    return bounds ? bounds.maxY - bounds.minY : 0;
  }

  function isBoundsTooLarge(bounds) {
    if (!bounds) return false;
    var maxShapeSpan = getMaxShapeSpan();
    return (
      getBoundsWidth(bounds) > maxShapeSpan ||
      getBoundsHeight(bounds) > maxShapeSpan
    );
  }

  function isGeometryTooLarge(item) {
    return isBoundsTooLarge(getEffectiveGeometryBounds(item));
  }

  return {
    DRAW_TOOL_NAMES: DRAW_TOOL_NAMES,
    LIMITS: LIMITS,
    applyTransformToBounds: applyTransformToBounds,
    clampOpacity: clampOpacity,
    clampCoord: clampCoord,
    clampSize: clampSize,
    extendBoundsWithPoint: extendBoundsWithPoint,
    getEffectiveGeometryBounds: getEffectiveGeometryBounds,
    getLocalGeometryBounds: getLocalGeometryBounds,
    getMaxShapeSpan: getMaxShapeSpan,
    getPencilBounds: getPencilBounds,
    isFiniteTransformNumber: isFiniteTransformNumber,
    isBoundsTooLarge: isBoundsTooLarge,
    isDrawTool: isDrawTool,
    isDrawToolAllowedAtScale: isDrawToolAllowedAtScale,
    isGeometryTooLarge: isGeometryTooLarge,
    normalizeColor: normalizeColor,
    normalizeFiniteNumber: normalizeFiniteNumber,
    normalizeId: normalizeId,
    resolveMaxBoardSize: resolveMaxBoardSize,
    truncateText: truncateText,
    requiresTurnstile: requiresTurnstile,
  };
});
