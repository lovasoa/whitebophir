import MessageCommon from "../client-data/js/message_common.js";
import { TOOL_BY_ID } from "../client-data/tools/index.js";
import { summarizeStoredSvgItem } from "./stored_svg_item_codec.mjs";

/**
 * @param {any} bounds
 * @returns {any}
 */
function cloneBounds(bounds) {
  return bounds
    ? {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      }
    : null;
}

/**
 * @param {any} transform
 * @returns {any}
 */
function cloneTransform(transform) {
  return transform ? { ...transform } : undefined;
}

/**
 * @param {Array<{x: number, y: number}> | undefined} children
 * @returns {Array<{x: number, y: number}>}
 */
function cloneChildren(children) {
  return Array.isArray(children)
    ? children.map((child) => ({ x: child.x, y: child.y }))
    : [];
}

/**
 * @param {{[key: string]: any} | undefined} attrs
 * @returns {{[key: string]: any}}
 */
function cloneAttrs(attrs) {
  return attrs ? { ...attrs } : {};
}

/**
 * @param {{sourceId: string, sourcePayloadKind: string} | undefined} copySource
 * @returns {{sourceId: string, sourcePayloadKind: string} | undefined}
 */
function cloneCopySource(copySource) {
  return copySource ? { ...copySource } : undefined;
}

/**
 * @param {any} payload
 * @returns {any}
 */
function clonePayload(payload) {
  switch (payload?.kind) {
    case "children":
      return {
        kind: "children",
        persistedChildCount:
          typeof payload.persistedChildCount === "number"
            ? payload.persistedChildCount
            : 0,
        appendedChildren: cloneChildren(payload.appendedChildren),
      };
    case "text":
      return {
        kind: "text",
        ...(typeof payload.modifiedText === "string"
          ? { modifiedText: payload.modifiedText }
          : {}),
      };
    default:
      return { kind: "inline" };
  }
}

/**
 * @param {string | undefined} tool
 * @returns {"inline" | "text" | "children"}
 */
function payloadKindForTool(tool) {
  return typeof tool === "string"
    ? TOOL_BY_ID[tool]?.payloadKind || "inline"
    : "inline";
}

/**
 * @param {{[key: string]: any}} attrs
 * @returns {{attrs: {[key: string]: any}, transform: any}}
 */
function splitTransform(attrs) {
  if (!attrs || typeof attrs !== "object") {
    return { attrs: {}, transform: undefined };
  }
  const { transform, ...rest } = attrs;
  return {
    attrs: rest,
    transform: cloneTransform(transform),
  };
}

/**
 * @param {any} item
 * @returns {{[key: string]: any}}
 */
function publicBaseFromCanonicalItem(item) {
  return {
    id: item.id,
    tool: item.tool,
    ...cloneAttrs(item.attrs),
    ...(item.transform !== undefined
      ? { transform: cloneTransform(item.transform) }
      : {}),
  };
}

/**
 * @param {any} item
 * @returns {{[key: string]: any}}
 */
function readInlineAttrs(item) {
  /** @type {{[key: string]: any}} */
  const attrs = {};
  for (const [key, value] of Object.entries(item || {})) {
    if (["id", "tool", "_children", "txt", "transform"].includes(key)) {
      continue;
    }
    attrs[key] = value;
  }
  return attrs;
}

/**
 * @param {any} item
 * @param {number} paintOrder
 * @param {{persisted: boolean, baselineSourceId?: string}=} [options]
 * @returns {any}
 */
function canonicalItemFromItem(
  item,
  paintOrder,
  options = { persisted: false },
) {
  if (!item || typeof item !== "object" || typeof item.id !== "string") {
    return null;
  }

  const persisted = options.persisted === true;
  const attrs = readInlineAttrs(item);
  const bounds = MessageCommon.getLocalGeometryBounds(item);
  const transform = cloneTransform(item.transform);
  const base = {
    id: item.id,
    tool: item.tool,
    paintOrder,
    deleted: false,
    attrs,
    bounds: cloneBounds(bounds),
    ...(transform !== undefined ? { transform } : {}),
    dirty: !persisted,
    createdAfterPersistedSeq: !persisted,
    time: attrs.time,
  };

  switch (payloadKindForTool(item.tool)) {
    case "children": {
      const children = Array.isArray(item._children) ? item._children : [];
      return {
        ...base,
        payload: {
          kind: "children",
          persistedChildCount: persisted ? children.length : 0,
          appendedChildren: persisted ? [] : structuredClone(children),
        },
      };
    }
    case "text":
      return {
        ...base,
        textLength: typeof item.txt === "string" ? item.txt.length : 0,
        payload: {
          kind: "text",
          ...(persisted
            ? {}
            : { modifiedText: typeof item.txt === "string" ? item.txt : "" }),
        },
        ...(persisted && options.baselineSourceId
          ? {
              copySource: {
                sourceId: options.baselineSourceId,
                sourcePayloadKind: "text",
              },
            }
          : {}),
      };
    default:
      return {
        ...base,
        payload: { kind: "inline" },
      };
  }
}

/**
 * @param {{tagName: string, attributes?: {[name: string]: string}, rawAttributes?: string, content?: string, id?: string}} entry
 * @param {number} paintOrder
 * @returns {any}
 */
