import MessageCommon from "../../client-data/js/message_common.js";
import {
  getToolId,
  getMutationType,
  MutationType,
} from "../../client-data/js/message_tool_metadata.js";
import {
  TOOL_CODE_BY_ID,
  TOOL_ID_BY_CODE,
  TOOL_MANIFEST,
} from "../../client-data/tools/manifest.js";

/** @typedef {{[key: string]: unknown}} RawRecord */
/** @typedef {Pick<import("../../types/server-runtime.d.ts").ServerConfig, "MAX_BOARD_SIZE" | "MAX_CHILDREN">} MessageValidationConfig */
/** @typedef {import("../../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {import("../../types/app-runtime.d.ts").BoardCapabilities} BoardCapabilities */
/** @typedef {import("../../types/app-runtime.d.ts").ToolOwnedBatchMessage} ToolOwnedBatchMessage */
/** @typedef {import("../../types/app-runtime.d.ts").ToolCode} ToolCode */
/**
 * @template T
 * @typedef {{ok: true, value: T}} Accepted
 */
/** @typedef {{ok: false, reason: string}} Rejected */
/**
 * @template T
 * @typedef {Accepted<T> | Rejected} ValidationResult
 */
/** @typedef {{key: string, type: string | number, required: boolean}} FieldSpec */
/** @typedef {FieldSpec[]} FieldSchema */
/** @typedef {{[tool: number]: {[type: number]: FieldSchema}}} LiveToolSchemas */

/**
 * @template T
 * @param {T} value
 * @returns {Accepted<T>}
 */
function accepted(value) {
  return { ok: true, value: value };
}

/**
 * @param {string} reason
 * @returns {Rejected}
 */
function rejected(reason) {
  return { ok: false, reason: reason };
}

/**
 * @param {unknown} value
 * @returns {value is RawRecord}
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<ToolCode>}
 */
function normalizeLiveToolCode(value) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Object.prototype.hasOwnProperty.call(TOOL_ID_BY_CODE, value)
    ? accepted(/** @type {ToolCode} */ (value))
    : rejected("invalid tool");
}

/**
 * Field validators return their value directly; null denotes invalid input.
 * This avoids allocating a result object for every coordinate in incoming drawing messages.
 * @param {string | number} type
 * @param {unknown} value
 * @param {number} maxBoardSize
 * @returns {unknown}
 */
function normalizeField(type, value, maxBoardSize) {
  if (typeof type === "number") return value === type ? value : null;
  switch (type) {
    case "id":
      return MessageCommon.normalizeId(value);
    case "coord":
      return MessageCommon.normalizeBoardCoord(value, maxBoardSize);
    case "color":
      return MessageCommon.normalizeColor(value);
    case "size":
      return MessageCommon.normalizeNumberInRange(
        value,
        MessageCommon.LIMITS.MIN_SIZE,
        MessageCommon.LIMITS.MAX_SIZE,
        true,
      );
    case "opacity":
      return MessageCommon.normalizeNumberInRange(
        value,
        MessageCommon.LIMITS.MIN_OPACITY,
        MessageCommon.LIMITS.MAX_OPACITY,
      );
    case "text":
      return typeof value === "string" &&
        value.length <= MessageCommon.LIMITS.MAX_TEXT_LENGTH
        ? value
        : null;
    case "transform":
      return isPlainObject(value)
        ? MessageCommon.normalizeTransformNumbers(value)
        : null;
    case "time":
      return MessageCommon.normalizeFiniteNumber(value);
    case "toolId":
      return getToolId(value) ?? null;
    default:
      throw new Error(`Unknown message field type: ${type}`);
  }
}

/** @param {string | number} type @param {unknown} value */
function invalidFieldReason(type, value) {
  if (typeof type === "number") return `expected ${type}`;
  if (type === "toolId") return "invalid tool id";
  if (type === "text" && typeof value === "string") return "text too long";
  return `invalid ${type}`;
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<string>}
 */
function normalizeClientMutationId(value) {
  if (typeof value !== "string" || value.length === 0) {
    return rejected("invalid clientMutationId");
  }
  if (value.length > 128) {
    return rejected("clientMutationId too long");
  }
  return accepted(value);
}

/**
 * @param {unknown} raw
 * @param {FieldSchema} fields
 * @param {number} maxBoardSize
 * @returns {ValidationResult<RawRecord>}
 */
function normalizeObject(raw, fields, maxBoardSize) {
  if (!isPlainObject(raw)) return rejected("expected object");

  /** @type {RawRecord} */
  const normalized = {};
  for (const field of fields) {
    const { key, type } = field;
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      if (field.required) return rejected(`missing ${key}`);
      continue;
    }
    const value = normalizeField(type, raw[key], maxBoardSize);
    if (value === null) {
      return rejected(`${key}: ${invalidFieldReason(type, raw[key])}`);
    }
    normalized[key] = value;
  }

  return accepted(normalized);
}

/**
 * Compile the manifest once. Optional markers never need parsing on the write path.
 * @param {Record<string, string | number>} fields
 * @returns {FieldSchema}
 */
function buildSchema(fields) {
  return Object.entries(fields).map(([key, spec]) => {
    const optional = typeof spec === "string" && spec.endsWith("?");
    return {
      key,
      type: optional ? String(spec).slice(0, -1) : spec,
      required: !optional,
    };
  });
}

