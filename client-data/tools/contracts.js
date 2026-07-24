/**
 * DOM-free tool contracts: the single source of truth for protocol/storage
 * metadata that server hot paths (validation, persistence, canonical items)
 * import. Built from the manifest plus per-tool storage contracts that depend
 * only on other DOM-free helpers, so a browser/DOM import inside a tool module
 * can never reach server startup, validation, or persistence.
 */

import { getLocalGeometryBounds } from "../js/message_common.js";
import { TOOL_CODE_BY_ID, TOOL_ID_BY_CODE, TOOL_MANIFEST } from "./manifest.js";
import {
  renderPencilPath,
  scanPathSummary,
  serializeStoredPencilPath,
} from "./pencil/pencil_path.js";
import {
  defineShapeContract,
  normalizeRectBounds,
  serializeStoredShapeTag,
  summarizeStoredShape,
} from "./shape_contract.js";

/** @typedef {import("./shape_contract.js").ToolContract} ToolContract */

/** @type {ToolContract} */
const pencilContract = {
  toolId: "pencil",
  toolCode: TOOL_CODE_BY_ID.pencil,
  payloadKind: "children",
  storedTagName: "path",
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    const scanned = scanPathSummary(helpers.readStoredSvgAttribute(entry, "d"));
    if (size === undefined || scanned.childCount === 0) return null;
    return {
      id: helpers.id,
      tool: "pencil",
      data: helpers.decorateStoredItemData(
        {
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        helpers.opacity,
        helpers.transform,
      ),
      childCount: scanned.childCount,
      paintOrder,
      localBounds: scanned.localBounds,
    };
  },
  serializeStoredSvgItem(item, helpers) {
    const points = Array.isArray(item._children) ? item._children : [];
    const pathData = renderPencilPath(points);
    return serializeStoredPencilPath(item, pathData, helpers);
  },
  renderBoardSvg(pencil, helpers) {
    const pathstring = renderPencilPath(pencil._children || []);
    return helpers.renderPath(pencil, pathstring);
  },
};

const rectangleContract = defineShapeContract({
  toolId: "rectangle",
  toolCode: TOOL_CODE_BY_ID.rectangle,
  storedTagName: "rect",
  updatableFields: /** @type {const} */ (["x", "y", "x2", "y2"]),
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x"));
    const y = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y"));
    const width = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "width"),
    );
    const height = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "height"),
    );
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      size === undefined
    ) {
      return null;
    }
    return summarizeStoredShape(
      {
        id: helpers.id,
        tool: "rectangle",
        paintOrder,
        data: {
          x,
          y,
          x2: x + width,
          y2: y + height,
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        localBounds: {
          minX: x,
          minY: y,
          maxX: x + width,
          maxY: y + height,
        },
      },
      helpers.opacity,
      helpers.transform,
      helpers.decorateStoredItemData,
    );
  },
  serializeStoredSvgItem(item, helpers) {
    const bounds = normalizeRectBounds(
      helpers.numberOrZero(item.x),
      helpers.numberOrZero(item.y),
      helpers.numberOrZero(item.x2),
      helpers.numberOrZero(item.y2),
    );
    return serializeStoredShapeTag(
      "rect",
      ` x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"`,
      item,
      helpers,
    );
  },
  renderBoardSvg(shape, helpers) {
    const bounds = normalizeRectBounds(
      helpers.numberOrZero(shape.x),
      helpers.numberOrZero(shape.y),
      helpers.numberOrZero(shape.x2),
      helpers.numberOrZero(shape.y2),
    );
    return (
      "<rect " +
      (shape.id ? `id="${helpers.htmlspecialchars(shape.id)}" ` : "") +
      `x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" ` +
      `stroke="${helpers.htmlspecialchars(shape.color || "#000")}" stroke-width="${helpers.numberOrZero(shape.size) | 0}" ` +
      helpers.renderTranslate(shape) +
      "/>"
    );
  },
});