function canonicalItemFromStoredSvgEntry(entry, paintOrder) {
  const summary = summarizeStoredSvgItem(entry, paintOrder);
  if (!summary) return null;
  const { attrs, transform } = splitTransform(summary.data);
  const base = {
    id: summary.id,
    tool: summary.tool,
    paintOrder,
    deleted: false,
    attrs,
    bounds: cloneBounds(summary.localBounds),
    ...(transform !== undefined ? { transform } : {}),
    dirty: false,
    createdAfterPersistedSeq: false,
    time: attrs.time,
  };

  switch (payloadKindForTool(summary.tool)) {
    case "text":
      return {
        ...base,
        textLength: summary.textLength || 0,
        payload: { kind: "text" },
      };
    case "children":
      return {
        ...base,
        payload: {
          kind: "children",
          persistedChildCount: summary.childCount || 0,
          appendedChildren: [],
        },
      };
    default:
      return {
        ...base,
        payload: { kind: "inline" },
      };
  }
}

/**
 * @param {any} item
 * @returns {any}
 */
function cloneCanonicalItem(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    attrs: cloneAttrs(item.attrs),
    bounds: cloneBounds(item.bounds),
    ...(item.transform !== undefined
      ? { transform: cloneTransform(item.transform) }
      : {}),
    payload: clonePayload(item.payload),
    ...(item.copySource
      ? { copySource: cloneCopySource(item.copySource) }
      : {}),
  };
}

/**
 * @param {any} item
 * @returns {number}
 */
function effectiveChildCount(item) {
  if (item?.payload?.kind !== "children") return 0;
  return (
    (typeof item.payload.persistedChildCount === "number"
      ? item.payload.persistedChildCount
      : 0) + (item.payload.appendedChildren?.length || 0)
  );
}

/**
 * @param {any} item
 * @returns {string | undefined}
 */
function currentText(item) {
  if (item?.payload?.kind !== "text") return undefined;
  return typeof item.payload.modifiedText === "string"
    ? item.payload.modifiedText
    : undefined;
}

/**
 * @param {any} item
 * @returns {string | undefined}
 */
function baselineSourceId(item) {
  return typeof item?.copySource?.sourceId === "string"
    ? item.copySource.sourceId
    : item?.createdAfterPersistedSeq
      ? undefined
      : item?.id;
}

/**
 * @param {any} source
 * @param {string} newId
 * @param {number} paintOrder
 * @param {number} [time]
 * @returns {any}
 */
function copyCanonicalItem(source, newId, paintOrder, time = Date.now()) {
  const copied = cloneCanonicalItem(source);
  copied.id = newId;
  copied.paintOrder = paintOrder;
  copied.deleted = false;
  copied.dirty = true;
  copied.createdAfterPersistedSeq = true;
  copied.time = time;
  copied.attrs = { ...copied.attrs, id: newId, time };

  if (copied.payload?.kind === "text") {
    const sourceText = currentText(source);
    if (sourceText !== undefined) {
      copied.payload.modifiedText = sourceText;
      delete copied.copySource;
    } else {
      copied.copySource = {
        sourceId: baselineSourceId(source),
        sourcePayloadKind: "text",
      };
    }
    return copied;
  }

  if (copied.payload?.kind === "children") {
    copied.payload.appendedChildren = cloneChildren(
      source.payload.appendedChildren,
    );
    copied.payload.persistedChildCount =
      typeof source.payload.persistedChildCount === "number"
        ? source.payload.persistedChildCount
        : 0;
    const sourceBaseline = baselineSourceId(source);
    if (sourceBaseline) {
      copied.copySource = {
        sourceId: sourceBaseline,
        sourcePayloadKind: "children",
      };
    } else {
      delete copied.copySource;
    }
    return copied;
  }

  delete copied.copySource;
  return copied;
}

/**
 * @param {any} item
 * @returns {any}
 */
function publicItemFromCanonicalItem(item) {
  if (!item || item.deleted) return undefined;
  const view = publicBaseFromCanonicalItem(item);
  if (item.payload?.kind === "text") {
    const text = currentText(item);
    if (text !== undefined) view.txt = text;
    view.textLength = item.textLength;
  }
  if (item.payload?.kind === "children") {
    view.persistedChildCount = item.payload.persistedChildCount;
    view.appendedChildren = cloneChildren(item.payload.appendedChildren);
    view.childCount = effectiveChildCount(item);
    if ((item.payload.persistedChildCount || 0) === 0) {
      view._children = cloneChildren(item.payload.appendedChildren);
    }
  }
  if (item.copySource) {
    view.copySource = cloneCopySource(item.copySource);
  }
  return view;
}

/**
 * @param {any} item
 * @param {{txt?: string, _children?: Array<{x: number, y: number}>}=} [sourcePayload]
 * @returns {any}
 */
function materializeItemForSave(item, sourcePayload = {}) {
  if (!item || item.deleted) return null;
  const materialized = publicBaseFromCanonicalItem(item);
  if (item.payload?.kind === "text") {
    materialized.txt =
      currentText(item) ??
      (typeof sourcePayload.txt === "string" ? sourcePayload.txt : "");
  } else if (item.payload?.kind === "children") {
    materialized._children = cloneChildren(sourcePayload._children).concat(
      cloneChildren(item.payload.appendedChildren),
    );
  }
  return materialized;
}

export {
  canonicalItemFromItem,
  canonicalItemFromStoredSvgEntry,
  cloneBounds,
  cloneCanonicalItem,
  copyCanonicalItem,
  currentText,
  effectiveChildCount,
  materializeItemForSave,
  publicItemFromCanonicalItem,
};
