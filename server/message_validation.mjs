import MessageCommon from "../client-data/js/message_common.js";
import {
  getMutationType,
  MutationType,
} from "../client-data/js/message_tool_metadata.js";
import { Cursor, TOOL_BY_ID, TOOLS } from "../client-data/tools/index.js";
import { parseIntegerEnv } from "./configuration_helpers.mjs";
const MAX_BOARD_SIZE = parseIntegerEnv("WBO_MAX_BOARD_SIZE", 655360);
const MAX_CHILDREN = parseIntegerEnv("WBO_MAX_CHILDREN", 500);

// Capture config once at module load. The hot paths below (per-coordinate
// clamping via `normalizeCoord`, per-child length checks) run thousands of
// times per large-board load, so module-scope capture remains required.
// Tests that need alternate env must re-import this module with a fresh URL.

/** @typedef {{[key: string]: unknown}} RawRecord */
/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {import("../types/app-runtime.d.ts").ToolCode} ToolCode */
/** @typedef {import("../types/app-runtime.d.ts").Transform} Transform */
/** @typedef {{x: number, y: number}} ChildPoint */
/** @typedef {{minX: number, minY: number, maxX: number, maxY: number} | null} Bounds */
/** @typedef {{value: RawRecord, localBounds: Bounds}} StoredItemWithBounds */
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
 *   defaultValue?: unknown | ((raw: RawRecord, normalized: RawRecord) => unknown),
 * }} FieldSpec
 */
/** @typedef {{[key: string]: FieldSpec}} FieldSchema */
/** @typedef {{[tool: number]: {[type: number]: FieldSchema}}} LiveToolSchemas */
/** @typedef {{[tool: string]: FieldSchema}} StoredToolSchemas */
/** @typedef {import("../client-data/tools/shape_contract.js").ToolContract} ToolContract */
/** @typedef {"id" | "coord" | "color" | "size" | "opacity" | "text" | "transform" | "time"} SchemaFieldType */