const ellipseContract = defineShapeContract({
  toolId: "ellipse",
  toolCode: TOOL_CODE_BY_ID.ellipse,
  storedTagName: "ellipse",
  updatableFields: /** @type {const} */ (["x", "y", "x2", "y2"]),
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const cx = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "cx"));
    const cy = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "cy"));
    const rx = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "rx"));
    const ry = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "ry"));
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    if (
      cx === undefined ||
      cy === undefined ||
      rx === undefined ||
      ry === undefined ||
      size === undefined
    ) {
      return null;
    }
    return summarizeStoredShape(
      {
        id: helpers.id,
        tool: "ellipse",
        paintOrder,
        data: {
          x: cx - rx,
          y: cy - ry,
          x2: cx + rx,
          y2: cy + ry,
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        localBounds: {
          minX: cx - rx,
          minY: cy - ry,
          maxX: cx + rx,
          maxY: cy + ry,
        },
      },
      helpers.opacity,
      helpers.transform,
      helpers.decorateStoredItemData,
    );
  },
  serializeStoredSvgItem(item, helpers) {
    const x = helpers.numberOrZero(item.x);
    const y = helpers.numberOrZero(item.y);
    const x2 = helpers.numberOrZero(item.x2);
    const y2 = helpers.numberOrZero(item.y2);
    return serializeStoredShapeTag(
      "ellipse",
      ` cx="${Math.round((x + x2) / 2)}" cy="${Math.round((y + y2) / 2)}" rx="${Math.abs(x2 - x) / 2}" ry="${Math.abs(y2 - y) / 2}"`,
      item,
      helpers,
    );
  },
  renderBoardSvg(shape, helpers) {
    const x = helpers.numberOrZero(shape.x);
    const y = helpers.numberOrZero(shape.y);
    const x2 = helpers.numberOrZero(shape.x2);
    const y2 = helpers.numberOrZero(shape.y2);
    const cx = Math.round((x2 + x) / 2);
    const cy = Math.round((y2 + y) / 2);
    const rx = Math.abs(x2 - x) / 2;
    const ry = Math.abs(y2 - y) / 2;
    return helpers.renderPath(
      shape,
      `M${cx - rx} ${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 ${rx * -2},0`,
    );
  },
});

const straightLineContract = defineShapeContract({
  toolId: "straight-line",
  toolCode: TOOL_CODE_BY_ID["straight-line"],
  storedTagName: "line",
  updatableFields: /** @type {const} */ (["x2", "y2"]),
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x1 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x1"));
    const y1 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y1"));
    const x2 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x2"));
    const y2 = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y2"));
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "stroke-width"),
    );
    if (
      x1 === undefined ||
      y1 === undefined ||
      x2 === undefined ||
      y2 === undefined ||
      size === undefined
    ) {
      return null;
    }
    return summarizeStoredShape(
      {
        id: helpers.id,
        tool: "straight-line",
        paintOrder,
        data: {
          x: x1,
          y: y1,
          x2,
          y2,
          color: helpers.readStoredSvgAttribute(entry, "stroke") || "#000000",
          size,
        },
        localBounds: {
          minX: Math.min(x1, x2),
          minY: Math.min(y1, y2),
          maxX: Math.max(x1, x2),
          maxY: Math.max(y1, y2),
        },
      },
      helpers.opacity,
      helpers.transform,
      helpers.decorateStoredItemData,
    );
  },
  serializeStoredSvgItem(item, helpers) {
    return serializeStoredShapeTag(
      "line",
      ` x1="${helpers.numberOrZero(item.x)}" y1="${helpers.numberOrZero(item.y)}"` +
        ` x2="${helpers.numberOrZero(item.x2)}" y2="${helpers.numberOrZero(item.y2)}"`,
      item,
      helpers,
    );
  },
  renderBoardSvg(shape, helpers) {
    return helpers.renderPath(
      shape,
      `M${shape.x} ${shape.y}L${shape.x2} ${shape.y2}`,
    );
  },
});

