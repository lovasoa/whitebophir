/** @typedef {{type: string, values: number[]}} PencilPathSegment */

/**
 * Pencil stores M/l polylines and renders M/L/C curves. Decode only that
 * vocabulary when an existing stroke receives another point. Completed board
 * paths keep their geometry in SVG instead of retaining a second point array.
 * @param {string} d
 * @returns {PencilPathSegment[]}
 */
export function readPencilPath(d) {
  const tokens =
    d.match(/[MLCmlc]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[^\s,]/g) || [];
  /** @type {PencilPathSegment[]} */
  const segments = [];
  let command = "";
  let needsValues = false;
  /** @type {number[]} */
  let values = [];
  for (const token of tokens) {
    if (
      token === "M" ||
      token === "m" ||
      token === "L" ||
      token === "l" ||
      token === "C" ||
      token === "c"
    ) {
      if (values.length || needsValues) return [];
      command = token;
      needsValues = true;
      if (!segments.length && command.toUpperCase() !== "M") return [];
      continue;
    }
    if (!command) return [];
    const value = Number(token);
    if (!Number.isFinite(value)) return [];
    values.push(value);
    if (values.length === (command.toUpperCase() === "C" ? 6 : 2)) {
      segments.push({ type: command, values });
      needsValues = false;
      values = [];
      if (command === "M") command = "L";
      else if (command === "m") command = "l";
    }
  }
  return values.length || needsValues ? [] : segments;
}

/**
 * SVG's d attribute is the rendering API. Avoid depending on the experimental
 * getPathData/setPathData APIs or patching browser element prototypes.
 * @param {SVGPathElement} path
 * @param {PencilPathSegment[]} segments
 */
export function writePencilPath(path, segments) {
  if (!segments.length) {
    path.removeAttribute("d");
    return;
  }
  let d = "";
  for (const segment of segments) {
    if (d) d += " ";
    d += `${segment.type} ${segment.values.join(" ")}`;
  }
  path.setAttribute("d", d);
}
