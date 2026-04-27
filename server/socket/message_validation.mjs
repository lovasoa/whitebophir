import MessageCommon from "../../client-data/js/message_common.js";
import {
  getMutationType,
  MutationType,
} from "../../client-data/js/message_tool_metadata.js";
import { Cursor, TOOLS } from "../../client-data/tools/index.js";
import { parseIntegerEnv } from "../configuration/helpers.mjs";
const MAX_BOARD_SIZE = parseIntegerEnv("WBO_MAX_BOARD_SIZE", 655360);
const MAX_CHILDREN = parseIntegerEnv("WBO_MAX_CHILDREN", 500);

// Capture config once at module load. The hot paths below (per-coordinate
// clamping via `normalizeCoord`, per-child length checks) run thousands of
// times per large-board load, so module-scope capture remains required.
// Tests that need alternate env must re-import this module with a fresh URL.

/** @typedef {{[key: string]: unknown}} RawRecord */
/** @typedef {import("../../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {import("../../types/app-runtime.d.ts").ToolOwnedBatchMessage} ToolOwnedBatchMessage */
/** @typedef {import("../../types/app-runtime.d.ts").ToolCode} ToolCode */
/** @typedef {import("../../types/app-runtime.d.ts").Transform} Transform */
/**
 * @template T
 * @typedef {{ok: true, value: T}} Accepted
 */
/** @typedef {{ok: false, reason: string}} Rejected */
/**
 * @template T
 * @typedef {Accepted<T> | Rejected} ValidationResult
 */
/**
 * @template [T=unknown]
 * @typedef {(value: unknown, raw?: RawRecord, normalized?: RawRecord) => ValidationResult<T>} FieldNormalizer
 */
/**
 * @template [T=unknown]
 * @typedef {{
 *   normalize: FieldNormalizer<T>,
 *   required: boolean,
 * }} FieldSpec
 */
/** @typedef {{[key: string]: FieldSpec}} FieldSchema */
/** @typedef {{[tool: number]: {[type: number]: FieldSchema}}} LiveToolSchemas */
/** @typedef {import("../../client-data/tools/shape_contract.js").ToolContract} ToolContract */
/** @typedef {"id" | "coord" | "color" | "size" | "opacity" | "text" | "transform" | "time"} SchemaFieldType */

const MAX_TOOL_CODE = TOOLS.length;
const SHAPE_CONTRACTS = TOOLS.filter((tool) => tool.shapeTool === true);
const SHAPE_CREATE_FIELDS = {
  id: "id",
  color: "color",
  size: "size",
  opacity: "opacity?",
  x: "coord",
  y: "coord",
  x2: "coord",
  y2: "coord",
};

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
 * @template T
 * @param {FieldNormalizer<T>} normalize
 * @param {Partial<FieldSpec<T>>} [options]
 * @returns {FieldSpec<T>}
 */
function required(normalize, options) {
  return { normalize, required: true, ...options };
}

/**
 * @template T
 * @param {FieldNormalizer<T>} normalize
 * @param {Partial<FieldSpec<T>>} [options]
 * @returns {FieldSpec<T>}
 */
function optional(normalize, options) {
  return { normalize, required: false, ...options };
}

/**
 * @template {string | number} T
 * @param {T} expected
 * @returns {(value: unknown) => ValidationResult<T>}
 */
function literal(expected) {
  return function normalizeLiteral(value) {
    return value === expected
      ? accepted(/** @type {T} */ (value))
      : rejected(`expected ${JSON.stringify(expected)}`);
  };
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<ToolCode>}
 */
function normalizeLiveToolCode(value) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_TOOL_CODE
    ? accepted(/** @type {ToolCode} */ (value))
    : rejected("invalid tool");
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<string>}
 */
function normalizeId(value) {
  const id = MessageCommon.normalizeId(value);
  return id === null ? rejected("invalid id") : accepted(id);
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<number>}
 */
function normalizeSize(value) {
  const size = MessageCommon.normalizeNumberInRange(
    value,
    MessageCommon.LIMITS.MIN_SIZE,
    MessageCommon.LIMITS.MAX_SIZE,
    true,
  );
  return size === null ? rejected("invalid size") : accepted(size);
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<number | undefined>}
 */
function normalizeOpacity(value) {
  const opacity = MessageCommon.normalizeNumberInRange(
    value,
    MessageCommon.LIMITS.MIN_OPACITY,
    MessageCommon.LIMITS.MAX_OPACITY,
  );
  return opacity === null ? rejected("invalid opacity") : accepted(opacity);
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<number>}
 */