/** @type {LiveToolSchemas} */
const LIVE_MESSAGE_SCHEMAS = {
  [TOOL_CODE_BY_ID.cursor]: {
    [MutationType.UPDATE]: buildSchema({
      tool: TOOL_CODE_BY_ID.cursor,
      type: MutationType.UPDATE,
      color: "color",
      size: "size",
      opacity: "opacity?",
      activeTool: "toolId?",
      x: "coord",
      y: "coord",
    }),
  },
};
/** @type {LiveToolSchemas} */
const LIVE_BATCH_CHILD_SCHEMAS = {};
for (const tool of TOOL_MANIFEST) {
  const liveFields = tool.shapeTool
    ? {
        [MutationType.CREATE]: {
          id: "id",
          color: "color",
          size: "size",
          opacity: "opacity?",
          x: "coord",
          y: "coord",
          x2: "coord",
          y2: "coord",
        },
        [MutationType.UPDATE]: {
          id: "id",
          ...Object.fromEntries(
            (tool.updatableFields || []).map((field) => [field, "coord"]),
          ),
        },
      }
    : tool.liveMessageFields;
  if (liveFields) {
    LIVE_MESSAGE_SCHEMAS[tool.id] = Object.fromEntries(
      Object.entries(liveFields).map(([type, fields]) => [
        type,
        buildSchema({ tool: tool.id, type: Number(type), ...fields }),
      ]),
    );
  }
  if (tool.batchMessageFields) {
    LIVE_BATCH_CHILD_SCHEMAS[tool.id] = Object.fromEntries(
      Object.entries(tool.batchMessageFields).map(([type, fields]) => [
        type,
        buildSchema({ type: Number(type), ...fields }),
      ]),
    );
  }
}

/**
 * @param {unknown} raw
 * @param {number} maxBoardSize
 * @param {number} maxChildren
 * @param {BoardCapabilities | undefined} capabilities
 * @returns {ValidationResult<NormalizedMessageData>}
 */
function normalizeIncomingBatch(raw, maxBoardSize, maxChildren, capabilities) {
  if (!isPlainObject(raw)) return rejected("expected object");
  if (!Object.prototype.hasOwnProperty.call(raw, "tool")) {
    return rejected("missing tool");
  }
  const toolCode = normalizeLiveToolCode(raw.tool);
  if (toolCode.ok === false) return toolCode;

  const childSchemas = LIVE_BATCH_CHILD_SCHEMAS[toolCode.value];
  if (!childSchemas) return rejected("unsupported batch tool");
  if (!Array.isArray(raw._children)) return rejected("invalid _children");
  if (capabilities?.canClear !== true && raw._children.length > maxChildren) {
    return rejected("too many children");
  }

  const children = [];
  for (let index = 0; index < raw._children.length; index++) {
    const child = raw._children[index];
    const schema =
      child && typeof child.type === "number"
        ? childSchemas[child.type]
        : undefined;
    if (!schema) {
      return rejected(`_children[${index}]: invalid type`);
    }

    const normalizedChild = normalizeObject(child, schema, maxBoardSize);
    if (normalizedChild.ok === false) {
      return rejected(`_children[${index}]: ${normalizedChild.reason}`);
    }
    children.push(normalizedChild.value);
  }

  /** @type {ToolOwnedBatchMessage} */
  const normalized = {
    tool: /** @type {ToolOwnedBatchMessage["tool"]} */ (toolCode.value),
    _children: /** @type {ToolOwnedBatchMessage["_children"]} */ (children),
  };
  if (Object.prototype.hasOwnProperty.call(raw, "clientMutationId")) {
    const clientMutationId = normalizeClientMutationId(raw.clientMutationId);
    if (!clientMutationId.ok) return clientMutationId;
    normalized.clientMutationId = clientMutationId.value;
  }
  return accepted(/** @type {NormalizedMessageData} */ (normalized));
}

/**
 * @param {MessageValidationConfig} config
 * @param {unknown} raw
 * @param {BoardCapabilities} [capabilities]
 * @returns {ValidationResult<NormalizedMessageData>}
 */
function normalizeIncomingMessage(config, raw, capabilities) {
  const maxBoardSize = config.MAX_BOARD_SIZE;
  const maxChildren = config.MAX_CHILDREN;

  if (!isPlainObject(raw)) return rejected("expected object");
  if (Array.isArray(raw._children)) {
    return normalizeIncomingBatch(raw, maxBoardSize, maxChildren, capabilities);
  }
  if (!Object.prototype.hasOwnProperty.call(raw, "tool")) {
    return rejected("missing tool");
  }
  const toolCode = normalizeLiveToolCode(raw.tool);
  if (toolCode.ok === false) return toolCode;

  const toolSchemas = LIVE_MESSAGE_SCHEMAS[toolCode.value];
  const schema =
    typeof raw.type === "number" ? toolSchemas?.[raw.type] : undefined;
  if (!schema) return rejected("invalid tool/type");

  const normalized = normalizeObject(raw, schema, maxBoardSize);
  if (!normalized.ok) return normalized;
  if (
    getMutationType(normalized.value) !== MutationType.UPDATE &&
    MessageCommon.isGeometryInvalid(normalized.value, maxBoardSize)
  ) {
    return rejected("shape too large");
  }
  if (
    toolCode.value !== TOOL_CODE_BY_ID.cursor &&
    Object.prototype.hasOwnProperty.call(raw, "clientMutationId")
  ) {
    const clientMutationId = normalizeClientMutationId(raw.clientMutationId);
    if (!clientMutationId.ok) return clientMutationId;
    normalized.value.clientMutationId = clientMutationId.value;
  }
  return accepted(/** @type {NormalizedMessageData} */ (normalized.value));
}

export { normalizeIncomingMessage };
