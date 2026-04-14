const config = require("./configuration.js");
const MessageCommon = require("../client-data/js/message_common.js");
const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");

/** @typedef {{[key: string]: any}} RawRecord */
/** @typedef {import("../types/app-runtime").Transform} Transform */
/** @typedef {{x: number, y: number}} ChildPoint */
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
 * @typedef {{
 *   normalize: (value: any, raw?: RawRecord, normalized?: RawRecord) => ValidationResult<any>,
 *   required: boolean,
 *   defaultValue?: any | ((raw: RawRecord, normalized: RawRecord) => any),
 * }} FieldSpec
 */
/** @typedef {{[key: string]: FieldSpec}} FieldSchema */
/** @typedef {{[tool: string]: {[type: string]: FieldSchema}}} ToolSchemas */

/** @type {string[]} */
const TRANSFORM_KEYS = ["a", "b", "c", "d", "e", "f"];

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
 * @param {any} value
 * @returns {value is RawRecord}
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {FieldSpec["normalize"]} normalize
 * @param {Partial<FieldSpec>} [options]
 * @returns {FieldSpec}
 */
function required(normalize, options) {
  return Object.assign({ normalize: normalize, required: true }, options);
}

/**
 * @param {FieldSpec["normalize"]} normalize
 * @param {Partial<FieldSpec>} [options]
 * @returns {FieldSpec}
 */
function optional(normalize, options) {
  return Object.assign({ normalize: normalize, required: false }, options);
}

/**
 * @template {string} T
 * @param {T} expected
 * @returns {(value: any) => ValidationResult<T>}
 */
function literal(expected) {
  return function normalizeLiteral(value) {
    return value === expected
      ? accepted(expected)
      : rejected("expected " + JSON.stringify(expected));
  };
}

/**
 * @param {any} value
 * @returns {ValidationResult<string>}
 */
function normalizeId(value) {
  const id = MessageCommon.normalizeId(value);
  return id === null ? rejected("invalid id") : accepted(id);
}

/**
 * @param {any} value
 * @returns {Accepted<number>}
 */
function normalizeSize(value) {
  return accepted(MessageCommon.clampSize(value));
}

/**
 * @param {any} value
 * @returns {Accepted<number | undefined>}
 */
function normalizeOpacity(value) {
  const opacity = MessageCommon.clampOpacity(value);
  return opacity === 1 ? accepted(undefined) : accepted(opacity);
}

/**
 * @param {any} value
 * @returns {Accepted<number>}
 */
function normalizeCoord(value) {
  return accepted(MessageCommon.clampCoord(value, config.MAX_BOARD_SIZE));
}

/**
 * @param {any} value
 * @returns {ValidationResult<string>}
 */
function normalizeColor(value) {
  const color = MessageCommon.normalizeColor(value);
  return color === null ? rejected("invalid color") : accepted(color);
}

/**
 * @param {any} value
 * @returns {Accepted<string>}
 */
function normalizeText(value) {
  return accepted(MessageCommon.truncateText(value));
}

/**
 * @param {any} value
 * @returns {ValidationResult<number>}
 */
function normalizeTime(value) {
  const time = MessageCommon.normalizeFiniteNumber(value);
  return time === null ? rejected("invalid time") : accepted(time);
}

/**
 * @param {any} value
 * @returns {ValidationResult<Transform>}
 */
function normalizeTransform(value) {
  if (!isPlainObject(value)) return rejected("invalid transform");

  /** @type {Transform} */
  const transform = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  for (const key of TRANSFORM_KEYS) {
    const number = MessageCommon.normalizeFiniteNumber(value[key]);
    if (number === null) {
      return rejected("invalid transform." + key);
    }
    transform[/** @type {keyof Transform} */ (key)] = number;
  }

  return accepted(transform);
}

/**
 * @param {any} raw
 * @param {FieldSchema} fields
 * @returns {ValidationResult<RawRecord>}
 */
function normalizeObject(raw, fields) {
  if (!isPlainObject(raw)) return rejected("expected object");

  /** @type {RawRecord} */
  const normalized = {};
  for (const [key, field] of Object.entries(fields)) {
    const hasValue = Object.prototype.hasOwnProperty.call(raw, key);
    /** @type {any} */
    let value;

    if (hasValue) {
      value = raw[key];
    } else if (Object.prototype.hasOwnProperty.call(field, "defaultValue")) {
      value =
        typeof field.defaultValue === "function"
          ? field.defaultValue(raw, normalized)
          : field.defaultValue;
    } else if (field.required) {
      return rejected("missing " + key);
    } else {
      continue;
    }

    const result = field.normalize(value, raw, normalized);
    if (result.ok === false) return rejected(key + ": " + result.reason);
    if (result.value !== undefined) normalized[key] = result.value;
  }

  return accepted(normalized);
}

/**
 * @param {RawRecord} raw
 * @param {RawRecord} normalized
 * @returns {number}
 */
