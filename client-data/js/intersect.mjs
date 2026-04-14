/**
 * SVG Intersection and BBox utilities.
 */

/**
 * @typedef {[number, number]} Point2D
 * @typedef {{a: number, b: number, c: number, d: number, e: number, f: number}} MatrixState
 * @typedef {{r: Point2D, a: Point2D, b: Point2D}} TransformedBBox
 */

/**
 * @param {SVGGraphicsElement | SVGSVGElement} elem
 * @returns {MatrixState}
 */
export function getTransformMatrix(elem) {
  let transform = null;
  for (let i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
    const baseVal = elem.transform.baseVal[i];
    if (baseVal && baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
      transform = baseVal;
      break;
    }
  }
  if (transform == null) {
    const svg = elem.ownerSVGElement || elem;
    transform = elem.transform.baseVal.createSVGTransformFromMatrix(
      svg.createSVGMatrix(),
    );
    elem.transform.baseVal.appendItem(transform);
  }
  const matrix = transform.matrix;
  return {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.e,
    f: matrix.f,
  };
}

/**
 * @param {MatrixState} m
 * @param {Point2D} t
 * @returns {Point2D}
 */
function transformRelative(m, t) {
  return [m.a * t[0] + m.c * t[1], m.b * t[0] + m.d * t[1]];
}

/**
 * @param {MatrixState} m
 * @param {Point2D} t
 * @returns {Point2D}
 */
function transformAbsolute(m, t) {
  return [m.a * t[0] + m.c * t[1] + m.e, m.b * t[0] + m.d * t[1] + m.f];
}

/**
 * @param {SVGGraphicsElement | SVGSVGElement} elem
 * @param {number} [scale]
 * @returns {TransformedBBox}
 */
export function getTransformedBBox(elem, scale = 1) {
  let bbox;
  if (elem instanceof SVGSVGElement) {
    bbox = {
      x: elem.x.baseVal.value,
      y: elem.y.baseVal.value,
      width: elem.width.baseVal.value,
      height: elem.height.baseVal.value,
    };
  } else {
    bbox = elem.getBBox();
  }

  const matrix = getTransformMatrix(elem);
  const scaledMatrix = {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.e / scale,
    f: matrix.f / scale,
  };
  return {
    r: transformAbsolute(scaledMatrix, [bbox.x / scale, bbox.y / scale]),
    a: transformRelative(scaledMatrix, [bbox.width / scale, 0]),
    b: transformRelative(scaledMatrix, [0, bbox.height / scale]),
  };
}

/**
 * @param {Point2D} point
 * @param {TransformedBBox} box
 * @returns {boolean}
 */
export function pointInTransformedBBox([x, y], { r, a, b }) {
  const d = [x - r[0], y - r[1]];
  const idet = a[0] * b[1] - a[1] * b[0];
  const c1 = (d[0] * b[1] - d[1] * b[0]) / idet;
  const c2 = (d[1] * a[0] - d[0] * a[1]) / idet;
  return c1 >= 0 && c1 <= 1 && c2 >= 0 && c2 <= 1;
}

/**
 * @param {TransformedBBox} bbox_a
 * @param {TransformedBBox} bbox_b
 * @returns {boolean}
 */
export function transformedBBoxIntersects(bbox_a, bbox_b) {
  const corners = [
    bbox_b.r,
    [bbox_b.r[0] + bbox_b.a[0], bbox_b.r[1] + bbox_b.a[1]],
    [bbox_b.r[0] + bbox_b.b[0], bbox_b.r[1] + bbox_b.b[1]],
    [
      bbox_b.r[0] + bbox_b.a[0] + bbox_b.b[0],
      bbox_b.r[1] + bbox_b.a[1] + bbox_b.b[1],
    ],
  ];
  return corners.some((corner) => pointInTransformedBBox(corner, bbox_a));
}

// Polyfill for convenience during migration if needed, but prefer explicit calls
if (
  typeof SVGGraphicsElement !== "undefined" &&
  !SVGGraphicsElement.prototype.transformedBBox
) {
  SVGGraphicsElement.prototype.transformedBBox = function (scale) {
    return getTransformedBBox(this, scale);
  };
  SVGGraphicsElement.prototype.transformedBBoxContains = function (x, y) {
    return pointInTransformedBBox([x, y], getTransformedBBox(this));
  };
  SVGGraphicsElement.prototype.transformedBBoxIntersects = function (bbox) {
    return transformedBBoxIntersects(getTransformedBBox(this), bbox);
  };
}
