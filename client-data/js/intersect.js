/**
 *                        INTERSEC
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2021  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

/** @typedef {[number, number]} Point2D */
/** @typedef {{a: number, b: number, c: number, d: number, e: number, f: number}} MatrixState */
/** @typedef {{r: Point2D, a: Point2D, b: Point2D}} TransformedBBox */

/**
 * @param {SVGGraphicsElement | SVGSVGElement} elem
 * @returns {MatrixState}
 */
function getTransformMatrix(elem) {
  const svg = window.WBOApp?.svg;
  if (!svg) {
    throw new Error("Missing SVG canvas.");
  }
  /** @type {SVGTransform | null} */
  let transform = null;
  for (let i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
    const baseVal = elem.transform.baseVal[i];
    if (!baseVal) {
      continue;
    }
    // quick tests showed that even if one changes only the fields e and f or uses createSVGTransformFromMatrix
    // the brower may add a SVG_TRANSFORM_MATRIX instead of a SVG_TRANSFORM_TRANSLATE
    if (baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
      transform = baseVal;
      break;
    }
  }
  if (transform === null) {
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
 * @param {Point2D} point
 * @param {TransformedBBox} box
 * @returns {boolean}
 */
export function pointInTransformedBBox([x, y], { r, a, b }) {
  /** @type {Point2D} */
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
  /** @type {Point2D[]} */
  const corners = [
    bbox_b.r,
    [bbox_b.r[0] + bbox_b.a[0], bbox_b.r[1] + bbox_b.a[1]],
    [bbox_b.r[0] + bbox_b.b[0], bbox_b.r[1] + bbox_b.b[1]],
    [
      bbox_b.r[0] + bbox_b.a[0] + bbox_b.b[0],
      bbox_b.r[1] + bbox_b.a[1] + bbox_b.b[1],
    ],
  ];
  return corners.every((corner) => pointInTransformedBBox(corner, bbox_a));
}

if (
  !SVGGraphicsElement.prototype.transformedBBox ||
  !SVGGraphicsElement.prototype.transformedBBoxContains
) {
  /**
   * @param {number} [scale]
   * @returns {TransformedBBox}
   */
  SVGGraphicsElement.prototype.transformedBBox = function (scale = 1) {
    const bbox = this.getBBox();
    const matrix = getTransformMatrix(this);
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
  };

  /** @param {number} [scale] @returns {TransformedBBox} */
  SVGSVGElement.prototype.transformedBBox = function (scale = 1) {
    const bbox = {
      x: this.x.baseVal.value,
      y: this.y.baseVal.value,
      width: this.width.baseVal.value,
      height: this.height.baseVal.value,
    };
    const matrix = getTransformMatrix(this);
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
  };

  /** @param {number} x
   * @param {number} y
   * @returns {boolean} */
  SVGGraphicsElement.prototype.transformedBBoxContains = function (x, y) {
    return pointInTransformedBBox([x, y], this.transformedBBox());
  };

  /** @param {TransformedBBox} bbox */
  SVGGraphicsElement.prototype.transformedBBoxIntersects = function (bbox) {
    return transformedBBoxIntersects(this.transformedBBox(), bbox);
  };
}
