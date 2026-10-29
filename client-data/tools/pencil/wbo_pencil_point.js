/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
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

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function dist(x1, y1, x2, y2) {
  //Returns the distance between (x1,y1) and (x2,y2)
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundPathValue(value) {
  return Math.round(value);
}

/**
 * @param {string} type
 * @param {number[]} values
 * @returns {{type: string, values: number[]}}
 */
function createPathDataPoint(type, values) {
  return { type, values: values.map(roundPathValue) };
}

/**
 * Given the existing points in a path, add a new point to get a smoothly interpolated path
 * @param {{type: string, values: number[]}[]} pts
 * @param {number} x
 * @param {number} y
 */
export function wboPencilPoint(pts, x, y) {
  // pts represents the points that are already in the line as a PathData
  const nbr = pts.length; //The number of points already in the line
  let npoint;
  switch (nbr) {
    case 0: //The first point in the line
      //If there is no point, we have to start the line with a moveTo statement
      pts.push(createPathDataPoint("M", [x, y]));
      //Temporary first point so that clicks are shown and can be erased
      npoint = createPathDataPoint("L", [x, y]);
      break;
    case 1: //This should never happen
      // First point will be the move. Add Line of zero length ensure there are two points and fall through
      if (!pts[0]) return pts;
      pts.push(
        createPathDataPoint("L", [
          pts[0].values[0] || 0,
          pts[0].values[1] || 0,
        ]),
      );
      npoint = createPathDataPoint("C", [
        pts[0].values[0] || 0,
        pts[0].values[1] || 0,
        x,
        y,
        x,
        y,
      ]);
      break;
    case 2: //There are two points. The initial move and a line of zero length to make it visible
      //Draw a curve that is segment between the old point and the new one
      if (!pts[0]) return pts;
      npoint = createPathDataPoint("C", [
        pts[0].values[0] || 0,
        pts[0].values[1] || 0,
        x,
        y,
        x,
        y,
      ]);
      break;
    default: //There are at least two points in the line
      npoint = pencilExtrapolatePoints(pts, x, y);
  }
  if (npoint) pts.push(npoint);
  return pts;
}

/**
 * @param {{type: string, values: number[]}[]} pts
 * @param {number} x
 * @param {number} y
 * @returns {{type: string, values: number[]} | undefined}
 */
function pencilExtrapolatePoints(pts, x, y) {
  //We add the new point, and smoothen the line
  const ANGULARITY = 3; //The lower this number, the smoother the line
  const prevPoint = pts[pts.length - 1];
  const antePoint = pts[pts.length - 2];
  if (!prevPoint || !antePoint) return;
  const prevValues = prevPoint.values; // Previous point
  const anteValues = antePoint.values; // Point before the previous one
  const prevX = prevValues[prevValues.length - 2];
  const prevY = prevValues[prevValues.length - 1];
  const anteX = anteValues[anteValues.length - 2];
  const anteY = anteValues[anteValues.length - 1];
  if (
    prevX === undefined ||
    prevY === undefined ||
    anteX === undefined ||
    anteY === undefined
  )
    return;

  //We don't want to add the same point twice consecutively
  if ((prevX === x && prevY === y) || (anteX === x && anteY === y)) return;

  let vectx = x - anteX;
  let vecty = y - anteY;
  const norm = Math.hypot(vectx, vecty);
  const dist1 = dist(anteX, anteY, prevX, prevY) / norm;
  const dist2 = dist(x, y, prevX, prevY) / norm;
  vectx /= ANGULARITY;
  vecty /= ANGULARITY;
  //Create 2 control points around the last point
  const cx1 = prevX - dist1 * vectx;
  const cy1 = prevY - dist1 * vecty; //First control point
  const cx2 = prevX + dist2 * vectx;
  const cy2 = prevY + dist2 * vecty; //Second control point
  prevValues[2] = roundPathValue(cx1);
  prevValues[3] = roundPathValue(cy1);

  return createPathDataPoint("C", [cx2, cy2, x, y, x, y]);
}