/** @type {ToolContract} */
const textContract = {
  toolId: "text",
  toolCode: TOOL_CODE_BY_ID.text,
  payloadKind: "text",
  storedTagName: "text",
  updatableFields: /** @type {const} */ (["txt"]),
  summarizeStoredSvgItem(entry, paintOrder, helpers) {
    const x = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "x"));
    const y = helpers.parseNumber(helpers.readStoredSvgAttribute(entry, "y"));
    const size = helpers.parseNumber(
      helpers.readStoredSvgAttribute(entry, "font-size"),
    );
    if (x === undefined || y === undefined || size === undefined) {
      return null;
    }
    const textLength = helpers.decodedTextLength(entry.content || "");
    return {
      id: helpers.id,
      tool: "text",
      paintOrder,
      data: helpers.decorateStoredItemData(
        {
          x,
          y,
          size,
          color: helpers.readStoredSvgAttribute(entry, "fill") || "#000000",
        },
        helpers.opacity,
        helpers.transform,
      ),
      textLength,
      localBounds: getLocalGeometryBounds({
        tool: "text",
        x,
        y,
        size,
        textLength,
      }),
    };
  },
  parseStoredSvgItem(summary, entry, helpers) {
    return {
      id: summary.id,
      tool: "text",
      ...summary.data,
      txt: helpers.unescapeHtml(entry.content || ""),
    };
  },
  serializeStoredSvgItem(item, helpers) {
    const transform = helpers.renderTransformAttribute(item.transform);
    const id = typeof item.id === "string" ? helpers.escapeHtml(item.id) : "";
    const color = helpers.escapeHtml(item.color || "#000000");
    const opacity =
      typeof item.opacity === "number" ? ` opacity="${item.opacity}"` : "";
    const textValue = String(item.txt || "");
    return (
      `<text id="${id}" x="${helpers.numberOrZero(item.x)}" y="${helpers.numberOrZero(item.y)}"` +
      ` font-size="${helpers.numberOrZero(item.size) | 0}" fill="${color}"${opacity}${transform}>` +
      `${helpers.escapeHtml(textValue)}</text>`
    );
  },
  renderBoardSvg(text, helpers) {
    const x = helpers.numberOrZero(text.x);
    const y = helpers.numberOrZero(text.y);
    return (
      "<text " +
      'id="' +
      helpers.htmlspecialchars(text.id || "t") +
      '" ' +
      'x="' +
      (x | 0) +
      '" ' +
      'y="' +
      (y | 0) +
      '" ' +
      'font-size="' +
      (helpers.numberOrZero(text.size) | 0) +
      '" ' +
      'fill="' +
      helpers.htmlspecialchars(text.color || "#000") +
      '" ' +
      helpers.renderTranslate(text) +
      ">" +
      helpers.htmlspecialchars(text.txt || "") +
      "</text>"
    );
  },
};

/**
 * Storage contracts keyed by tool id. The single source for the contract
 * methods consumed by persistence/render; tool runtime modules re-export their
 * entry from here so there is exactly one definition per tool.
 * @type {Readonly<Record<string, ToolContract>>}
 */
export const STORAGE_CONTRACT_BY_ID = Object.freeze({
  pencil: pencilContract,
  rectangle: rectangleContract,
  ellipse: ellipseContract,
  "straight-line": straightLineContract,
  text: textContract,
});

export const PencilContract = pencilContract;
export const RectangleContract = rectangleContract;
export const EllipseContract = ellipseContract;
export const StraightLineContract = straightLineContract;
export const TextContract = textContract;

/**
 * Server-safe tool contracts: manifest metadata merged with the storage
 * contract methods, one entry per tool, ordered by manifest order.
 * @type {ReadonlyArray<Readonly<import("./manifest.js").ToolManifestEntry & Partial<ToolContract>>>}
 */
export const TOOL_CONTRACTS = Object.freeze(
  TOOL_MANIFEST.map((entry) =>
    Object.freeze({
      ...entry,
      ...(STORAGE_CONTRACT_BY_ID[entry.toolId] || {}),
    }),
  ),
);

export const TOOL_CONTRACT_BY_ID = Object.freeze(
  Object.fromEntries(TOOL_CONTRACTS.map((tool) => [tool.toolId, tool])),
);

export const TOOL_CONTRACT_BY_CODE = TOOL_CONTRACTS;

export const TOOL_CONTRACT_BY_STORED_TAG_NAME = Object.freeze(
  Object.fromEntries(
    TOOL_CONTRACTS.filter((tool) => typeof tool.storedTagName === "string").map(
      (tool) => [tool.storedTagName, tool],
    ),
  ),
);

export const Cursor =
  /** @type {Readonly<import("./manifest.js").ToolManifestEntry & Partial<ToolContract>>} */ (
    TOOL_CONTRACT_BY_ID.cursor
  );

export { TOOL_ID_BY_CODE };
export { renderPencilPath, scanPathSummary } from "./pencil/pencil_path.js";
