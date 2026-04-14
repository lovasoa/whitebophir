((root, factory) => {
  /**
   * @typedef {{
   *   DRAW_TOOL_NAMES: string[],
   *   LIMITS: Record<string, number>,
   *   applyTransformToBounds: Function,
   *   clampOpacity: Function,
   *   clampCoord: Function,
   *   clampSize: Function,
   *   extendBoundsWithPoint: Function,
   *   getEffectiveGeometryBounds: Function,
   *   getLocalGeometryBounds: Function,
   *   getMaxShapeSpan: Function,
   *   getPencilBounds: Function,
   *   isFiniteTransformNumber: Function,
   *   isBoundsTooLarge: Function,
   *   isDrawTool: Function,
   *   isDrawToolAllowedAtScale: Function,
   *   isGeometryTooLarge: Function,
   *   normalizeColor: Function,
   *   normalizeFiniteNumber: Function,
   *   normalizeId: Function,
   *   resolveMaxBoardSize: Function,
   *   truncateText: Function,
   *   requiresTurnstile: Function,
   * }} MessageCommonApi
   */
  /** @type {MessageCommonApi} */
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  /** @type {any} */ (root).WBOMessageCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  /**
   * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds
   * @typedef {{ x: number, y: number }} Point
   * @typedef {{ a: number, b: number, c: number, d: number, e: number, f: number }} Transform
   * @typedef {{ x?: unknown, y?: unknown }} ChildPoint
   * @typedef {{
   *   tool?: unknown,
   *   x?: unknown,
   *   y?: unknown,
   *   x2?: unknown,
   *   y2?: unknown,
   *   size?: unknown,
   *   txt?: string | null | undefined,
   *   transform?: Transform | null | undefined,
   *   _children?: Array<ChildPoint | null | undefined>
   * }} GeometryItem
   */

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
  /** @typedef {{resolveSharedModule: (requirePath: string, globalName: string, scope?: any) => any}} SharedModuleResolverApi */
  /** @typedef {{DRAW_TOOL_NAMES: string[], isShapeTool: (toolName?: string | undefined) => boolean}} MessageToolMetadataApi */
  /** @type {any} */
  var globalScope =
    typeof globalThis !== "undefined" ? globalThis : /** @type {any} */ ({});
  /** @type {SharedModuleResolverApi | null} */
  var SharedModuleResolver = /** @type {SharedModuleResolverApi | null} */ (
    typeof module === "object" &&
    module.exports &&
    typeof require === "function"
      ? require("./shared_module_resolver.js")
      : globalScope.WBOSharedModuleResolver
  );
  /** @type {MessageToolMetadataApi | null} */
  var MessageToolMetadata =
    SharedModuleResolver &&
    typeof SharedModuleResolver.resolveSharedModule === "function"
      ? /** @type {MessageToolMetadataApi | null} */ (
          SharedModuleResolver.resolveSharedModule(
            "./message_tool_metadata.js",
            "WBOMessageToolMetadata",
            globalScope,
          )
        )
      : null;
  var isShapeTool =
    MessageToolMetadata && typeof MessageToolMetadata.isShapeTool === "function"
      ? MessageToolMetadata.isShapeTool
      : () => false;
  var DRAW_TOOL_NAMES = MessageToolMetadata?.DRAW_TOOL_NAMES
    ? MessageToolMetadata.DRAW_TOOL_NAMES
    : ["Pencil", "Straight line", "Rectangle", "Ellipse", "Text"];

  /**
   * @param {unknown} value
   * @returns {number | null}
   */
  function toFiniteNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  /**
   * @param {number} number
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function clamp(number, min, max) {
    return Math.min(Math.max(number, min), max);
  }

  /**
   * @param {number} number
   * @param {number} decimals
   * @returns {number}
   */
  function roundToDecimals(number, decimals) {
    var factor = 10 ** decimals;
    return Math.round(number * factor) / factor;
  }

  /**
   * @param {unknown} maxBoardSize
   * @returns {number}
   */
  function resolveMaxBoardSize(maxBoardSize) {
    var resolved = toFiniteNumber(maxBoardSize);
    return resolved === null ? LIMITS.DEFAULT_MAX_BOARD_SIZE : resolved;
  }

  /**
   * @param {unknown} value
   * @returns {number}
   */
  function clampSize(value) {
    var size = parseInt(String(value), 10);
    if (!Number.isFinite(size)) size = LIMITS.MIN_SIZE;
    return clamp(size, LIMITS.MIN_SIZE, LIMITS.MAX_SIZE);
  }

  /**
   * @param {unknown} value
   * @returns {number}
   */
  function clampOpacity(value) {
    var opacity = toFiniteNumber(value);
    if (opacity === null) opacity = LIMITS.MAX_OPACITY;
    return clamp(opacity, LIMITS.MIN_OPACITY, LIMITS.MAX_OPACITY);
  }

  /**
   * @param {unknown} value
   * @param {unknown} maxBoardSize
   * @returns {number}
   */
  function clampCoord(value, maxBoardSize) {
    var coord = toFiniteNumber(value);
    if (coord === null) coord = 0;
    return roundToDecimals(
      clamp(coord, 0, resolveMaxBoardSize(maxBoardSize)),
      LIMITS.COORDINATE_DECIMALS,
    );
  }

  /**
   * @param {unknown} value
   * @returns {string | null}
   */
  function normalizeColor(value) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
      ? value
      : null;
  }

  /**
   * @param {unknown} value
   * @param {number} [maxLength]
   * @returns {string}
   */
  function truncateText(value, maxLength) {
    if (value === undefined || value === null) value = "";
    return String(value).slice(0, maxLength || LIMITS.MAX_TEXT_LENGTH);
  }

  /**
   * @param {unknown} value
   * @param {number} [maxLength]
   * @returns {string | null}
   */
  function normalizeId(value, maxLength) {
    if (typeof value !== "string") {
      return null;
    }
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

  /**
   * @param {unknown} value
   * @returns {number | null}
   */
  function normalizeFiniteNumber(value) {
    return toFiniteNumber(value);
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  function isFiniteTransformNumber(value) {
    return toFiniteNumber(value) !== null;
  }

  /**
   * @param {unknown} boardName
   * @param {unknown} toolName
   * @returns {boolean}
   */
  function requiresTurnstile(boardName, toolName) {
    if (boardName !== "anonymous") return false;
    if (!toolName || toolName === "Cursor") return false;
    return true;
  }

  /**
   * @param {unknown} toolName
   * @returns {boolean}
   */
  function isDrawTool(toolName) {
    return (
      typeof toolName === "string" && DRAW_TOOL_NAMES.indexOf(toolName) !== -1
    );
  }

  /**
   * @param {unknown} scale
   * @returns {boolean}
   */
  function isDrawToolAllowedAtScale(scale) {
    var numericScale = toFiniteNumber(scale);
    return numericScale !== null && numericScale > LIMITS.MIN_DRAW_ZOOM;
  }

  function getMaxShapeSpan() {
    return LIMITS.GIANT_SHAPE_VIEWPORT_WIDTH / LIMITS.MIN_DRAW_ZOOM;
  }

  /**
   * @param {Bounds | null | undefined} bounds
   * @returns {Bounds | null}
   */
  function cloneBounds(bounds) {
    if (!bounds) return null;
    return {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    };
  }

  /**
   * @param {Bounds | null | undefined} bounds
   * @param {unknown} x
   * @param {unknown} y
   * @returns {Bounds | null}
   */
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

  /**
   * @param {GeometryItem | null | undefined} item
   * @returns {Bounds | null}
   */
  function getPencilBounds(item) {
    if (!item || !Array.isArray(item._children) || item._children.length === 0)
      return null;
    return item._children.reduce(function extend(
      /** @type {Bounds | null} */ bounds,
      /** @type {ChildPoint | null | undefined} */ child,
    ) {
      if (!child) return bounds;
      return extendBoundsWithPoint(bounds, child.x, child.y);
    }, null);
  }

  /**
   * @param {GeometryItem | null | undefined} item
   * @returns {Bounds | null}
   */
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

  /**
   * @param {GeometryItem | null | undefined} item
   * @returns {Bounds | null}
   */
  function getTextBounds(item) {
    if (!item) return null;
    var x = toFiniteNumber(item.x);
    var y = toFiniteNumber(item.y);
    var size = toFiniteNumber(item.size);
    var len = toFiniteNumber(item.txt?.length);
    if (x === null || y === null || size === null || len === null) return null;
    return {
      minX: x,
      minY: y - size,
      maxX: x + size * len,
      maxY: y,
    };
  }

  /**
   * @param {GeometryItem | null | undefined} item
   * @returns {Bounds | null}
   */
  function getLocalGeometryBounds(item) {
    if (!item || typeof item.tool !== "string") return null;
    switch (item.tool) {
      case "Pencil":
        return getPencilBounds(item);
      default:
        if (isShapeTool(item.tool)) {
          return getStraightShapeBounds(item);
        }
    }
    switch (item.tool) {
      case "Text":
        return getTextBounds(item);
      default:
        return null;
    }
  }

  /**
   * @param {GeometryItem | null | undefined} item
   * @returns {boolean}
   */
  function isGeometryTooLarge(item) {
    return isBoundsTooLarge(getEffectiveGeometryBounds(item));
  }
  /**
   * @param {Point} point
   * @param {Transform | null | undefined} transform
   * @returns {Point | null}
   */
  function applyTransformToPoint(point, transform) {
    var a = toFiniteNumber(transform?.a);
    var b = toFiniteNumber(transform?.b);
    var c = toFiniteNumber(transform?.c);
    var d = toFiniteNumber(transform?.d);
    var e = toFiniteNumber(transform?.e);
    var f = toFiniteNumber(transform?.f);
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

  /**
   * @param {Bounds | null | undefined} bounds
   * @param {Transform | null | undefined} transform
   * @returns {Bounds | null}
   */
  function applyTransformToBounds(bounds, transform) {
    if (!bounds) return null;
    if (!transform) return cloneBounds(bounds);

    var isTranslationOnly =
      transform.a === 1 &&
      transform.b === 0 &&
      transform.c === 0 &&
      transform.d === 1;
    if (isTranslationOnly) {
      const translateX = toFiniteNumber(transform.e);
      const translateY = toFiniteNumber(transform.f);
      if (translateX === null || translateY === null) return null;
      return {
        minX: bounds.minX + translateX,
        minY: bounds.minY + translateY,
        maxX: bounds.maxX + translateX,
        maxY: bounds.maxY + translateY,
      };
    }

    /** @type {Point[]} */
    var points = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.maxY },
    ];
    var transformed = null;
    for (let i = 0; i < points.length; i++) {
      const sourcePoint = points[i];
      if (!sourcePoint) return null;
      const point = applyTransformToPoint(sourcePoint, transform);
      if (point === null) return null;
      transformed = extendBoundsWithPoint(transformed, point.x, point.y);
    }
    return transformed;
  }

  /**
   * @param {GeometryItem | null | undefined} item
   * @returns {Bounds | null}
   */
  function getEffectiveGeometryBounds(item) {
    if (!item) return null;
    return applyTransformToBounds(getLocalGeometryBounds(item), item.transform);
  }

  /**
   * @param {Bounds | null | undefined} bounds
   * @returns {number}
   */
  function getBoundsWidth(bounds) {
    return bounds ? bounds.maxX - bounds.minX : 0;
  }

  /**
   * @param {Bounds | null | undefined} bounds
   * @returns {number}
   */
  function getBoundsHeight(bounds) {
    return bounds ? bounds.maxY - bounds.minY : 0;
  }

  /**
   * @param {Bounds | null | undefined} bounds
   * @returns {boolean}
   */
  function isBoundsTooLarge(bounds) {
    if (!bounds) return false;
    var maxShapeSpan = getMaxShapeSpan();
    return (
      getBoundsWidth(bounds) > maxShapeSpan ||
      getBoundsHeight(bounds) > maxShapeSpan
    );
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
