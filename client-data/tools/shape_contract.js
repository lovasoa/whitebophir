/**
 * @typedef {{attributes?: {[name: string]: string}, rawAttributes?: string, id?: string, content?: string}} StoredSvgEntry
 * @typedef {{a: number, b: number, c: number, d: number, e: number, f: number}} SvgTransform
 * @typedef {{minX: number, minY: number, maxX: number, maxY: number}} LocalBounds
 * @typedef {{id: string, tool: string, paintOrder?: number, data: object, localBounds: LocalBounds}} StoredShapeSummary
 * @typedef {{id?: string, color?: string, size?: number, opacity?: number, transform?: SvgTransform, x?: number, y?: number, x2?: number, y2?: number}} StoredShapeItem
 * @typedef {{escapeHtml: (value: string) => string, numberOrZero: (value: unknown) => number, renderTransformAttribute: (transform: SvgTransform | undefined) => string}} StoredShapeSerializeHelpers
 * @typedef {{toolId: string, storedTagName?: string, shapeTool?: boolean, updatableFields?: string[], drawsOnBoard?: boolean, payloadKind?: "inline" | "text" | "children", liveMessageFields?: {[type: number]: {[field: string]: string}}, storedFields?: {[field: string]: string}, normalizeStoredItemData?: (item: any, raw: any, helpers: any) => void, summarizeStoredSvgItem: (entry: StoredSvgEntry, paintOrder: number | undefined, helpers: any) => any, serializeStoredSvgItem: (item: any, helpers: any) => string, parseStoredSvgItem?: (summary: any, entry: StoredSvgEntry, helpers: any) => any, renderBoardSvg?: (shape: any, helpers: any) => string}} ToolContract
 */

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function normalizeRectBounds(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * @param {StoredShapeSummary} shape
 * @param {number | undefined} opacity
 * @param {SvgTransform | undefined} transform
 * @param {(data: object, opacity: number | undefined, transform: SvgTransform | undefined) => object} decorateStoredItemData
 * @returns {any}
 */
export function summarizeStoredShape(
  shape,
  opacity,
  transform,
  decorateStoredItemData,
) {
  return {
    id: shape.id,
    tool: shape.tool,
    paintOrder: shape.paintOrder,
    data: decorateStoredItemData(shape.data, opacity, transform),
    localBounds: shape.localBounds,
  };
}

/**
 * @param {"rect" | "ellipse" | "line"} tagName
 * @param {string} attrs
 * @param {StoredShapeItem} item
 * @param {StoredShapeSerializeHelpers} helpers
 * @returns {string}
 */
export function serializeStoredShapeTag(tagName, attrs, item, helpers) {
  const transform = helpers.renderTransformAttribute(item.transform);
  const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
  const color = helpers.escapeHtml(item.color || "#000000");
  const size = helpers.numberOrZero(item.size) | 0;
  const opacity =
    typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
  return (
    `<${tagName} id="${id}"${attrs}` +
    ` stroke="${color}" stroke-width="${size}" fill="none"` +
    `${opacity}${transform}></${tagName}>`
  );
}

/**
 * @param {ToolContract & {storedTagName: string}} contract
 * @returns {ToolContract & {storedTagName: string, shapeTool: true}}
 */
export function defineShapeContract(contract) {
  return {
    ...contract,
    shapeTool: true,
  };
}