function defaultCoordinateFromX(raw, normalized) {
  return normalized.x !== undefined ? normalized.x : raw.x;
}

/**
 * @param {RawRecord} raw
 * @param {RawRecord} normalized
 * @returns {number}
 */
function defaultCoordinateFromY(raw, normalized) {
  return normalized.y !== undefined ? normalized.y : raw.y;
}

/**
 * @param {string} toolName
 * @returns {FieldSchema}
 */
function makeLiveShapeCreateSchema(toolName) {
  const type = MessageToolMetadata.SHAPE_TOOL_TYPES[toolName];
  return {
    tool: required(literal(toolName)),
    type: required(literal(type)),
    id: required(normalizeId),
    color: required(normalizeColor),
    size: required(normalizeSize),
    opacity: optional(normalizeOpacity),
    x: required(normalizeCoord),
    y: required(normalizeCoord),
    x2: optional(normalizeCoord, {
      defaultValue: defaultCoordinateFromX,
    }),
    y2: optional(normalizeCoord, {
      defaultValue: defaultCoordinateFromY,
    }),
  };
}

/**
 * @param {string} toolName
 * @returns {FieldSchema}
 */
function makeLiveShapeUpdateSchema(toolName) {
  /** @type {FieldSchema} */
  const schema = {
    tool: required(literal(toolName)),
    type: required(literal("update")),
    id: required(normalizeId),
  };

  const fields = MessageToolMetadata.getUpdatableFieldNames(toolName);
  for (let i = 0; i < fields.length; i++) {
    schema[fields[i]] = required(normalizeCoord);
  }

  return schema;
}

/**
 * @param {string} toolName
 * @returns {FieldSchema}
 */
function makeStoredShapeSchema(toolName) {
  const type = MessageToolMetadata.SHAPE_TOOL_TYPES[toolName];
  return {
    tool: required(literal(toolName)),
    type: optional(literal(type), { defaultValue: type }),
    color: required(normalizeColor),
    size: required(normalizeSize),
    opacity: optional(normalizeOpacity),
    x: required(normalizeCoord),
    y: required(normalizeCoord),
    x2: optional(normalizeCoord, {
      defaultValue: defaultCoordinateFromX,
    }),
    y2: optional(normalizeCoord, {
      defaultValue: defaultCoordinateFromY,
    }),
    transform: optional(normalizeTransform),
    time: optional(normalizeTime),
  };
}

/**
 * @returns {ToolSchemas}
 */
function buildLiveShapeSchemas() {
  /** @type {ToolSchemas} */
  const shapeSchemas = {};
  for (const [toolName, typeName] of Object.entries(
    MessageToolMetadata.SHAPE_TOOL_TYPES,
  )) {
    shapeSchemas[toolName] = {
      /** @type {FieldSchema} */
      [typeName]: makeLiveShapeCreateSchema(toolName),
      update: makeLiveShapeUpdateSchema(toolName),
    };
  }
  return shapeSchemas;
}

/**
 * @returns {ToolSchemas}
 */
function buildStoredShapeSchemas() {
  /** @type {ToolSchemas} */
  const shapeSchemas = {};
  for (const toolName of Object.keys(MessageToolMetadata.SHAPE_TOOL_TYPES)) {
    shapeSchemas[toolName] = makeStoredShapeSchema(toolName);
  }
  return shapeSchemas;
}

/** @type {ToolSchemas} */
const LIVE_MESSAGE_SCHEMAS = {
  Pencil: {
    line: {
      tool: required(literal("Pencil")),
      type: required(literal("line")),
      id: required(normalizeId),
      color: required(normalizeColor),
      size: required(normalizeSize),
      opacity: optional(normalizeOpacity),
    },
    child: {
      tool: required(literal("Pencil")),
      type: required(literal("child")),
      parent: required(normalizeId),
      x: required(normalizeCoord),
      y: required(normalizeCoord),
    },
  },
  Text: {
    new: {
      tool: required(literal("Text")),
      type: required(literal("new")),
      id: required(normalizeId),
      color: required(normalizeColor),
      size: required(normalizeSize),
      opacity: optional(normalizeOpacity),
      x: required(normalizeCoord),
      y: required(normalizeCoord),
    },
    update: {
      tool: required(literal("Text")),
      type: required(literal("update")),
      id: required(normalizeId),
      txt: required(normalizeText),
    },
  },
  Cursor: {
    update: {
      tool: required(literal("Cursor")),
      type: required(literal("update")),
      color: required(normalizeColor),
      size: required(normalizeSize),
      x: required(normalizeCoord),
      y: required(normalizeCoord),
    },
  },
  Eraser: {
    delete: {
      tool: required(literal("Eraser")),
      type: required(literal("delete")),
      id: required(normalizeId),
    },
  },
  Clear: {
    clear: {
      tool: required(literal("Clear")),
      type: required(literal("clear")),
    },
  },
  ...buildLiveShapeSchemas(),
};

