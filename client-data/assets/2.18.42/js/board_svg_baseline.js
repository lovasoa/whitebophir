/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
}

/**
 * @param {unknown} pathname
 * @param {unknown} search
 * @returns {string}
 */
export function buildBoardSvgBaselineUrl(pathname, search) {
  const normalizedPath = typeof pathname === "string" ? pathname : "";
  const normalizedSearch = typeof search === "string" ? search : "";
  return `${normalizedPath}.svg${normalizedSearch}`;
}

/**
 * @typedef {{
 *   documentElement?: {
 *     getAttribute?: (name: string) => string | null | undefined,
 *     querySelector?: (selector: string) => { innerHTML?: string } | null | undefined,
 *   } | null,
 *   querySelector?: (selector: string) => { innerHTML?: string } | null | undefined,
 * }} BaselineSvgDocument
 */

/**
 * @param {BaselineSvgDocument} doc
 * @returns {import("../../types/app-runtime").AuthoritativeBaseline}
 */
function parseServedBaselineSvgDocument(doc) {
  const root = doc?.documentElement;
  if (!root || typeof root.getAttribute !== "function") {
    throw new Error("Missing SVG root");
  }
  const drawingArea =
    typeof root.querySelector === "function"
      ? root.querySelector("#drawingArea")
      : typeof doc?.querySelector === "function"
        ? doc.querySelector("#drawingArea")
        : null;
  if (!drawingArea) {
    throw new Error("Missing drawing area");
  }
  const metadata = {
    seq: normalizeSeq(root.getAttribute("data-wbo-seq")),
    readonly: root.getAttribute("data-wbo-readonly") === "true",
  };
  if (typeof SVGElement !== "undefined" && drawingArea instanceof SVGElement) {
    return { ...metadata, drawingArea };
  }
  return {
    ...metadata,
    drawingAreaMarkup:
      typeof drawingArea.innerHTML === "string" ? drawingArea.innerHTML : "",
  };
}

/**
 * @param {string} svgMarkup
 * @param {{parseFromString(svg: string, mimeType: string): BaselineSvgDocument}} domParser
 * @returns {import("../../types/app-runtime").AuthoritativeBaseline}
 */
export function parseServedBaselineSvgText(svgMarkup, domParser) {
  const doc = domParser.parseFromString(svgMarkup, "image/svg+xml");
  return parseServedBaselineSvgDocument(doc);
}
