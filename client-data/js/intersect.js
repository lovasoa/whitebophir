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
/** @typedef {{r: Point2D, a: Point2D, b: Point2D}} TransformedBBox */

/**
 * Measures one selected SVG element, without changing its transform or layout.
 * @param {SVGGraphicsElement} element
 * @returns {TransformedBBox}
 */
export function transformedBBox(element) {
  const bbox =
    element instanceof SVGSVGElement
      ? {
          x: element.x.baseVal.value,
          y: element.y.baseVal.value,
          width: element.width.baseVal.value,
          height: element.height.baseVal.value,
        }
      : element.getBBox();
  let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  for (let i = 0; i < element.transform.baseVal.numberOfItems; i++) {
    const transform = element.transform.baseVal[i];
    if (transform?.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
      matrix = transform.matrix;
      break;
    }
  }
  return {
    r: [
      matrix.a * bbox.x + matrix.c * bbox.y + matrix.e,
      matrix.b * bbox.x + matrix.d * bbox.y + matrix.f,
    ],
    a: [matrix.a * bbox.width, matrix.b * bbox.width],
    b: [matrix.c * bbox.height, matrix.d * bbox.height],
  };
}

/**
 * @param {Point2D} point
 * @param {TransformedBBox} box
 * @returns {boolean}
 */
export function pointInTransformedBBox([x, y], { r, a, b }) {
  const dx = x - r[0];
  const dy = y - r[1];
  const determinant = a[0] * b[1] - a[1] * b[0];
  const c1 = (dx * b[1] - dy * b[0]) / determinant;
  const c2 = (dy * a[0] - dx * a[1]) / determinant;
  return c1 >= 0 && c1 <= 1 && c2 >= 0 && c2 <= 1;
}