/** @type {string[]} */
const TRANSFORM_KEYS = ["a", "b", "c", "d", "e", "f"];
const MAX_TOOL_CODE = TOOLS.length;
const SHAPE_CONTRACTS = TOOLS.filter((tool) => tool.shapeTool === true);
const SHAPE_CREATE_FIELDS = {
  id: "id",
  color: "color",
  size: "size",
  opacity: "opacity?",
  x: "coord",
  y: "coord",
};
const SHAPE_STORED_FIELDS = {
  color: "color",
  size: "size",
  opacity: "opacity?",
  x: "coord",
  y: "coord",
  transform: "transform?",
  time: "time?",
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
 * @returns {Accepted<number>}
 */
function normalizeSize(value) {
  return accepted(MessageCommon.clampSize(value));
}

/**
 * @param {unknown} value
 * @returns {Accepted<number | undefined>}
 */
function normalizeOpacity(value) {
  const opacity = MessageCommon.clampOpacity(value);
  return opacity === 1 ? accepted(undefined) : accepted(opacity);
}

/**
 * @param {unknown} value
 * @returns {Accepted<number>}
 */
function normalizeCoord(value) {
  return accepted(MessageCommon.clampCoord(value, MAX_BOARD_SIZE));
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
 * @returns {Accepted<string>}
 */
function normalizeText(value) {
  return accepted(MessageCommon.truncateText(value));
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

  /** @type {Transform} */
  const transform = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  for (const key of TRANSFORM_KEYS) {
    const number = MessageCommon.normalizeFiniteNumber(value[key]);
    if (number === null) {
      return rejected(`invalid transform.${key}`);
    }
    transform[/** @type {keyof Transform} */ (key)] = number;
  }

  return accepted(transform);
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
    } else if (Object.hasOwn(field, "defaultValue")) {
      value =
        typeof field.defaultValue === "function"
          ? field.defaultValue(raw, normalized)
          : field.defaultValue;
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
 * @param {RawRecord} raw
 * @param {RawRecord} normalized
 * @returns {unknown}
 */
function defaultCoordinateFromX(raw, normalized) {
  return normalized.x !== undefined ? normalized.x : raw.x;
}

/**
 * @param {RawRecord} raw
 * @param {RawRecord} normalized
 * @returns {unknown}
 */
function defaultCoordinateFromY(raw, normalized) {
  return normalized.y !== undefined ? normalized.y : raw.y;
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
 * @param {string} toolId
 * @param {string} type
 * @param {{[field: string]: string} | undefined} fields
 * @returns {FieldSchema}
 */
function buildStoredSchema(toolId, type, fields) {
  return {
    tool: required(literal(toolId)),
    type: optional(literal(type), { defaultValue: type }),
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
        [MutationType.CREATE]: {
          ...buildLiveSchema(
            contract.id,
            MutationType.CREATE,
            SHAPE_CREATE_FIELDS,
          ),
          x2: optional(normalizeCoord, {
            defaultValue: defaultCoordinateFromX,
          }),
          y2: optional(normalizeCoord, {
            defaultValue: defaultCoordinateFromY,
          }),
        },
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

/** @type {StoredToolSchemas} */
const STORED_SHAPE_SCHEMAS = Object.fromEntries(
  SHAPE_CONTRACTS.map((contract) => {
    const schema = buildStoredSchema(
      contract.toolId,
      contract.storedTagName || "",
      SHAPE_STORED_FIELDS,
    );
    schema.x2 = optional(normalizeCoord, {
      defaultValue: defaultCoordinateFromX,
    });
    schema.y2 = optional(normalizeCoord, {
      defaultValue: defaultCoordinateFromY,
    });
    return [contract.toolId, schema];
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

/** @type {StoredToolSchemas} */
const CONTRACT_STORED_ITEM_SCHEMAS = Object.fromEntries(
  TOOLS.filter((tool) => tool.storedFields).map((tool) => [
    tool.toolId,
    buildStoredSchema(tool.toolId, tool.storedTagName || "", tool.storedFields),
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

/** @type {{[tool: string]: FieldSchema}} */
const STORED_ITEM_SCHEMAS = {
  ...CONTRACT_STORED_ITEM_SCHEMAS,
  ...STORED_SHAPE_SCHEMAS,
};

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

  /** @type {NormalizedMessageData} */
  const normalized = {
    tool: toolCode.value,
    _children: /** @type {NormalizedMessageData["_children"]} */ (children),
  };
  if (Object.hasOwn(raw, "clientMutationId")) {
    const clientMutationId = normalizeClientMutationId(raw.clientMutationId);
    if (!clientMutationId.ok) return clientMutationId;
    normalized.clientMutationId = clientMutationId.value;
  }
  return accepted(normalized);
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
    MessageCommon.isGeometryTooLarge(normalized.value)
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

/**
 * @param {unknown} raw
 * @returns {ValidationResult<ChildPoint>}
 */
function normalizeStoredChildPoint(raw) {
  if (!isPlainObject(raw)) return rejected("expected object");

  const x = normalizeCoord(raw.x);
  const y = normalizeCoord(raw.y);

  return accepted({ x: x.value, y: y.value });
}

/**
 * @param {unknown[]} rawChildren
 * @returns {ChildPoint[]}
 */
function normalizeStoredPencilChildren(rawChildren) {
  const children = [];
  for (let index = 0; index < rawChildren.length; index++) {
    const child = normalizeStoredChildPoint(rawChildren[index]);
    if (!child.ok) continue;
    children.push(child.value);
  }
  return children;
}

/**
 * @param {RawRecord} item
 * @returns {ValidationResult<Bounds>}
 */
function validateStoredGeometryBounds(item) {
  const localBounds = MessageCommon.getLocalGeometryBounds(item);
  const effectiveBounds = MessageCommon.applyTransformToBounds(
    localBounds,
    item.transform,
  );
  if (MessageCommon.isBoundsTooLarge(effectiveBounds)) {
    return rejected("shape too large");
  }
  return accepted(localBounds);
}

/**
 * @param {RawRecord} item
 * @param {unknown} rawChildren
 * @returns {void}
 */
function assignNormalizedStoredChildren(item, rawChildren) {
  const contract =
    typeof item.tool === "string" ? TOOL_BY_ID[item.tool] : undefined;
  contract?.normalizeStoredItemData?.(
    item,
    { _children: rawChildren },
    {
      maxChildren: MAX_CHILDREN,
      normalizeStoredChildren: normalizeStoredPencilChildren,
    },
  );
}

/**
 * @param {unknown} raw
 * @param {unknown} storedId
 * @returns {ValidationResult<StoredItemWithBounds>}
 */
function normalizeStoredItemWithBounds(raw, storedId) {
  const normalizedId = MessageCommon.normalizeId(storedId);
  if (normalizedId === null) return rejected("invalid stored id");
  if (!isPlainObject(raw)) return rejected("invalid stored item");
  if (typeof raw.tool !== "string" || raw.tool === "") {
    return rejected("unsupported stored tool");
  }

  const schema = STORED_ITEM_SCHEMAS[raw.tool];
  if (!schema) return rejected("unsupported stored tool");

  const normalized = normalizeObject(raw, schema);
  if (!normalized.ok) return normalized;

  normalized.value.id = normalizedId;
  assignNormalizedStoredChildren(normalized.value, raw._children);
  const localBounds = validateStoredGeometryBounds(normalized.value);
  if (!localBounds.ok) return localBounds;

  return accepted({
    value: normalized.value,
    localBounds: localBounds.value,
  });
}

/**
 * @param {unknown} raw
 * @param {unknown} storedId
 * @returns {ValidationResult<RawRecord>}
 */
function normalizeStoredItem(raw, storedId) {
  const normalized = normalizeStoredItemWithBounds(raw, storedId);
  if (!normalized.ok) return normalized;
  return accepted(normalized.value.value);
}

export {
  normalizeIncomingMessage,
  normalizeStoredChildPoint,
  normalizeStoredItem,
  normalizeStoredItemWithBounds,
};