/** @type {ToolSchemas} */
const LIVE_BATCH_CHILD_SCHEMAS = {
  Hand: {
    update: {
      type: required(literal("update")),
      id: required(normalizeId),
      transform: required(normalizeTransform),
    },
    delete: {
      type: required(literal("delete")),
      id: required(normalizeId),
    },
    copy: {
      type: required(literal("copy")),
      id: required(normalizeId),
      newid: required(normalizeId),
    },
  },
};

/** @type {{[tool: string]: FieldSchema}} */
const STORED_ITEM_SCHEMAS = {
  Pencil: {
    tool: required(literal("Pencil")),
    type: optional(literal("line"), { defaultValue: "line" }),
    color: required(normalizeColor),
    size: required(normalizeSize),
    opacity: optional(normalizeOpacity),
    transform: optional(normalizeTransform),
    time: optional(normalizeTime),
  },
  Text: {
    tool: required(literal("Text")),
    type: optional(literal("new"), { defaultValue: "new" }),
    color: required(normalizeColor),
    size: required(normalizeSize),
    opacity: optional(normalizeOpacity),
    x: required(normalizeCoord),
    y: required(normalizeCoord),
    txt: optional(normalizeText),
    transform: optional(normalizeTransform),
    time: optional(normalizeTime),
  },
  ...buildStoredShapeSchemas(),
};

/**
 * @param {any} raw
 * @returns {ValidationResult<RawRecord>}
 */
function normalizeIncomingBatch(raw) {
  if (!isPlainObject(raw)) return rejected("expected object");
  if (typeof raw.tool !== "string") return rejected("missing tool");

  const childSchemas = LIVE_BATCH_CHILD_SCHEMAS[raw.tool];
  if (!childSchemas) return rejected("unsupported batch tool");
  if (!Array.isArray(raw._children)) return rejected("invalid _children");
  if (raw._children.length > config.MAX_CHILDREN) {
    return rejected("too many children");
  }

  const children = [];
  for (let index = 0; index < raw._children.length; index++) {
    const child = raw._children[index];
    const type = child && child.type;
    const schema = childSchemas[type];
    if (!schema) {
      return rejected("_children[" + index + "]: invalid type");
    }

    const normalizedChild = normalizeObject(child, schema);
    if (normalizedChild.ok === false) {
      return rejected("_children[" + index + "]: " + normalizedChild.reason);
    }
    children.push(normalizedChild.value);
  }

  return accepted({
    tool: raw.tool,
    _children: children,
  });
}

/**
 * @param {any} raw
 * @returns {ValidationResult<RawRecord>}
 */
function normalizeIncomingMessage(raw) {
  if (!isPlainObject(raw)) return rejected("expected object");
  if (Array.isArray(raw._children)) return normalizeIncomingBatch(raw);

  const toolSchemas = LIVE_MESSAGE_SCHEMAS[raw.tool];
  const schema = toolSchemas && toolSchemas[raw.type];
  if (!schema) return rejected("invalid tool/type");

  const normalized = normalizeObject(raw, schema);
  if (!normalized.ok) return normalized;
  if (
    normalized.value.type !== "update" &&
    MessageCommon.isGeometryTooLarge(normalized.value)
  ) {
    return rejected("shape too large");
  }
  return normalized;
}

/**
 * @param {any} raw
 * @returns {ValidationResult<ChildPoint>}
 */
function normalizeStoredChildPoint(raw) {
  const normalized = normalizeObject(raw, {
    x: required(normalizeCoord),
    y: required(normalizeCoord),
  });
  if (normalized.ok === false) return normalized;
  return accepted({
    x: normalized.value.x,
    y: normalized.value.y,
  });
}

/**
 * @param {any} raw
 * @param {any} storedId
 * @returns {ValidationResult<RawRecord>}
 */
function normalizeStoredItem(raw, storedId) {
  const normalizedId = MessageCommon.normalizeId(storedId);
  if (normalizedId === null) return rejected("invalid stored id");
  if (!isPlainObject(raw)) return rejected("invalid stored item");

  const schema = STORED_ITEM_SCHEMAS[raw.tool];
  if (!schema) return rejected("unsupported stored tool");

  const normalized = normalizeObject(raw, schema);
  if (!normalized.ok) return normalized;

  normalized.value.id = normalizedId;
  if (raw.tool === "Pencil") {
    const rawChildren = Array.isArray(raw._children)
      ? raw._children.slice(0, config.MAX_CHILDREN)
      : [];
    const children = [];
    for (let index = 0; index < rawChildren.length; index++) {
      const child = normalizeStoredChildPoint(rawChildren[index]);
      if (!child.ok) continue;
      children.push(child.value);
    }
    if (children.length) normalized.value._children = children;
  }

  if (MessageCommon.isGeometryTooLarge(normalized.value)) {
    return rejected("shape too large");
  }

  return normalized;
}

module.exports = {
  normalizeIncomingMessage,
  normalizeStoredChildPoint,
  normalizeStoredItem,
};