function normalizeCoord(value) {
  const coord = MessageCommon.normalizeBoardCoord(value, MAX_BOARD_SIZE);
  return coord === null ? rejected("invalid coord") : accepted(coord);
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<string>}
 */
function normalizeColor(value) {
  const color = MessageCommon.normalizeColor(value);
  return color === null ? rejected("invalid color") : accepted(color);
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<string>}
 */
function normalizeText(value) {
  if (typeof value !== "string") return rejected("invalid text");
  return value.length <= Number(MessageCommon.LIMITS.MAX_TEXT_LENGTH)
    ? accepted(value)
    : rejected("text too long");
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
 * @param {unknown} value
 * @returns {ValidationResult<number>}
 */
function normalizeTime(value) {
  const time = MessageCommon.normalizeFiniteNumber(value);
  return time === null ? rejected("invalid time") : accepted(time);
}

/**
 * @param {unknown} value
 * @returns {ValidationResult<Transform>}
 */
function normalizeTransform(value) {
  if (!isPlainObject(value)) return rejected("invalid transform");
  const transform = MessageCommon.normalizeTransformNumbers(value);
  if (transform === null) return rejected("invalid transform");
  return accepted(/** @type {Transform} */ (transform));
}

/**
 * @param {unknown} raw
 * @param {FieldSchema} fields
 * @returns {ValidationResult<RawRecord>}
 */
function normalizeObject(raw, fields) {
  if (!isPlainObject(raw)) return rejected("expected object");

  /** @type {RawRecord} */
  const normalized = {};
  for (const key in fields) {
    const field = fields[key];
    if (!field) continue;
    const hasValue = Object.hasOwn(raw, key);
    /** @type {unknown} */
    let value;

    if (hasValue) {
      value = raw[key];
    } else if (field.required) {
      return rejected(`missing ${key}`);
    } else {
      continue;
    }

    const result = field.normalize(value, raw, normalized);
    if (result.ok === false) return rejected(`${key}: ${result.reason}`);
    if (result.value !== undefined) normalized[key] = result.value;
  }

  return accepted(normalized);
}

/**
 * @param {string} spec
 * @returns {{type: SchemaFieldType, optional: boolean}}
 */
function parseSchemaFieldSpec(spec) {
  const optional = spec.endsWith("?");
  return {
    type: /** @type {SchemaFieldType} */ (optional ? spec.slice(0, -1) : spec),
    optional,
  };
}

/**
 * @param {SchemaFieldType} type
 * @param {boolean} optionalField
 * @returns {FieldSpec}
 */
function buildSchemaField(type, optionalField) {
  const make = optionalField ? optional : required;
  switch (type) {
    case "id":
      return make(normalizeId);
    case "coord":
      return make(normalizeCoord);
    case "color":
      return make(normalizeColor);
    case "size":
      return make(normalizeSize);
    case "opacity":
      return make(normalizeOpacity);
    case "text":
      return make(normalizeText);
    case "transform":
      return make(normalizeTransform);
    case "time":
      return make(normalizeTime);
  }
}

/**
 * @param {{[field: string]: string} | undefined} fields
 * @returns {FieldSchema}
 */
function buildSchemaFields(fields) {
  /** @type {FieldSchema} */
  const schema = {};
  for (const [field, spec] of Object.entries(fields || {})) {
    const parsed = parseSchemaFieldSpec(spec);
    schema[field] = buildSchemaField(parsed.type, parsed.optional);
  }
  return schema;
}

/**
 * @param {number} toolCode
 * @param {number} type
 * @param {{[field: string]: string}} fields
 * @returns {FieldSchema}
 */
function buildLiveSchema(toolCode, type, fields) {
  return {
    tool: required(literal(toolCode)),
    type: required(literal(type)),
    ...buildSchemaFields(fields),
  };
}

/**
 * @param {{[type: number]: {[field: string]: string}} | undefined} fieldsByType
 * @param {(type: number, fields: {[field: string]: string}) => FieldSchema} build
 * @returns {{[type: number]: FieldSchema}}
 */
function buildPerTypeSchemas(fieldsByType, build) {
  return Object.fromEntries(
    Object.entries(fieldsByType || {}).map(([type, fields]) => [
      Number(type),
      build(Number(type), fields),
    ]),
  );
}

const LIVE_SHAPE_SCHEMAS = Object.fromEntries(
  SHAPE_CONTRACTS.map((contract) => {
    return [
      contract.id,
      {
        [MutationType.CREATE]: buildLiveSchema(
          contract.id,
          MutationType.CREATE,
          SHAPE_CREATE_FIELDS,
        ),
        [MutationType.UPDATE]: buildLiveSchema(
          contract.id,
          MutationType.UPDATE,
          {
            id: "id",
            ...Object.fromEntries(
              (contract.updatableFields || []).map((field) => [field, "coord"]),
            ),
          },
        ),
      },
    ];
  }),
);

/** @type {LiveToolSchemas} */
const CONTRACT_LIVE_MESSAGE_SCHEMAS = Object.fromEntries(
  TOOLS.filter((tool) => tool.liveMessageFields).map((tool) => [
    tool.id,
    buildPerTypeSchemas(tool.liveMessageFields, (type, fields) =>
      buildLiveSchema(tool.id, type, fields),
    ),
  ]),
);

/** @type {LiveToolSchemas} */
const LIVE_MESSAGE_SCHEMAS = Object.fromEntries(
  Object.entries({
    [Cursor.id]: {
      [MutationType.UPDATE]: buildLiveSchema(Cursor.id, MutationType.UPDATE, {
        color: "color",
        size: "size",
        x: "coord",
        y: "coord",
      }),
    },
    ...CONTRACT_LIVE_MESSAGE_SCHEMAS,
    ...LIVE_SHAPE_SCHEMAS,
  }),
);

const LIVE_BATCH_CHILD_SCHEMAS = Object.fromEntries(
  TOOLS.filter((tool) => tool.batchMessageFields).map((tool) => [
    tool.id,
    buildPerTypeSchemas(tool.batchMessageFields, (type, fields) => ({
      type: required(literal(type)),
      ...buildSchemaFields(fields),
    })),
  ]),
);

/**
 * @param {unknown} raw
 * @returns {ValidationResult<NormalizedMessageData>}
 */
function normalizeIncomingBatch(raw) {
  if (!isPlainObject(raw)) return rejected("expected object");
  if (!Object.hasOwn(raw, "tool")) return rejected("missing tool");
  const toolCode = normalizeLiveToolCode(raw.tool);
  if (toolCode.ok === false) return toolCode;

  const childSchemas = LIVE_BATCH_CHILD_SCHEMAS[toolCode.value];
  if (!childSchemas) return rejected("unsupported batch tool");
  if (!Array.isArray(raw._children)) return rejected("invalid _children");
  if (raw._children.length > MAX_CHILDREN) {
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

    const normalizedChild = normalizeObject(child, schema);
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
  if (Object.hasOwn(raw, "clientMutationId")) {
    const clientMutationId = normalizeClientMutationId(raw.clientMutationId);
    if (!clientMutationId.ok) return clientMutationId;
    normalized.clientMutationId = clientMutationId.value;
  }
  return accepted(/** @type {NormalizedMessageData} */ (normalized));
}

/**
 * @param {unknown} raw
 * @returns {ValidationResult<NormalizedMessageData>}
 */
function normalizeIncomingMessage(raw) {
  if (!isPlainObject(raw)) return rejected("expected object");
  if (Array.isArray(raw._children)) return normalizeIncomingBatch(raw);
  if (!Object.hasOwn(raw, "tool")) return rejected("missing tool");
  const toolCode = normalizeLiveToolCode(raw.tool);
  if (toolCode.ok === false) return toolCode;

  const toolSchemas = LIVE_MESSAGE_SCHEMAS[toolCode.value];
  const schema =
    typeof raw.type === "number" ? toolSchemas?.[raw.type] : undefined;
  if (!schema) return rejected("invalid tool/type");

  const normalized = normalizeObject(raw, schema);
  if (!normalized.ok) return normalized;
  if (
    getMutationType(normalized.value) !== MutationType.UPDATE &&
    MessageCommon.isGeometryInvalid(normalized.value, MAX_BOARD_SIZE)
  ) {
    return rejected("shape too large");
  }
  if (toolCode.value !== Cursor.id && Object.hasOwn(raw, "clientMutationId")) {
    const clientMutationId = normalizeClientMutationId(raw.clientMutationId);
    if (!clientMutationId.ok) return clientMutationId;
    normalized.value.clientMutationId = clientMutationId.value;
  }
  return accepted(/** @type {NormalizedMessageData} */ (normalized.value));
}

export { normalizeIncomingMessage };
